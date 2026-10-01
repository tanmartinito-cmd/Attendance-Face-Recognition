"""
Public registration (students + faculty), admin approval, sign-in messages, Turnstile,
and the required first face enrollment for students.
"""
import json
from unittest.mock import patch

from django.core.cache import cache, caches
from django.test import Client, TestCase, override_settings

from accounts.models import AccountRegistration, User
from core.models import Course, Instructor, Program, Student
from attendance_fr.tests.factories import create_student, create_user, set_face

PASSWORD = 'Strong-Pass-2026!'


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        caches['security'].clear()
        self.program = Program.objects.create(code='CITEC', name='Computing')
        self.course = Course.objects.create(program=self.program, code='BSIT', name='BS IT')
        self.admin = create_user('reg_admin', role='admin')
        self.client = Client()

    def tearDown(self):
        cache.clear()
        caches['security'].clear()

    def _student_payload(self, **extra):
        data = {
            'role': 'student', 'student_id': '23100000777', 'first_name': 'Ana', 'last_name': 'Reyes',
            'email': 'ana.reyes@gmail.com', 'program': self.program.pk, 'course_ref': self.course.pk,
            'year_level': 2, 'password': PASSWORD, 'confirm_password': PASSWORD, 'face_consent': True,
        }
        data.update(extra)
        return data

    def _register(self, **extra):
        return self.client.post('/api/register/', json.dumps(self._student_payload(**extra)),
                                content_type='application/json')

    def _login(self, username='23100000777', password=PASSWORD):
        return self.client.post('/api/token/', {'username': username, 'password': password},
                                content_type='application/json')

    def _as_admin(self):
        self.client.force_login(self.admin)


class RegisterTests(_Base):
    def test_options_are_public_and_list_active_courses(self):
        Course.objects.create(program=self.program, code='OLD', name='Closed', is_active=False)
        data = self.client.get('/api/register/options/').json()
        self.assertEqual([c['code'] for c in data['courses']], ['BSIT'])
        self.assertEqual(data['courses'][0]['program'], self.program.pk)
        self.assertEqual(data['turnstile_site_key'], '')

    def test_student_registration_creates_a_pending_inactive_account(self):
        res = self._register()
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(username='23100000777')
        self.assertFalse(user.is_active)
        self.assertEqual(user.student.course, self.course)
        self.assertEqual(user.registration.status, 'pending')
        self.assertIsNotNone(user.registration.face_consent_at)

    def test_faculty_registration(self):
        res = self.client.post('/api/register/', json.dumps({
            'role': 'instructor', 'faculty_id': 'FAC-0099', 'first_name': 'Juan', 'last_name': 'Cruz',
            'email': 'juan.cruz@gmail.com', 'department': 'Computing',
            'password': PASSWORD, 'confirm_password': PASSWORD,
        }), content_type='application/json')
        self.assertEqual(res.status_code, 201, res.content)
        instructor = Instructor.objects.get(faculty_id='FAC-0099')
        self.assertFalse(instructor.user.is_active)
        self.assertEqual(instructor.department, 'Computing')

    def test_cannot_register_as_admin(self):
        res = self._register(role='admin')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['field'], 'role')

    def test_validation_errors_name_the_field(self):
        cases = {
            'confirm_password': {'confirm_password': 'Different-Pass-1!'},
            'password': {'password': 'weak', 'confirm_password': 'weak'},
            'face_consent': {'face_consent': False},
            'course_ref': {'course_ref': 99999},
            'email': {'email': 'not-an-email'},
            'student_id': {'student_id': '!'},
            'year_level': {'year_level': 9},
        }
        for field, extra in cases.items():
            res = self._register(**extra)
            self.assertEqual(res.status_code, 400, field)
            self.assertEqual(res.json()['field'], field, res.content)
        self.assertFalse(User.objects.filter(username='23100000777').exists())

    def test_duplicate_id_and_email_are_refused(self):
        self.assertEqual(self._register().status_code, 201)
        again = self._register(email='other@gmail.com')
        self.assertEqual(again.json()['field'], 'student_id')
        same_email = self._register(student_id='23100000888')
        self.assertEqual(same_email.json()['field'], 'email')

    def test_pending_and_rejected_users_get_a_clear_message_only_with_the_right_password(self):
        self._register()
        pending = self._login()
        self.assertEqual(pending.status_code, 403)
        self.assertEqual(pending.json()['code'], 'registration_pending')
        self.assertEqual(self._login(password='Wrong-Pass-1!').status_code, 401)  # nothing revealed

        user = User.objects.get(username='23100000777')
        self._as_admin()
        self.client.post(f'/api/registrations/{user.pk}/reject/', {'reason': 'Student ID not found'},
                         content_type='application/json')
        self.client.logout()
        rejected = self._login()
        self.assertEqual(rejected.json()['code'], 'registration_rejected')
        self.assertIn('Student ID not found', rejected.json()['detail'])

    def test_registering_again_after_rejection_replaces_the_old_attempt(self):
        self._register()
        user = User.objects.get(username='23100000777')
        self._as_admin()
        self.client.post(f'/api/registrations/{user.pk}/reject/', {'reason': 'Wrong course'},
                         content_type='application/json')
        self.client.logout()
        self.assertEqual(self._register().status_code, 201)
        self.assertEqual(AccountRegistration.objects.get(user__username='23100000777').status, 'pending')

    @override_settings(TURNSTILE_SECRET_KEY='secret', TURNSTILE_SITE_KEY='site')
    def test_turnstile_is_required_when_configured(self):
        self.assertEqual(self.client.get('/api/register/options/').json()['turnstile_site_key'], 'site')
        missing = self._register()
        self.assertEqual(missing.json()['field'], 'turnstile')
        with patch('attendance_fr.api.services.registration.requests.post') as post:
            post.return_value.json.return_value = {'success': False, 'error-codes': ['invalid-input-response']}
            self.assertEqual(self._register(turnstile_token='bad').json()['field'], 'turnstile')
            post.return_value.json.return_value = {'success': True, 'action': 'register'}
            ok = self._register(turnstile_token='good')
        self.assertEqual(ok.status_code, 201, ok.content)
        self.assertEqual(post.call_args.kwargs['data']['secret'], 'secret')


