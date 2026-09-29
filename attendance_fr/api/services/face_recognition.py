"""
Face Recognition Service (API Layer)
Handles face enrollment and live frame recognition business logic.
Integrates with face_app core utilities and FaceService.
"""
import json
from io import BytesIO
from django.conf import settings
from django.utils import timezone
from django.core.files.base import ContentFile

from core.models import AttendanceSession
import numpy as np

from face_app.utils import (
    EnrollmentQualityError,
    compare_faces,
    decode_frame,
    extract_enrollment_sample,
    FR_AVAILABLE,
)
from face_app.services.face_service import FaceService


class FaceEnrollConflict(ValueError):
    """Enrollment refused because it would break the one-student-one-face rule."""

    def __init__(self, code, message, conflict_student=None):
        super().__init__(message)
        self.code = code
        self.conflict_student = conflict_student


class FaceRecognitionService:

    @staticmethod
    def get_session(session_id):
        """
        Resolves an attendance session by its primary key only.
        (The old schedule-ID fallback could silently resolve a different session.)
        """
        try:
            pk = int(session_id)
        except (TypeError, ValueError):
            return None
        return AttendanceSession.objects.select_related(
            'schedule__section', 'schedule__subject'
        ).filter(pk=pk).first()

    @staticmethod
    def recognize_faces_for_session(session, frame_b64):
        """
        Decodes camera frame and runs biometric face recognition matching for the session.
        Returns match result dict.
        """
        frame_bytes = decode_frame(frame_b64)  # raises InvalidImageError (a ValueError)
        return FaceService.recognize_all_faces_in_frame(session, frame_bytes)


