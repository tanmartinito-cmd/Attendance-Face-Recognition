"""
Face Service: Handles face encoding, cached section indexing,
vectorized multi-face matching, and bounding box coordinate calculation.
"""
import json
import logging
import numpy as np
from django.core.cache import cache
from django.conf import settings
from core.models import StudentSection
from core.services.attendance_service import AttendanceService
from face_app.utils import (
    detect_and_encode_all_faces,
    batch_compare_faces,
    draw_face_boxes,
    check_face_liveness,
    assess_scan_quality,
    pick_face_for_next_attendance,
    _decode_image_to_rgb,
)

logger = logging.getLogger(__name__)

SECTION_CACHE_KEY_PREFIX = 'sec_face_embeddings_'
SECTION_CACHE_VERSION_PREFIX = 'sec_face_embeddings_version_'
GLOBAL_CACHE_KEY = 'global_student_face_embeddings'
GLOBAL_CACHE_VERSION_KEY = 'global_student_face_embeddings_version'
CONSENSUS_CACHE_PREFIX = 'face_consensus_'
LIVENESS_OK_PREFIX = 'face_liveness_ok_'
CACHE_TIMEOUT = getattr(settings, 'FACE_CACHE_TIMEOUT', 60)
LIVENESS_CACHE_TIMEOUT = 90


