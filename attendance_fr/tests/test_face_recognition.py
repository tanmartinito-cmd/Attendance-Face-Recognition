"""
Face Recognition & Biometrics API Tests
"""
from datetime import time
from unittest.mock import patch
import numpy as np
from django.test import TestCase, Client
from django.utils import timezone
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule,
)


class RestFaceRecognitionApiTests(TestCase):
    def setUp(self):
        self.teacher_u = create_user(
            username='fr_teacher', role='instructor', password='StrongPassword123!'
        )
        self.teacher = create_instructor(user=self.teacher_u, faculty_id='EMP-FR-1')

        self.student_u = create_user(
            username='fr_student', role='student', first_name='Ada', last_name='Lovelace',
            password='StrongPassword123!'
        )
        self.student = create_student(
            user=self.student_u, student_id='STU-FR-001', course='BSCS', year_level=2
        )
        self.program = Program.objects.create(code='IT', name='Info Tech')
        self.subject = create_subject(code='IT101', name='Intro to Computing', units=3)
        self.section = create_section(
            name='IT-1A', program=self.program, subject=self.subject, teacher=self.teacher
        )
        self.schedule = create_schedule(
            section=self.section, day_of_week='Mon',
            start_time=time(9, 0), end_time=time(10, 0), room='Room 303'
        )

        enroll(student=self.student, section=self.section)
        self.client = Client()

    def test_face_recognition_match_api(self):
        """POST /api/face/recognize/ matches vectors against section enrollment cache."""
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='open'
        )
        self.client.force_login(self.teacher_u)

        with patch('attendance_fr.api.services.face_recognition.FaceRecognitionService.recognize_faces_for_session', return_value={
            'faces': [{'student_id': self.student.pk, 'name': 'Ada Lovelace', 'confidence': 0.95}],
            'recognized': True
        }), patch('attendance_fr.api.views.face_recognition.AttendanceService.validate_session_time_window', return_value=None):
            res = self.client.post(
                '/api/face/recognize/',
                {'session_id': session.pk, 'frame': 'dummy_b64'},
                content_type='application/json'
            )
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json().get('recognized'))