class ApprovalTests(_Base):
    def setUp(self):
        super().setUp()
        self._register()
        self.user = User.objects.get(username='23100000777')

    def test_only_admin_can_review(self):
        teacher = create_user('reg_teacher', role='instructor')
        self.client.force_login(teacher)
        self.assertEqual(self.client.get('/api/registrations/').status_code, 403)
        self.assertEqual(self.client.post(f'/api/registrations/{self.user.pk}/approve/').status_code, 403)

    def test_list_and_counts(self):
        self._as_admin()
        data = self.client.get('/api/registrations/?status=pending').json()
        self.assertEqual(data['counts']['pending'], 1)
        row = data['results'][0]
        self.assertEqual((row['student_id'], row['course']['code'], row['program']['code']),
                         ('23100000777', 'BSIT', 'CITEC'))

    def test_pending_accounts_are_hidden_from_users_and_students_lists(self):
        self._as_admin()
        usernames = [u['username'] for u in self.client.get('/api/users/').json()]
        self.assertNotIn('23100000777', usernames)
        self.assertEqual(self.client.get('/api/students/').json(), [])

    def test_approve_activates_and_allows_sign_in(self):
        self._as_admin()
        res = self.client.post(f'/api/registrations/{self.user.pk}/approve/')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.json()['counts']['approved'], 1)
        self.client.logout()
        self.assertIn('access', self._login().json())
        # Approved students now appear in the admin lists
        self._as_admin()
        self.assertEqual(len(self.client.get('/api/students/').json()), 1)

    def test_reject_needs_a_reason_and_cannot_be_reviewed_twice(self):
        self._as_admin()
        no_reason = self.client.post(f'/api/registrations/{self.user.pk}/reject/', {'reason': ''},
                                     content_type='application/json')
        self.assertEqual(no_reason.status_code, 400)
        self.client.post(f'/api/registrations/{self.user.pk}/reject/', {'reason': 'Unknown student'},
                         content_type='application/json')
        twice = self.client.post(f'/api/registrations/{self.user.pk}/approve/')
        self.assertEqual(twice.status_code, 400)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)