class FaceService:
    GLOBAL_CACHE_KEY = GLOBAL_CACHE_KEY

    @staticmethod
    def _version_key(section_id):
        return f"{SECTION_CACHE_VERSION_PREFIX}{section_id}"

    @staticmethod
    def _cache_version(key):
        return cache.get_or_set(key, 1, timeout=None)

    @staticmethod
    def _bump_version(key):
        cache.add(key, 1, timeout=None)
        try:
            return cache.incr(key)
        except ValueError:
            cache.set(key, 2, timeout=None)
            return 2

    @staticmethod
    def get_section_cache_key(section_id, subject_id=None):
        version = FaceService._cache_version(FaceService._version_key(section_id))
        subject_suffix = f"_sub_{subject_id}" if subject_id else ''
        return f"{SECTION_CACHE_KEY_PREFIX}{section_id}{subject_suffix}_v{version}"

    @staticmethod
    def get_global_cache_key():
        version = FaceService._cache_version(GLOBAL_CACHE_VERSION_KEY)
        return f"{GLOBAL_CACHE_KEY}_v{version}"

    @staticmethod
    def invalidate_cache(section_id=None):
        """Invalidate only affected face indexes; never flush unrelated cache entries."""
        cache.delete(FaceService.get_global_cache_key())
        FaceService._bump_version(GLOBAL_CACHE_VERSION_KEY)
        if section_id:
            cache.delete(FaceService.get_section_cache_key(section_id))
            FaceService._bump_version(FaceService._version_key(section_id))

    @staticmethod
    def get_global_student_encodings():
        """
        Retrieves all registered students across the school with their assigned sections.
        Cached in memory to rapidly detect students scanning in the WRONG section/schedule.
        """
        cache_key = FaceService.get_global_cache_key()
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return cached_data

        from accounts.models import Student
        students_qs = Student.objects.select_related('user').prefetch_related(
            'enrollments__section'
        ).exclude(
            face_encoding__isnull=True
        ).exclude(
            face_encoding__exact=''
        )

        students_list = []
        encodings_list = []

        for student in students_qs:
            try:
                encoding = json.loads(student.face_encoding)
                encodings_list.append(encoding)
                sections = [e.section.name for e in student.enrollments.all()]
                sections_str = ", ".join(sections) if sections else "No Section Assigned"
                students_list.append({
                    'id': student.pk,
                    'student_number': student.student_id,
                    'name': student.user.get_full_name() or student.user.username,
                    'assigned_sections': sections_str,
                })
            except (json.JSONDecodeError, TypeError):
                continue

        matrix = np.array(encodings_list, dtype=np.float32) if encodings_list else np.empty((0, 128), dtype=np.float32)

        data = {
            'students': students_list,
            'encodings': encodings_list,
            'matrix': matrix,
        }
        cache.set(cache_key, data, timeout=CACHE_TIMEOUT)
        return data

    @staticmethod
    def get_section_student_encodings(section, subject=None):
        """
        Retrieves enrolled students with face encodings for a section and optional subject.
        Pre-indexes encodings into a vectorized NumPy matrix for sub-millisecond matching.
        Uses Django cache to avoid repeated DB lookups and JSON parsing per video frame.
        Supports FSUU irregular students: includes block section students (subject=null)
        plus irregular students enrolled specifically in this subject.
        """
        subj_id = subject.pk if (subject and hasattr(subject, 'pk')) else (subject if isinstance(subject, int) else None)
        cache_key = FaceService.get_section_cache_key(section.pk, subj_id)
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return cached_data

        from django.db.models import Q
        filter_q = Q(section=section)
        if subj_id:
            filter_q &= (Q(subject__isnull=True) | Q(subject_id=subj_id))

        enrollments = StudentSection.objects.filter(
            filter_q
        ).select_related('student__user').exclude(
            student__face_encoding__isnull=True
        ).exclude(
            student__face_encoding__exact=''
        )

        students_list = []
        encodings_list = []
        seen_student_ids = set()

        for enrollment in enrollments:
            student = enrollment.student
            if student.pk in seen_student_ids:
                continue
            seen_student_ids.add(student.pk)
            try:
                encoding = json.loads(student.face_encoding)
                encodings_list.append(encoding)
                students_list.append({
                    'id': student.pk,
                    'student_number': student.student_id,
                    'name': student.user.get_full_name() or student.user.username,
                })
            except (json.JSONDecodeError, TypeError):
                continue

        matrix = np.array(encodings_list, dtype=np.float32) if encodings_list else np.empty((0, 128), dtype=np.float32)

        data = {
            'students': students_list,
            'encodings': encodings_list,
            'matrix': matrix,
        }
        cache.set(cache_key, data, timeout=CACHE_TIMEOUT)
        return data

    @staticmethod
    def _consensus_cache_key(session_id):
        return f"{CONSENSUS_CACHE_PREFIX}{session_id}"

    @staticmethod
    def _reset_consensus(session_id):
        cache.delete(FaceService._consensus_cache_key(session_id))

    @staticmethod
    def _consensus_frames_required(match_confidence=None):
        """Every match needs the same number of consecutive, distinct frames (no instant marks)."""
        return max(1, int(getattr(settings, 'FACE_CONSENSUS_FRAMES', 3)))

    @staticmethod
    def _update_consensus(session_id, student_id, face_encoding=None):
        """
        Track consecutive matching frames for one student.
        Returns (streak, is_replay). A frame whose face vector is (near-)identical to the
        previous one is a replayed/duplicated image: it does not advance the streak.
        """
        cache_key = FaceService._consensus_cache_key(session_id)
        data = cache.get(cache_key) or {'student_id': None, 'count': 0, 'last_encoding': None}
        is_replay = False

        if data.get('student_id') == student_id:
            last = data.get('last_encoding')
            if last is not None and face_encoding is not None and len(last) == len(face_encoding):
                epsilon = getattr(settings, 'FACE_REPLAY_EPSILON', 0.002)
                diff = float(np.linalg.norm(
                    np.asarray(last, dtype=np.float32) - np.asarray(face_encoding, dtype=np.float32)
                ))
                is_replay = diff < epsilon
            if not is_replay:
                data['count'] += 1
        else:
            data = {'student_id': student_id, 'count': 1}

        data['last_encoding'] = list(face_encoding) if face_encoding is not None else None
        cache.set(cache_key, data, timeout=60)
        return data['count'], is_replay

    @staticmethod
    def recognize_all_faces_in_frame(session, frame_bytes, tolerance=None):
        """
        Professional single-look recognition (no head-turn challenge):
        1. Detect faces; pick one (prefer an unmarked student, else largest / centered).
        2. Quality gate from 68 landmarks: head angle (solvePnP yaw/pitch/roll), eyes open,
           eye distance, sharpness, light. Bad frames are skipped (never guessed on).
        3. Strict Euclidean match of the 128-D code against the FULL section roster with
           confidence floor and second-best margin; already-marked owners are only reported.
        4. Passive liveness (heuristics + MiniFASNet), fails closed.
        5. FACE_CONSENSUS_FRAMES consecutive, non-identical good frames before marking.
        """
        if tolerance is None:
            tolerance = getattr(settings, 'FACE_RECOGNITION_TOLERANCE', 0.38)

        all_detected = detect_and_encode_all_faces(frame_bytes, downscale=0.42, fast=True)
        total_face_count = len(all_detected)
        if not all_detected:
            return {'success': True, 'recognized': [], 'face_count': 0}

        # Decode once for quality + liveness. If this fails, both fail closed below.
        try:
            img_rgb = _decode_image_to_rgb(frame_bytes)
            frame_h, frame_w = img_rgb.shape[:2]
        except Exception:
            img_rgb = None
            frame_w, frame_h = 640, 480

        def run_liveness(face_box):
            if img_rgb is None:
                return False, 'Liveness check failed: frame could not be decoded'
            is_live, _score, reason = check_face_liveness(img_rgb, face_box)
            return is_live, reason

        section = session.schedule.section
        subject = session.schedule.subject
        section_data = FaceService.get_section_student_encodings(section, subject=subject)
        students = section_data['students']
        section_matrix = section_data.get('matrix')
        if section_matrix is None and section_data.get('encodings'):
            section_matrix = np.array(section_data['encodings'], dtype=np.float32)

        marked_student_ids = set(
            session.records.exclude(status='absent').values_list('student_id', flat=True)
        )

        detected_faces = pick_face_for_next_attendance(
            all_detected, section_matrix, students, marked_student_ids, frame_w, frame_h, tolerance,
        )

        recognized_results = []

        def base_result(student, confidence, box, **extra):
            data = {
                'student_id': student['id'] if student else None,
                'student_number': student['student_number'] if student else None,
                'name': student['name'] if student else 'Unknown',
                'confidence': round(confidence * 100, 1),
                'status': None,
                'new_status': None,
                'box': box,
                'matched': False,
                'wrong_section': False,
            }
            data.update(extra)
            return data

        for face_item in detected_faces:
            face_encoding = face_item.get('encoding')
            box = face_item.get('box', {})

            # Quality gate first: a blurry / turned / eyes-closed frame is skipped, not matched.
            # The consensus streak is kept, so one bad frame does not restart the student.
            quality_ok, quality_reason, _metrics = assess_scan_quality(img_rgb, box)
            if not quality_ok:
                recognized_results.append(base_result(
                    None, 0.0, box, name='', quality_failed=True, message=quality_reason,
                ))
                continue

            best_match = None
            best_confidence = 0.0

            # Match against the FULL roster (marked students included) so the margin gate sees
            # every enrolled face; only afterwards decide whether the student is already marked.
            if section_matrix is not None and len(section_matrix) > 0 and face_encoding:
                is_match, best_idx, _dist, confidence, _margin = batch_compare_faces(
                    section_matrix, face_encoding, tolerance
                )
                if is_match and best_idx is not None and best_idx < len(students):
                    candidate = students[best_idx]
                    if candidate.get('id') in marked_student_ids:
                        recognized_results.append(base_result(
                            candidate, confidence, box,
                            status=session.records.filter(student_id=candidate['id'])
                            .exclude(status='absent').values_list('status', flat=True).first(),
                            verifying=False, already_marked=True,
                        ))
                        FaceService._reset_consensus(session.pk)
                        continue
                    best_match = candidate
                    best_confidence = confidence

            if best_match:
                from accounts.models import Student
                student_obj = Student.objects.get(pk=best_match['id'])

                is_live, live_reason = run_liveness(box)
                if not is_live:
                    FaceService._reset_consensus(session.pk)
                    recognized_results.append(base_result(
                        best_match, best_confidence, box, liveness_failed=True, message=live_reason,
                    ))
                    continue

                streak, is_replay = FaceService._update_consensus(session.pk, best_match['id'], face_encoding)
                consensus_reached = (
                    streak >= FaceService._consensus_frames_required(best_confidence) and not is_replay
                )
                record, is_new_mark = AttendanceService.mark_attendance(
                    session=session, student=student_obj, confidence=best_confidence,
                ) if consensus_reached else (None, False)
                if consensus_reached:
                    FaceService._reset_consensus(session.pk)

                recognized_results.append(base_result(
                    best_match, best_confidence, box,
                    status=record.status if record else 'verifying',
                    new_status=record.status if (is_new_mark and consensus_reached) else None,
                    matched=consensus_reached,
                    verifying=not consensus_reached,
                    replay_suspected=is_replay,
                ))
                continue

            FaceService._reset_consensus(session.pk)
            is_live, live_reason = run_liveness(box)
            if not is_live:
                recognized_results.append(base_result(None, 0.0, box, liveness_failed=True, message=live_reason))
                continue

            global_data = FaceService.get_global_student_encodings()
            global_matrix = global_data.get('matrix')
            global_students = global_data.get('students', [])
            wrong_section_match = None
            wrong_section_conf = 0.0
            if global_matrix is not None and len(global_matrix) > 0 and face_encoding:
                is_match_g, g_idx, _d, conf_g, _m = batch_compare_faces(global_matrix, face_encoding, tolerance)
                if is_match_g and g_idx is not None and g_idx < len(global_students):
                    wrong_section_match = global_students[g_idx]
                    wrong_section_conf = conf_g

            if wrong_section_match:
                recognized_results.append(base_result(
                    wrong_section_match, wrong_section_conf, box,
                    status='wrong_section', wrong_section=True,
                    assigned_sections=wrong_section_match.get('assigned_sections', 'Different Section'),
                ))
            else:
                recognized_results.append(base_result(None, 0.0, box))

        return {
            'success': True,
            'recognized': recognized_results,
            'face_count': total_face_count,
            'scanning_primary': len(detected_faces) == 1,
            'multiple_faces_detected': total_face_count > 1,
        }

    @staticmethod
    def draw_boxes(frame_bytes, recognized_results):
        """Draw bounding boxes and names on the frame image."""
        box_data = []
        for r in recognized_results:
            box = r.get('box', {})
            box_data.append({
                'top': box.get('top', 0),
                'right': box.get('right', 0),
                'bottom': box.get('bottom', 0),
                'left': box.get('left', 0),
                'name': r.get('name', 'Unknown'),
                'status': r.get('status', 'absent'),
            })
        return draw_face_boxes(frame_bytes, box_data)