class FaceEnrollOneStudentOneFaceTests(TestCase):
    """Enrollment enforces 1 student = 1 face."""

    def setUp(self):
        import base64
        import json
        from io import BytesIO
        from PIL import Image

        self.json = json
        self.admin_u = create_user(
            username='fr_admin', role='admin', password='StrongPassword123!'
        )
        self.alice = create_student(
            user=create_user(
                username='alice', role='student', first_name='Alice', last_name='Reyes',
                password='StrongPassword123!'
            ),
            student_id='STU-A', face_encoding=json.dumps([0.1] * 128),
        )
        self.bob = create_student(
            user=create_user(
                username='bob', role='student', first_name='Bob', last_name='Cruz',
                password='StrongPassword123!'
            ),
            student_id='STU-B',
        )
        buf = BytesIO()
        Image.new('RGB', (200, 200), (120, 100, 90)).save(buf, format='JPEG')
        self.frame = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
        self.client = Client()
        self.client.force_login(self.admin_u)

    BOX = {'top': 20, 'right': 180, 'bottom': 180, 'left': 20}

    def _samples(self, encoding, yaws=(0.0, 0.3, -0.3)):
        """3 photos of one person: front + slight turns, tiny natural variation."""
        base = encoding[0]
        return [
            {'encoding': [base + 0.002 * i] * 128, 'box': dict(self.BOX), 'yaw': yaw, 'metrics': {}}
            for i, yaw in enumerate(yaws)
        ]

    def _post(self, student, samples, replace=None, frames=None):
        payload = {'student_id': student.pk, 'frames': frames or [self.frame] * len(samples)}
        if replace is not None:
            payload['replace'] = replace
        with patch('attendance_fr.api.services.face_recognition.extract_enrollment_sample',
                   side_effect=samples), \
             patch('django.db.models.fields.files.FieldFile.save', autospec=True):
            return self.client.post('/api/face/enroll/', payload, content_type='application/json')

    def _enroll(self, student, encoding, replace=None):
        return self._post(student, self._samples(encoding), replace=replace)

    def test_requires_at_least_three_photos(self):
        res = self._post(self.bob, self._samples([0.9] * 128)[:2])
        self.assertEqual(res.status_code, 400)
        self.assertIn('at least 3', res.json()['message'])

    def test_rejects_more_than_five_photos(self):
        res = self._post(self.bob, self._samples([0.9] * 128, yaws=(0.0,) * 6))
        self.assertEqual(res.status_code, 400)

    def test_rejects_photos_of_different_people(self):
        samples = self._samples([0.9] * 128)
        samples[2]['encoding'] = [0.2] * 128  # a different person slipped in
        res = self._post(self.bob, samples)
        self.assertEqual(res.status_code, 400)
        self.assertIn('same person', res.json()['message'])
        self.bob.refresh_from_db()
        self.assertFalse(self.bob.is_face_enrolled)


    def test_rejects_same_still_image_repeated(self):
        same = {'encoding': [0.9] * 128, 'box': dict(self.BOX), 'yaw': 0.0, 'metrics': {}}
        res = self._post(self.bob, [dict(same), dict(same), dict(same)])
        self.assertEqual(res.status_code, 400)
        self.assertIn('same still image', res.json()['message'])

    def test_auto_capture_all_frontal_frames_enroll(self):
        """The countdown capture sends 3 frontal frames; that is enough."""
        res = self._post(self.bob, self._samples([0.9] * 128, yaws=(0.02, -0.03, 0.01)))
        self.assertEqual(res.status_code, 200)

    def test_one_blinked_frame_is_dropped_not_failed(self):
        """A single countdown frame caught mid-blink must not fail the whole capture."""
        from face_app.utils import EnrollmentQualityError
        samples = self._samples([0.9] * 128)
        samples[1] = EnrollmentQualityError('Keep your eyes open.')
        res = self._post(self.bob, samples)
        self.assertEqual(res.status_code, 200)
        self.bob.refresh_from_db()
        self.assertTrue(self.bob.is_face_enrolled)

    def test_mostly_bad_frames_report_plain_reason(self):
        from face_app.utils import EnrollmentQualityError
        samples = self._samples([0.9] * 128)
        samples[0] = EnrollmentQualityError('Photo is blurry. Hold still and keep the camera steady.')
        samples[1] = EnrollmentQualityError('Photo is blurry. Hold still and keep the camera steady.')
        res = self._post(self.bob, samples)
        self.assertEqual(res.status_code, 400)
        message = res.json()['message']
        self.assertIn('blurry', message)
        self.assertNotIn('Photo 1', message)
        self.assertNotIn('Photo 2', message)

    def test_stored_identity_is_mean_of_photos(self):
        res = self._enroll(self.bob, [0.9] * 128)
        self.assertEqual(res.status_code, 200)
        self.bob.refresh_from_db()
        self.assertAlmostEqual(self.json.loads(self.bob.biometric.face_encoding)[0], 0.902, places=5)

    def test_duplicate_detected_from_any_single_photo(self):
        samples = self._samples([0.9] * 128)
        # Mean stays far from Alice, but one photo is Alice's face... consistency check would
        # also catch this; loosen it to prove the per-photo duplicate check on its own.
        samples[1]['encoding'] = [0.1] * 128
        with self.settings(FACE_ENROLL_CONSISTENCY_TOLERANCE=100):
            res = self._post(self.bob, samples)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'duplicate_face')

    def test_face_already_owned_by_another_student_is_rejected(self):
        res = self._enroll(self.bob, [0.1] * 128)
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body['code'], 'duplicate_face')
        self.assertEqual(body['conflict_student']['student_id'], 'STU-A')
        self.bob.refresh_from_db()
        self.assertFalse(self.bob.is_face_enrolled)

    def test_duplicate_rejected_even_with_replace(self):
        res = self._enroll(self.bob, [0.1] * 128, replace=True)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'duplicate_face')

    def test_distinct_face_enrolls(self):
        res = self._enroll(self.bob, [0.9] * 128)
        self.assertEqual(res.status_code, 200)
        self.bob.refresh_from_db()
        self.assertAlmostEqual(self.json.loads(self.bob.biometric.face_encoding)[0], 0.9, places=2)

    def test_reenroll_same_person_is_allowed(self):
        res = self._enroll(self.alice, [0.11] * 128)
        self.assertEqual(res.status_code, 200)

    def test_reenroll_different_person_requires_replace(self):
        res = self._enroll(self.alice, [0.9] * 128)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'face_mismatch')
        self.alice.refresh_from_db()
        self.assertEqual(self.json.loads(self.alice.biometric.face_encoding)[0], 0.1)

        res = self._enroll(self.alice, [0.9] * 128, replace=True)
        self.assertEqual(res.status_code, 200)
        self.alice.refresh_from_db()
        self.assertAlmostEqual(self.json.loads(self.alice.biometric.face_encoding)[0], 0.9, places=2)