@override_settings(FACE_ENROLLMENT_GATE=True)
class FaceGateTests(_Base):
    def setUp(self):
        super().setUp()
        self.student_user = create_user('gate_student', role='student', password=PASSWORD)
        self.student = create_student(user=self.student_user, student_id='GATE-001', course_ref=self.course)
        access = self._login('gate_student').json()['access']
        self.auth = {'HTTP_AUTHORIZATION': f'Bearer {access}'}

    def test_me_says_enrollment_is_required(self):
        me = self.client.get('/api/auth/me/', **self.auth).json()
        self.assertTrue(me['face_enrollment_required'])

    def test_other_api_calls_are_blocked_until_the_face_is_enrolled(self):
        blocked = self.client.get('/api/attendance/student/overview/', **self.auth)
        self.assertEqual(blocked.status_code, 403)
        self.assertEqual(blocked.json()['code'], 'face_enrollment_required')
        set_face(self.student, [0.1] * 128)
        self.assertNotEqual(self.client.get('/api/attendance/student/overview/', **self.auth).status_code, 403)
        self.assertFalse(self.client.get('/api/auth/me/', **self.auth).json()['face_enrollment_required'])

    def test_staff_are_never_gated(self):
        teacher = create_user('gate_teacher', role='instructor', password=PASSWORD)
        access = self._login('gate_teacher').json()['access']
        self.assertNotEqual(self.client.get('/api/sections/', HTTP_AUTHORIZATION=f'Bearer {access}').status_code, 403)
        self.assertFalse(self.client.get('/api/auth/me/', HTTP_AUTHORIZATION=f'Bearer {access}').json()['face_enrollment_required'])
        self.assertTrue(teacher.is_active)

    @patch('attendance_fr.api.views.face_recognition.FR_AVAILABLE', True)
    @patch('attendance_fr.api.views.face_recognition.FaceEnrollService.check_frame', return_value=None)
    def test_gated_student_may_check_frames(self, _check):
        res = self.client.post('/api/face/enroll/check/', {'frame': 'abc'}, content_type='application/json', **self.auth)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()['ok'])

    @patch('attendance_fr.api.views.face_recognition.FR_AVAILABLE', True)
    def test_self_enroll_once_then_unblocked(self):
        def fake_enroll(student, frames, replace=False):
            set_face(student, [0.2] * 128)
            return 'Face enrolled successfully!'
        with patch('attendance_fr.api.views.face_recognition.FaceEnrollService.enroll_student_face', side_effect=fake_enroll):
            res = self.client.post('/api/face/enroll/self/', {'frames': ['a', 'b', 'c']},
                                   content_type='application/json', **self.auth)
            self.assertEqual(res.status_code, 200, res.content)
            again = self.client.post('/api/face/enroll/self/', {'frames': ['a', 'b', 'c']},
                                     content_type='application/json', **self.auth)
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.json()['code'], 'already_enrolled')
        self.assertNotEqual(self.client.get('/api/attendance/student/overview/', **self.auth).status_code, 403)
        # Once enrolled, the frame-check endpoint is admin-only again
        self.assertEqual(self.client.post('/api/face/enroll/check/', {'frame': 'abc'},
                                          content_type='application/json', **self.auth).status_code, 403)

    @patch('attendance_fr.api.views.face_recognition.FR_AVAILABLE', True)
    def test_duplicate_face_does_not_reveal_the_other_student(self):
        from attendance_fr.api.services.face_recognition import FaceEnrollConflict
        conflict = FaceEnrollConflict('duplicate_face', 'This face is already enrolled to Bob Cruz (STU-B).',
                                      conflict_student={'id': 1, 'student_id': 'STU-B', 'name': 'Bob Cruz'})
        with patch('attendance_fr.api.views.face_recognition.FaceEnrollService.enroll_student_face', side_effect=conflict):
            res = self.client.post('/api/face/enroll/self/', {'frames': ['a', 'b', 'c']},
                                   content_type='application/json', **self.auth)
        self.assertEqual(res.status_code, 409)
        self.assertNotIn('Bob', res.content.decode())
        self.assertNotIn('STU-B', res.content.decode())
        self.assertNotIn('conflict_student', res.json())

    def test_staff_cannot_use_self_enroll(self):
        teacher = create_user('gate_teacher2', role='instructor', password=PASSWORD)
        self.client.force_login(teacher)
        self.assertEqual(self.client.post('/api/face/enroll/self/', {'frames': ['a']},
                                          content_type='application/json').status_code, 403)
        self.assertTrue(Student.objects.filter(pk=self.student.pk).exists())
