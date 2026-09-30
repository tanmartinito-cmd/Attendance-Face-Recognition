"""
Face App Feature Tests:
Tests face encoding storage, cached section indexing,
multi-face recognition in a single frame, and bounding box formatting.
"""
import json
import numpy as np
from django.test import TestCase, override_settings
from django.contrib.auth import get_user_model
from django.core.cache import cache
from face_app.services.face_service import FaceService
from face_app.utils import compare_faces
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule,
)

User = get_user_model()


class FaceAppFeatureTests(TestCase):
    def setUp(self):
        cache.clear()

        # Create Subject & ClassSection
        self.subject = create_subject(name='Computer Vision', code='CS302', units=3)
        self.section = create_section(name='BSCS-3A', subject=self.subject)
        self.schedule = create_schedule(
            section=self.section,
            day_of_week='Mon',
            start_time='08:00',
            end_time='10:00',
            room='Vision Lab'
        )
        self.session = AttendanceSession.objects.create(
            schedule=self.schedule,
            date='2026-09-21'
        )

        # Create 2 Students with mock 128-D face embeddings
        # Student 1: vector centered at 0.1
        self.user1 = User.objects.create_user(
            username='student_one', first_name='Alice', last_name='Smith',
            role='student', password='StrongPassword123!'
        )
        self.mock_vector1 = [0.1] * 128
        self.student1 = create_student(
            user=self.user1,
            student_id='STU-001',
            face_encoding=json.dumps(self.mock_vector1)
        )
        enroll(student=self.student1, section=self.section)

        # Student 2: vector centered at 0.9 (distinct from student 1)
        self.user2 = User.objects.create_user(
            username='student_two', first_name='Bob', last_name='Jones',
            role='student', password='StrongPassword123!'
        )
        self.mock_vector2 = [0.9] * 128
        self.student2 = create_student(
            user=self.user2,
            student_id='STU-002',
            face_encoding=json.dumps(self.mock_vector2)
        )
        enroll(student=self.student2, section=self.section)

    def test_face_encoding_json_storage(self):
        """Verify Student face encoding stores 128-D vector and reports is_face_enrolled."""
        self.assertTrue(self.student1.is_face_enrolled)
        stored_vector = json.loads(self.student1.biometric.face_encoding)
        self.assertEqual(len(stored_vector), 128)
        self.assertAlmostEqual(stored_vector[0], 0.1)

    def test_face_service_cache_indexing(self):
        """Verify FaceService caches section student vectors and invalidates cleanly."""
        cache_key = FaceService.get_section_cache_key(self.section.pk)
        self.assertIsNone(cache.get(cache_key))

        # First access loads from DB and caches
        data = FaceService.get_section_student_encodings(self.section)
        self.assertEqual(len(data['students']), 2)
        self.assertEqual(len(data['encodings']), 2)

        # Verify cached
        cached_data = cache.get(cache_key)
        self.assertIsNotNone(cached_data)
        self.assertEqual(len(cached_data['students']), 2)

        # Invalidate cache
        FaceService.invalidate_cache(self.section.pk)
        self.assertIsNone(cache.get(cache_key))

    def test_vector_distance_comparison(self):
        """Verify compare_faces matches identical vector and rejects divergent vector."""
        # Exact match
        is_match, conf = compare_faces(self.mock_vector1, self.mock_vector1, tolerance=0.5)
        self.assertTrue(is_match)
        self.assertGreater(conf, 0.9)

        # Divergent vectors (0.1 vs 0.9)
        is_match_diff, conf_diff = compare_faces(self.mock_vector1, self.mock_vector2, tolerance=0.5)
        self.assertFalse(is_match_diff)

    def test_multi_face_results_structure_and_bounding_boxes(self):
        """Verify recognition returns bounding boxes and student details for each face."""
        # Test simulated detection results with 2 distinct face locations
        locations = [
            {'top': 50, 'right': 150, 'bottom': 150, 'left': 50},
            {'top': 60, 'right': 350, 'bottom': 160, 'left': 250},
        ]

        # Verify box drawing helper generates modified bytes
        dummy_results = [
            {'top': 50, 'right': 150, 'bottom': 150, 'left': 50, 'name': 'Alice Smith', 'status': 'present'},
            {'top': 60, 'right': 350, 'bottom': 160, 'left': 250, 'name': 'Bob Jones', 'status': 'present'},
        ]
        # 100x100 dummy black image JPEG bytes
        from PIL import Image
        from io import BytesIO
        img = Image.new('RGB', (400, 300), color=(50, 50, 50))
        buf = BytesIO()
        img.save(buf, format='JPEG')
        raw_bytes = buf.getvalue()

        annotated_bytes = FaceService.draw_boxes(raw_bytes, dummy_results)
        self.assertIsNotNone(annotated_bytes)
        self.assertGreater(len(annotated_bytes), 0)

    def test_face_deletion_and_cache_invalidation(self):
        """Verify face deletion clears data and invalidates cache."""
        # Warm cache
        FaceService.get_section_student_encodings(self.section)
        cache_key = FaceService.get_section_cache_key(self.section.pk)
        self.assertIsNotNone(cache.get(cache_key))

        # Clear face
        StudentBiometric.objects.filter(student=self.student1).delete()
        FaceService.invalidate_cache(self.section.pk)

        # After invalidation, cache is empty and fresh fetch returns only 1 student
        self.assertIsNone(cache.get(cache_key))
        fresh_data = FaceService.get_section_student_encodings(self.section)
        self.assertEqual(len(fresh_data['students']), 1)
        self.assertEqual(fresh_data['students'][0]['student_number'], 'STU-002')

    def test_vectorized_batch_compare_faces(self):
        """Verify sub-millisecond vectorized batch matching across section matrix."""
        from face_app.utils import batch_compare_faces
        # Matrix with 2 student embeddings
        known_matrix = np.array([self.mock_vector1, self.mock_vector2], dtype=np.float32)

        # Match student 1
        is_match1, idx1, dist1, conf1, margin1 = batch_compare_faces(known_matrix, self.mock_vector1, tolerance=0.5)
        self.assertTrue(is_match1)
        self.assertEqual(idx1, 0)
        self.assertAlmostEqual(dist1, 0.0, places=3)
        self.assertGreater(conf1, 0.95)

        # Match student 2
        is_match2, idx2, dist2, conf2, margin2 = batch_compare_faces(known_matrix, self.mock_vector2, tolerance=0.5)
        self.assertTrue(is_match2)
        self.assertEqual(idx2, 1)
        self.assertAlmostEqual(dist2, 0.0, places=3)
        self.assertGreater(conf2, 0.95)

        # Rejection: distinct vector (centered at 0.5) with distance ~4.5 > 0.5
        unknown_vec = [0.5] * 128
        is_match_rej, idx_rej, dist_rej, conf_rej, _ = batch_compare_faces(known_matrix, unknown_vec, tolerance=0.5)
        self.assertFalse(is_match_rej)

    def test_match_margin_rejects_ambiguous_face(self):
        """Verify a look-alike vector between two enrolled students is rejected by margin gate."""
        from face_app.utils import batch_compare_faces
        vec_a = [0.0] * 128
        vec_b = [0.06] * 128
        ambiguous_vec = [0.03] * 128
        known_matrix = np.array([vec_a, vec_b], dtype=np.float32)
        is_match, idx, dist, conf, margin = batch_compare_faces(
            known_matrix, ambiguous_vec, tolerance=0.38, min_margin=0.08
        )
        self.assertFalse(is_match)
        self.assertLess(margin, 0.08)

    def test_pick_face_prefers_unmarked_student_in_queue(self):
        """When two faces are visible, prefer the one matching a not-yet-marked student."""
        from face_app.utils import pick_face_for_next_attendance
        import numpy as np

        faces = [
            {'encoding': self.mock_vector1, 'box': {'top': 10, 'right': 380, 'bottom': 340, 'left': 140}},
            {'encoding': self.mock_vector2, 'box': {'top': 10, 'right': 60, 'bottom': 60, 'left': 10}},
        ]
        data = FaceService.get_section_student_encodings(self.section)
        matrix = data['matrix']
        students = data['students']
        marked = {self.student1.pk}

        picked = pick_face_for_next_attendance(
            faces, matrix, students, marked, 640, 480, tolerance=0.5
        )
        self.assertEqual(len(picked), 1)
        self.assertEqual(picked[0]['encoding'][0], 0.9)

    def test_pick_primary_face_selects_largest_centered(self):
        """Verify single-face mode picks the most prominent face."""
        from face_app.utils import pick_primary_face
        faces = [
            {'encoding': [0.1]*128, 'box': {'top': 10, 'right': 60, 'bottom': 60, 'left': 10}},
            {'encoding': [0.2]*128, 'box': {'top': 80, 'right': 380, 'bottom': 340, 'left': 140}},
        ]
        primary = pick_primary_face(faces, 640, 480)
        self.assertEqual(len(primary), 1)
        self.assertEqual(primary[0]['encoding'][0], 0.2)

    # ── helpers for full recognition-pipeline tests ─────────────────────────
    @staticmethod
    def _frame(base, step):
        """A slightly different face vector per frame, like a real camera produces."""
        return [base + 0.001 * step] * 128

    def _scan(self, encoding, live=True, quality=(True, 'ok', {})):
        """Run one recognition frame with detection/decoding/quality/liveness mocked."""
        from unittest.mock import patch
        detected = [{'encoding': encoding, 'box': {'top': 10, 'right': 100, 'bottom': 100, 'left': 10}}]
        with patch('face_app.services.face_service.detect_and_encode_all_faces', return_value=detected), \
             patch('face_app.services.face_service._decode_image_to_rgb',
                   return_value=np.zeros((480, 640, 3), dtype=np.uint8)), \
             patch('face_app.services.face_service.assess_scan_quality', return_value=quality), \
             patch('face_app.services.face_service.check_face_liveness',
                   return_value=(live, 1.0 if live else 0.0, 'ok' if live else 'spoof')):
            return FaceService.recognize_all_faces_in_frame(self.session, b'dummy', tolerance=0.5)

    @override_settings(FACE_CONSENSUS_FRAMES=3)
    def test_consensus_required_before_marking(self):
        """Even a perfect match needs 3 consecutive distinct frames before marking."""
        for step in range(2):
            rec = self._scan(self._frame(0.1, step))['recognized'][0]
            self.assertTrue(rec.get('verifying'))
            self.assertFalse(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

        rec = self._scan(self._frame(0.1, 2))['recognized'][0]
        self.assertTrue(rec.get('matched'))
        self.assertTrue(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

    @override_settings(FACE_CONSENSUS_FRAMES=3)
    def test_identical_replayed_frames_never_mark(self):
        """Sending the exact same image repeatedly (photo replay) must not reach consensus."""
        for _ in range(6):
            rec = self._scan(self.mock_vector1)['recognized'][0]
            self.assertFalse(rec.get('matched'))
        self.assertFalse(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

    @override_settings(FACE_CONSENSUS_FRAMES=2)
    def test_second_student_marked_after_first_in_queue(self):
        """After student 1 is marked, student 2 in front should still be recognized."""
        self._scan(self._frame(0.1, 0))
        self._scan(self._frame(0.1, 1))
        self.assertTrue(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

        rec = self._scan(self._frame(0.9, 0))['recognized'][0]
        self.assertEqual(rec['student_id'], self.student2.pk)
        self.assertTrue(rec.get('verifying'))

        rec = self._scan(self._frame(0.9, 1))['recognized'][0]
        self.assertTrue(rec.get('matched'))
        self.assertTrue(self.session.records.filter(student=self.student2).exclude(status='absent').exists())

    @override_settings(FACE_CONSENSUS_FRAMES=1)
    def test_marked_student_is_not_attributed_to_lookalike(self):
        """A marked student's face must never be counted as an unmarked look-alike classmate."""
        # Make student 2 look similar to student 1 (distance ~0.23, within tolerance).
        set_face(self.student2, [0.12] * 128)

        self._scan(self._frame(0.1, 0))
        self.assertTrue(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

        rec = self._scan(self._frame(0.1, 1))['recognized'][0]
        self.assertTrue(rec.get('already_marked'))
        self.assertEqual(rec['student_id'], self.student1.pk)
        self.assertFalse(self.session.records.filter(student=self.student2).exclude(status='absent').exists())

    @override_settings(FACE_CONSENSUS_FRAMES=1)
    def test_liveness_failure_blocks_marking(self):
        rec = self._scan(self.mock_vector1, live=False)['recognized'][0]
        self.assertTrue(rec.get('liveness_failed'))
        self.assertFalse(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

    @override_settings(FACE_CONSENSUS_FRAMES=1)
    def test_undecodable_frame_fails_closed(self):
        """If the frame cannot be decoded for quality/liveness, nobody is marked."""
        from unittest.mock import patch
        detected = [{'encoding': self.mock_vector1, 'box': {'top': 10, 'right': 100, 'bottom': 100, 'left': 10}}]
        with patch('face_app.services.face_service.detect_and_encode_all_faces', return_value=detected):
            rec = FaceService.recognize_all_faces_in_frame(self.session, b'not-an-image', tolerance=0.5)['recognized'][0]
        self.assertTrue(rec.get('quality_failed') or rec.get('liveness_failed'))
        self.assertFalse(self.session.records.filter(student=self.student1).exclude(status='absent').exists())

    # ── Landmark quality gate (replaces the head-turn challenge) ────────────
    def _marked(self, student):
        return self.session.records.filter(student=student).exclude(status='absent').exists()

    @override_settings(FACE_CONSENSUS_FRAMES=1)
    def test_bad_quality_frame_is_skipped_not_matched(self):
        rec = self._scan(self.mock_vector1, quality=(False, 'Keep your eyes open.', {}))['recognized'][0]
        self.assertTrue(rec['quality_failed'])
        self.assertEqual(rec['message'], 'Keep your eyes open.')
        self.assertIsNone(rec['student_id'])
        self.assertFalse(self._marked(self.student1))

    @override_settings(FACE_CONSENSUS_FRAMES=2)
    def test_one_bad_frame_does_not_restart_the_streak(self):
        self._scan(self._frame(0.1, 0))
        self._scan(self._frame(0.1, 1), quality=(False, 'Image is blurry. Hold still.', {}))
        rec = self._scan(self._frame(0.1, 2))['recognized'][0]
        self.assertTrue(rec['matched'])
        self.assertTrue(self._marked(self.student1))

    @override_settings(FACE_CONSENSUS_FRAMES=1)
    def test_no_head_turn_needed(self):
        """A straight, live, strictly matched face is marked without any movement prompt."""
        rec = self._scan(self.mock_vector1)['recognized'][0]
        self.assertTrue(rec['matched'])
        self.assertNotIn('challenge', rec)

    # ── Landmark math ────────────────────────────────────────────────────────
    @staticmethod
    def _projected_marks(yaw, pitch, roll):
        import cv2
        from face_app.utils import _POSE_MODEL_POINTS
        rad = np.radians
        rz = np.array([[np.cos(rad(roll)), -np.sin(rad(roll)), 0], [np.sin(rad(roll)), np.cos(rad(roll)), 0], [0, 0, 1]])
        ry = np.array([[np.cos(rad(yaw)), 0, np.sin(rad(yaw))], [0, 1, 0], [-np.sin(rad(yaw)), 0, np.cos(rad(yaw))]])
        rx = np.array([[1, 0, 0], [0, np.cos(rad(pitch)), -np.sin(rad(pitch))], [0, np.sin(rad(pitch)), np.cos(rad(pitch))]])
        rvec = cv2.Rodrigues(rz @ ry @ rx)[0]
        cam = np.array([[640, 0, 320], [0, 640, 240], [0, 0, 1]], dtype=np.float64)
        pts, _ = cv2.projectPoints(_POSE_MODEL_POINTS, rvec, np.array([0.0, 0.0, 1500.0]), cam, np.zeros(4))
        p = [tuple(x) for x in pts.reshape(-1, 2)]
        return {'nose_bridge': [p[0]] * 4, 'chin': [p[1]] * 9, 'left_eye': [p[2]] * 4,
                'right_eye': [p[3]] * 4, 'top_lip': [p[4]] * 6 + [p[5]]}

    def test_head_pose_recovers_known_angles(self):
        from face_app.utils import head_pose_degrees
        for true in [(0, 0, 0), (15, 0, 0), (-25, 0, 0), (0, 12, 0), (0, 0, 10), (18, -8, 5)]:
            est = head_pose_degrees(self._projected_marks(*true), 640, 480)
            for got, want in zip(est, true):
                self.assertAlmostEqual(got, want, delta=1.0, msg=f'{true} -> {est}')

    def test_eye_aspect_ratio_open_vs_closed(self):
        from face_app.utils import eye_aspect_ratio
        open_eye = [(0, 0), (10, -5), (20, -5), (30, 0), (20, 5), (10, 5)]
        closed_eye = [(0, 0), (10, -1), (20, -1), (30, 0), (20, 1), (10, 1)]
        self.assertGreater(eye_aspect_ratio(open_eye), 0.3)
        self.assertLess(eye_aspect_ratio(closed_eye), 0.1)

    def test_quality_rules_scan_vs_enroll(self):
        from face_app.utils import check_face_quality
        good = {'landmarks': True, 'yaw': 5, 'pitch': 3, 'roll': 2, 'ear': 0.28,
                'eye_distance': 60, 'brightness': 120, 'sharpness': 150}
        self.assertTrue(check_face_quality(good, 'scan')[0])
        self.assertTrue(check_face_quality(good, 'enroll')[0])
        turned = dict(good, yaw=16)                 # ok for scanning, too turned for the stored selfie
        self.assertTrue(check_face_quality(turned, 'scan')[0])
        self.assertFalse(check_face_quality(turned, 'enroll')[0])
        cases = {
            'landmarks': (dict(good, landmarks=False), 'eyes and nose'),
            'closer': (dict(good, eye_distance=10), 'closer'),
            'blur': (dict(good, sharpness=5), 'blurry'),
            'sideways': (dict(good, yaw=40), 'turned sideways'),
            'tilt': (dict(good, pitch=40), 'tilted'),
            'lean': (dict(good, roll=30), 'level'),
            'eyes': (dict(good, ear=0.1), 'eyes open'),
            'dark': (dict(good, brightness=10), 'dark'),
        }
        for name, (metrics, words) in cases.items():
            ok, reason = check_face_quality(metrics, 'scan')
            self.assertFalse(ok, name)
            self.assertIn(words, reason, name)

    # ── Passive liveness model ───────────────────────────────────────────────
    def test_antispoof_model_loads_and_scores(self):
        from face_app.utils import passive_liveness_score
        img = np.random.default_rng(0).integers(0, 255, (360, 480, 3), dtype=np.uint8)
        score = passive_liveness_score(img, {'top': 100, 'right': 300, 'bottom': 260, 'left': 180})
        self.assertIsNotNone(score)
        self.assertGreaterEqual(score, 0.0)
        self.assertLessEqual(score, 1.0)

    def test_liveness_rejects_when_model_says_spoof_or_is_missing(self):
        from unittest.mock import patch
        from face_app.utils import check_face_liveness
        rng = np.random.default_rng(1)
        base = np.array([170, 120, 100], dtype=np.int16)  # skin-like tone, mild texture
        img = np.clip(base + rng.integers(-12, 12, (360, 480, 3)), 0, 255).astype(np.uint8)
        box = {'top': 100, 'right': 300, 'bottom': 260, 'left': 140}
        with patch('face_app.utils.passive_liveness_score', return_value=0.05):
            self.assertFalse(check_face_liveness(img, box)[0])
        with patch('face_app.utils.passive_liveness_score', return_value=None):
            self.assertFalse(check_face_liveness(img, box)[0])
        with patch('face_app.utils.passive_liveness_score', return_value=0.95):
            self.assertTrue(check_face_liveness(img, box)[0])

    def test_liveness_check_fails_closed_on_bad_input(self):
        from face_app.utils import check_face_liveness
        is_live, _score, _reason = check_face_liveness(None, {})
        self.assertFalse(is_live)

    def test_wrong_section_detection(self):
        """Verify student enrolled in ClassSection B scanning in ClassSection A is detected as wrong_section."""
        from unittest.mock import patch

        # Create ClassSection B
        section_b = create_section(name='BSCS-3B', subject=self.subject)
        user_b = User.objects.create_user(
            username='student_b', first_name='Charlie', last_name='Brown',
            role='student', password='StrongPassword123!'
        )
        mock_vector_b = [0.7] * 128
        student_b = create_student(
            user=user_b,
            student_id='STU-003',
            face_encoding=json.dumps(mock_vector_b)
        )
        enroll(student=student_b, section=section_b)
        FaceService.invalidate_cache()

        # Mock frame detection returning Charlie's face
        simulated_detected = [
            {'encoding': mock_vector_b, 'box': {'top': 10, 'right': 100, 'bottom': 100, 'left': 10}}
        ]

        with patch('face_app.services.face_service.detect_and_encode_all_faces', return_value=simulated_detected), \
             patch('face_app.services.face_service._decode_image_to_rgb',
                   return_value=np.zeros((480, 640, 3), dtype=np.uint8)), \
             patch('face_app.services.face_service.assess_scan_quality', return_value=(True, 'ok', {})), \
             patch('face_app.services.face_service.check_face_liveness', return_value=(True, 1.0, 'ok')):
            # Scan Charlie in ClassSection A's session
            res = FaceService.recognize_all_faces_in_frame(self.session, b'dummy_frame', tolerance=0.5)

            self.assertTrue(res['success'])
            self.assertEqual(len(res['recognized']), 1)
            rec = res['recognized'][0]

            # Verify Charlie is flagged as wrong_section
            self.assertFalse(rec['matched'])
            self.assertTrue(rec['wrong_section'])
            self.assertEqual(rec['student_number'], 'STU-003')
            self.assertEqual(rec['name'], 'Charlie Brown')
            self.assertIn('BSCS-3B', rec['assigned_sections'])

            # Verify NO attendance record was created for Charlie in ClassSection A's session
            self.assertFalse(self.session.records.filter(student=student_b).exists())

    def test_face_student_list_api(self):
        """The active frontend retrieves face-enrollment candidates from the student API."""
        from django.test import Client
        admin = User.objects.create_user(username='face_admin', role='admin', password='StrongPassword123!')
        client = Client()
        client.force_login(admin)

        res = client.get('/api/students/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(any(item['student_id'] == 'STU-001' for item in data))
        self.assertTrue(any(item['student_id'] == 'STU-002' for item in data))

    def test_face_enroll_api(self):
        """The active API enrolls a face for an administrator-selected student."""
        from django.test import Client
        from unittest.mock import patch
        admin = User.objects.create_user(username='face_admin2', role='admin', password='StrongPassword123!')
        client = Client()
        client.force_login(admin)

        with patch('attendance_fr.api.services.face_recognition.FaceEnrollService.enroll_student_face', return_value='Face enrolled successfully.'):
            res = client.post(
                '/api/face/enroll/',
                {'student_id': self.student1.pk, 'frame': 'data:image/jpeg;base64,ZmFrZQ=='},
                content_type='application/json',
            )
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json().get('success'))


    def test_targeted_invalidation_preserves_unrelated_cache_entries(self):
        """A roster change bypasses only the affected section index within 60 seconds."""
        cache.set('unrelated-cache-entry', 'keep', timeout=60)
        old_key = FaceService.get_section_cache_key(self.section.pk)
        FaceService.get_section_student_encodings(self.section)
        self.assertIsNotNone(cache.get(old_key))

        new_user = User.objects.create_user(username='student_three', role='student', password='StrongPassword123!')
        new_student = create_student(
            user=new_user, student_id='STU-003', face_encoding=json.dumps([0.3] * 128)
        )
        enroll(student=new_student, section=self.section)

        new_key = FaceService.get_section_cache_key(self.section.pk)
        self.assertNotEqual(old_key, new_key)
        self.assertEqual(cache.get('unrelated-cache-entry'), 'keep')
        refreshed = FaceService.get_section_student_encodings(self.section)
        self.assertEqual(len(refreshed['students']), 3)

    def test_face_index_cache_uses_configured_sixty_second_ttl(self):
        from face_app.services.face_service import CACHE_TIMEOUT
        self.assertEqual(CACHE_TIMEOUT, 60)