class EnrollmentQualityGateTests(TestCase):
    """assess_face_quality / extract_enrollment_sample on synthetic images (landmarks mocked)."""

    def _img(self, value=128, noise=True):
        import numpy as np
        rng = np.random.default_rng(0)
        img = np.full((300, 300, 3), value, dtype=np.uint8)
        if noise:
            img = np.clip(img.astype(int) + rng.integers(-40, 40, img.shape), 0, 255).astype(np.uint8)
        return img

    BOX = {'top': 50, 'right': 250, 'bottom': 250, 'left': 50}

    @staticmethod
    def _fake_marks(eye_gap=90):
        """Open eyes, eye centers `eye_gap` px apart (only the groups analyze_face reads)."""
        eye = lambda x0: [(x0, 120), (x0 + 10, 115), (x0 + 20, 115), (x0 + 30, 120), (x0 + 20, 125), (x0 + 10, 125)]
        return {'left_eye': eye(90), 'right_eye': eye(90 + eye_gap)}

    def _assess(self, img, box=None, yaw=0.0, marks='default'):
        from face_app.utils import assess_face_quality
        marks = self._fake_marks() if marks == 'default' else marks
        pose = None if yaw is None else (yaw, 0.0, 0.0)
        with patch('face_app.utils.face_landmarks_68', return_value=marks), \
             patch('face_app.utils.head_pose_degrees', return_value=pose):
            return assess_face_quality(img, box or self.BOX)

    def test_sample_rejected_when_liveness_fails(self):
        from face_app import utils
        face = {'encoding': [0.1] * 128, 'box': dict(self.BOX)}
        with patch.object(utils, 'detect_and_encode_strict', return_value=(self._img(), [face])), \
             patch.object(utils, 'assess_face_quality', return_value=(True, 'ok', {'yaw': 0.0})), \
             patch.object(utils, 'check_face_liveness', return_value=(False, 0.0, 'Excessive specular glare')):
            with self.assertRaises(utils.EnrollmentQualityError) as ctx:
                utils.extract_enrollment_sample(b'jpeg')
        self.assertIn('not a photo or screen', str(ctx.exception))

    def test_good_face_passes(self):
        ok, reason, _ = self._assess(self._img())
        self.assertTrue(ok, reason)

    def test_small_face_rejected(self):
        ok, reason, _ = self._assess(self._img(), marks=self._fake_marks(eye_gap=20))
        self.assertFalse(ok)
        self.assertIn('closer', reason)

    def test_dark_face_rejected(self):
        ok, reason, _ = self._assess(self._img(value=15, noise=False))
        self.assertFalse(ok)
        self.assertIn('dark', reason)

    def test_blurry_face_rejected(self):
        ok, reason, _ = self._assess(self._img(noise=False))  # perfectly flat = no detail
        self.assertFalse(ok)
        self.assertIn('blurry', reason)

    def test_turned_or_unreadable_face_rejected(self):
        self.assertFalse(self._assess(self._img(), yaw=25)[0])       # degrees; enroll max 12
        self.assertFalse(self._assess(self._img(), yaw=None)[0])
        self.assertFalse(self._assess(self._img(), marks=None)[0])   # no landmarks found

    def test_closed_eyes_rejected(self):
        marks = self._fake_marks()
        marks['left_eye'] = [(90, 120), (100, 119), (110, 119), (120, 120), (110, 121), (100, 121)]
        ok, reason, _ = self._assess(self._img(), marks=marks)
        self.assertFalse(ok)
        self.assertIn('eyes open', reason)

    def test_enrollment_encoding_uses_jitters(self):
        from face_app import utils
        if not utils.FACE_RECOGNITION_AVAILABLE:
            self.skipTest('dlib not installed')
        with patch.object(utils.fr, 'face_locations', return_value=[(10, 60, 60, 10)]), \
             patch.object(utils.fr, 'face_encodings', return_value=[np.zeros(128)]) as encode, \
             self.settings(FACE_ENROLL_JITTERS=4):
            utils.detect_and_encode_strict(self._jpeg())
        self.assertEqual(encode.call_args.kwargs['num_jitters'], 4)

    def test_strict_detector_uses_no_loose_fallbacks(self):
        """Only HOG on the original image; no Haar/LBPH/enhanced retries."""
        from face_app import utils
        if not utils.FACE_RECOGNITION_AVAILABLE:
            self.skipTest('dlib not installed')
        with patch.object(utils.fr, 'face_locations', return_value=[]) as locate, \
             patch.object(utils, '_detect_faces_cv') as haar:
            _img, faces = utils.detect_and_encode_strict(self._jpeg())
        self.assertEqual(faces, [])
        self.assertEqual(locate.call_count, 2)
        haar.assert_not_called()

    def _jpeg(self):
        from io import BytesIO
        from PIL import Image
        buf = BytesIO()
        Image.new('RGB', (120, 120), (120, 100, 90)).save(buf, format='JPEG')
        return buf.getvalue()