class FaceEnrollService:

    @staticmethod
    def _duplicate_tolerance():
        # Looser than the attendance match tolerance on purpose: anything that even
        # resembles an existing student's face is treated as the same person.
        return getattr(settings, 'FACE_DUPLICATE_TOLERANCE', 0.5)

    @staticmethod
    def find_duplicate_owner(student, encoding):
        """
        Returns the closest *other* student whose enrolled face matches this encoding,
        or None. Reads the database directly so a stale cache can never let a duplicate through.
        """
        from accounts.models import Student

        tolerance = FaceEnrollService._duplicate_tolerance()
        others = (
            Student.objects.select_related('user')
            .exclude(pk=student.pk)
            .exclude(face_encoding__isnull=True)
            .exclude(face_encoding__exact='')
        )
        best_owner = None
        best_confidence = -1.0
        for other in others.iterator():
            try:
                other_encoding = json.loads(other.face_encoding)
            except (json.JSONDecodeError, TypeError):
                continue
            if len(other_encoding) != len(encoding):
                continue
            is_match, confidence = compare_faces(other_encoding, encoding, tolerance)
            if is_match and confidence > best_confidence:
                best_owner, best_confidence = other, confidence
        return best_owner

    @staticmethod
    def is_same_person(existing_encoding_json, encoding):
        """True when the new capture matches the face already enrolled for this student."""
        try:
            existing = json.loads(existing_encoding_json)
        except (json.JSONDecodeError, TypeError):
            return True  # corrupt/legacy data: nothing meaningful to protect
        if len(existing) != len(encoding):
            return True  # different engine (e.g. LBPH -> dlib); cannot compare
        is_match, _confidence = compare_faces(existing, encoding, FaceEnrollService._duplicate_tolerance())
        return is_match

    @staticmethod
    def _sample_limits():
        low = max(1, int(getattr(settings, 'FACE_ENROLL_MIN_SAMPLES', 3)))
        high = max(low, int(getattr(settings, 'FACE_ENROLL_MAX_SAMPLES', 5)))
        return low, high

    @staticmethod
    def build_identity(frames_b64):
        """
        Validates 3-5 photos of ONE person and combines them into one face identity.
        - every photo: strict detector, exactly one face, quality gate (size/light/blur/turn);
        - at least one photo must face the camera;
        - all photos must be the same person (pairwise distance check);
        - the stored encoding is the mean of the samples (more robust to light/angle).
        Returns (mean_encoding, samples, primary_frame_bytes, primary_box).
        """
        low, high = FaceEnrollService._sample_limits()
        if not isinstance(frames_b64, (list, tuple)):
            frames_b64 = [frames_b64] if frames_b64 else []
        if len(frames_b64) < low:
            raise ValueError(f'Capture at least {low} photos (front and slightly left/right).')
        if len(frames_b64) > high:
            raise ValueError(f'Send at most {high} photos.')

        samples = []
        for index, frame_b64 in enumerate(frames_b64, start=1):
            frame_bytes = decode_frame(frame_b64)  # raises InvalidImageError (a ValueError)
            try:
                sample = extract_enrollment_sample(frame_bytes)
            except EnrollmentQualityError as exc:
                raise ValueError(f'Photo {index}: {exc}') from exc
            sample['frame_bytes'] = frame_bytes
            samples.append(sample)

        # Every sample already passed the enrollment gate (straight face: FACE_ENROLL_MAX_YAW etc.).
        frontal = samples

        consistency = getattr(settings, 'FACE_ENROLL_CONSISTENCY_TOLERANCE', 0.5)
        replay_epsilon = getattr(settings, 'FACE_REPLAY_EPSILON', 0.002)
        vectors = [np.asarray(s['encoding'], dtype=np.float32) for s in samples]
        closest_pair = None
        for i in range(len(vectors)):
            for j in range(i + 1, len(vectors)):
                distance = float(np.linalg.norm(vectors[i] - vectors[j]))
                closest_pair = distance if closest_pair is None else min(closest_pair, distance)
                if distance > consistency:
                    raise ValueError(
                        f'Photos {i + 1} and {j + 1} do not look like the same person. '
                        'Only the student being enrolled may appear in the photos.'
                    )
        # Frames from a live camera always differ a little; byte-identical repeats mean
        # one still image was submitted several times instead of a real capture.
        if closest_pair is not None and closest_pair < replay_epsilon:
            raise ValueError('The capture looks like the same still image repeated. Please capture live from the camera.')

        mean_encoding = np.mean(np.stack(vectors), axis=0).tolist()
        primary = min(frontal, key=lambda s: abs(s.get('yaw') or 0))
        return mean_encoding, samples, primary['frame_bytes'], primary['box']

    @staticmethod
    def enroll_student_face(student, frames_b64, replace=False):
        """
        Enrolls ONE face identity for a student from 3-5 photos (see build_identity),
        crops the most frontal photo, and persists it.
        Enforces one student = one face:
          - the face may not already belong to another student (always enforced);
          - re-enrolling must be the same person unless an admin explicitly passes replace=True.
        Returns success message string.
        Raises ValueError on validation failures (photo count, quality, consistency)
        and FaceEnrollConflict when the one-student-one-face rule would be broken.
        """
        from PIL import Image

        encoding, samples, frame_bytes, primary_box = FaceEnrollService.build_identity(frames_b64)
        locations = [primary_box]

        # Duplicate check against the combined identity and every individual photo.
        owner = None
        for candidate in [encoding] + [s['encoding'] for s in samples]:
            owner = FaceEnrollService.find_duplicate_owner(student, candidate)
            if owner is not None:
                break
        if owner is not None:
            owner_name = owner.user.get_full_name() or owner.user.username
            raise FaceEnrollConflict(
                'duplicate_face',
                f'This face is already enrolled to {owner_name} ({owner.student_id}). '
                'One face can only belong to one student.',
                conflict_student={'id': owner.pk, 'student_id': owner.student_id, 'name': owner_name},
            )

        if student.face_encoding and not replace and not FaceEnrollService.is_same_person(
            student.face_encoding, encoding
        ):
            raise FaceEnrollConflict(
                'face_mismatch',
                'This face does not match the face already enrolled for this student. '
                'Confirm to replace the existing face.',
            )

        # Persist encoding
        student.face_encoding = json.dumps(encoding)
        student.face_enrolled_at = timezone.now()

        # Crop & save face photo
        img = Image.open(BytesIO(frame_bytes)).convert('RGB')
        loc = locations[0]
        pad = 30
        left = max(0, loc['left'] - pad)
        top = max(0, loc['top'] - pad)
        right = min(img.width, loc['right'] + pad)
        bottom = min(img.height, loc['bottom'] + pad)
        img = img.crop((left, top, right, bottom))

        img_io = BytesIO()
        img.save(img_io, format='JPEG', quality=90)
        filename = f"face_{student.student_id}_{timezone.now().strftime('%Y%m%d%H%M%S')}.jpg"
        student.face_image.save(filename, ContentFile(img_io.getvalue()), save=False)
        student.save()

        # Global index here; section indexes are invalidated by the Student post_save signal.
        FaceService.invalidate_cache()
        return f'Face enrolled successfully for {student.user.get_full_name()}!'