class EnrollmentOvalFaceTests(TestCase):
    """Only the face inside the on-screen oval is enrolled; background people are ignored."""

    W, H = 640, 480

    @staticmethod
    def _face(cx, cy, size):
        half = size // 2
        return {'encoding': [0.5] * 128, 'box': {'top': cy - half, 'bottom': cy + half, 'left': cx - half, 'right': cx + half}}

    def test_background_faces_are_ignored(self):
        from face_app.utils import pick_enrollment_face
        student = self._face(320, 250, 200)
        faces = [self._face(60, 100, 60), student, self._face(590, 110, 70)]
        self.assertIs(pick_enrollment_face(faces, self.W, self.H), student)

    def test_nobody_in_oval_asks_to_center(self):
        from face_app.utils import EnrollmentQualityError, pick_enrollment_face
        with self.assertRaisesMessage(EnrollmentQualityError, 'center your face'):
            pick_enrollment_face([self._face(60, 100, 120)], self.W, self.H)

    def test_second_similar_face_in_oval_is_rejected(self):
        from face_app.utils import EnrollmentQualityError, pick_enrollment_face
        with self.assertRaisesMessage(EnrollmentQualityError, 'Only the student'):
            pick_enrollment_face([self._face(300, 240, 200), self._face(400, 250, 170)], self.W, self.H)


class FaceEnrollCheckApiTests(TestCase):
    def setUp(self):
        import base64
        from io import BytesIO
        from PIL import Image
        self.admin_u = create_user(username='chk_admin', role='admin', password='StrongPassword123!')
        buf = BytesIO()
        Image.new('RGB', (200, 200), (120, 100, 90)).save(buf, format='JPEG')
        self.frame = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode()
        self.client = Client()

    def _post(self, **patch_kwargs):
        with patch('attendance_fr.api.services.face_recognition.extract_enrollment_sample', **patch_kwargs):
            return self.client.post('/api/face/enroll/check/', {'frame': self.frame}, content_type='application/json')

    def test_good_frame_is_ok(self):
        self.client.force_login(self.admin_u)
        res = self._post(return_value={'encoding': [0.1] * 128})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'ok': True, 'message': ''})

    def test_bad_frame_returns_reason(self):
        from face_app.utils import EnrollmentQualityError
        self.client.force_login(self.admin_u)
        res = self._post(side_effect=EnrollmentQualityError('Keep your eyes open.'))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {'ok': False, 'message': 'Keep your eyes open.'})

    def test_admin_only(self):
        student_u = create_user(username='chk_student', role='student', password='StrongPassword123!')
        self.client.force_login(student_u)
        res = self._post(return_value={})
        self.assertIn(res.status_code, (401, 403))
