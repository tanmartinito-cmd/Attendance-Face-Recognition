"""
Security quick-win tests: login throttling/lockout, password policy,
health-check error hiding, and frame/image upload validation.
"""
import base64
from io import BytesIO
from unittest.mock import patch

from io import StringIO

from django.core.cache import cache, caches
from django.core.exceptions import ValidationError
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from PIL import Image

from accounts.validators import validate_image_upload
from attendance_fr.api.services.users import validate_password_strength
from face_app.utils import InvalidImageError, decode_frame
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule,
)


def _image_bytes(fmt='JPEG', size=(40, 40)):
    buf = BytesIO()
    Image.new('RGB', size, (120, 100, 90)).save(buf, format=fmt)
    return buf.getvalue()


def _data_url(raw, mime='image/jpeg'):
    return f'data:{mime};base64,' + base64.b64encode(raw).decode()


class LoginProtectionTests(TestCase):
    def setUp(self):
        cache.clear()
        caches['security'].clear()
        self.user = create_user(
            username='sec_teacher', role='instructor', password='StrongPassword123!'
        )
        self.client = Client()

    def tearDown(self):
        cache.clear()
        caches['security'].clear()

    def _login_from(self, ip, username='sec_teacher', password='wrong'):
        return self.client.post('/api/token/', {'username': username, 'password': password},
                                content_type='application/json', REMOTE_ADDR=ip)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=50, LOGIN_ACCOUNT_MAX_FAILURES=6)
    def test_account_cap_applies_across_different_ips(self):
        for i in range(5):
            self.assertEqual(self._login_from(f'10.0.0.{i}').status_code, 401)
        locked = self._login_from('10.0.0.99')  # 6th failure, yet another IP
        self.assertEqual(locked.status_code, 429)
        self.assertIn('account is locked', locked.json()['detail'])
        # Even the right password from a fresh IP is refused while the account is locked.
        self.assertEqual(self._login_from('10.9.9.9', password='StrongPassword123!').status_code, 429)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=50, LOGIN_ACCOUNT_MAX_FAILURES=4)
    def test_account_cap_counts_every_login_identifier_of_the_same_user(self):
        self.user.email = 'sec@example.com'
        self.user.save()
        for i, ident in enumerate(['sec_teacher', 'SEC_TEACHER', 'sec@example.com']):
            self.assertEqual(self._login_from(f'10.1.0.{i}', username=ident).status_code, 401)
        self.assertEqual(self._login_from('10.1.0.9', username='sec@example.com').status_code, 429)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=50, LOGIN_ACCOUNT_MAX_FAILURES=3)
    def test_unknown_usernames_lock_like_real_ones(self):
        """No account enumeration: a made-up name gets the same answers."""
        codes = [self._login_from(f'10.2.0.{i}', username='ghost').status_code for i in range(3)]
        self.assertEqual(codes, [401, 401, 429])

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=50, LOGIN_ACCOUNT_MAX_FAILURES=2)
    def test_admin_unlock_command(self):
        from django.core.management import call_command
        self._login_from('10.3.0.1')
        self.assertEqual(self._login_from('10.3.0.2').status_code, 429)
        call_command('unlock_login', 'sec_teacher', stdout=StringIO())
        self.assertEqual(self._login_from('10.3.0.3', password='StrongPassword123!').status_code, 200)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=50, LOGIN_ACCOUNT_MAX_FAILURES=3)
    def test_successful_login_resets_account_counter(self):
        self._login_from('10.4.0.1')
        self._login_from('10.4.0.2')
        self.assertEqual(self._login_from('10.4.0.3', password='StrongPassword123!').status_code, 200)
        self.assertEqual(self._login_from('10.4.0.4').status_code, 401)  # counter restarted

    def test_access_tokens_are_short_lived(self):
        from django.conf import settings
        self.assertLessEqual(settings.SIMPLE_JWT['ACCESS_TOKEN_LIFETIME'].total_seconds(), 15 * 60)

    def _login(self, username='sec_teacher', password='StrongPassword123!'):
        return self.client.post('/api/token/', {'username': username, 'password': password},
                                content_type='application/json')

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=5, LOGIN_LOCKOUT_MINUTES=15)
    def test_lockout_after_repeated_failures_blocks_even_correct_password(self):
        for _ in range(4):
            self.assertEqual(self._login(password='wrong').status_code, 401)
        locked = self._login(password='wrong')
        self.assertEqual(locked.status_code, 429)
        self.assertTrue(locked.json()['locked'])
        self.assertIn('Retry-After', locked.headers)

        # Correct password is still refused while locked
        self.assertEqual(self._login().status_code, 429)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=5)
    def test_successful_login_resets_failure_count(self):
        for _ in range(4):
            self._login(password='wrong')
        self.assertEqual(self._login().status_code, 200)
        # Counter was reset, so 4 more failures still don't lock
        for _ in range(4):
            self.assertEqual(self._login(password='wrong').status_code, 401)

    def test_login_is_rate_limited_per_ip(self):
        # Default 'login' rate is 10/min; different usernames avoid the lockout path
        statuses = [self._login(username=f'nobody{i}', password='x').status_code for i in range(11)]
        self.assertTrue(all(code == 401 for code in statuses[:10]))
        self.assertEqual(statuses[10], 429)


class PasswordPolicyTests(TestCase):
    def test_single_policy_rejects_weak_passwords(self):
        for weak in ('Pass@1', 'password', 'Password123', 'Secure@Pass', '12345678!Aa'[:6]):
            self.assertIsNotNone(validate_password_strength(weak), weak)

    def test_common_password_rejected_even_if_complex_shape(self):
        # Django's common-password list catches this; the character rules alone would not
        self.assertIsNotNone(validate_password_strength('P@ssw0rd'))

    def test_password_similar_to_username_rejected(self):
        user = User(username='juandelacruz')
        user.profile = UserProfile(first_name='Juan', last_name='Delacruz')
        self.assertIsNotNone(validate_password_strength('Juandelacruz1!', user=user))

    def test_strong_password_accepted(self):
        self.assertIsNone(validate_password_strength('Blue-Harbor-2026!'))


class HealthCheckTests(TestCase):
    def test_health_ok(self):
        res = Client().get('/api/health/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['database'], 'connected')

    def test_health_failure_hides_error_details(self):
        with patch('attendance_fr.urls.connection.cursor',
                   side_effect=Exception('Access denied for user root@db.internal')):
            res = Client().get('/api/health/')
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.json()['database'], 'unavailable')
        self.assertNotIn('db.internal', res.content.decode())


class FrameValidationTests(TestCase):
    def test_valid_jpeg_png_webp_frames_accepted(self):
        for fmt, mime in (('JPEG', 'image/jpeg'), ('PNG', 'image/png'), ('WEBP', 'image/webp')):
            self.assertTrue(decode_frame(_data_url(_image_bytes(fmt), mime)))

    def test_invalid_base64_rejected(self):
        with self.assertRaises(InvalidImageError):
            decode_frame('data:image/jpeg;base64,not_base64!!')

    def test_non_image_rejected(self):
        with self.assertRaises(InvalidImageError):
            decode_frame(_data_url(b'hello, not an image'))

    def test_disallowed_format_rejected(self):
        with self.assertRaises(InvalidImageError):
            decode_frame(_data_url(_image_bytes('GIF'), 'image/gif'))

    @override_settings(FACE_MAX_FRAME_BYTES=1024)
    def test_oversized_frame_rejected(self):
        with self.assertRaises(InvalidImageError):
            decode_frame(_data_url(b'\xff' * 4096))

    @override_settings(FACE_MAX_FRAME_DIMENSION=100)
    def test_oversized_dimensions_rejected(self):
        with self.assertRaises(InvalidImageError):
            decode_frame(_data_url(_image_bytes('PNG', size=(200, 50)), 'image/png'))

    def test_recognize_endpoint_returns_400_for_bad_frame(self):
        from datetime import time
        from django.utils import timezone
        from core.models import Instructor, Student
        from core.models import AttendanceSession, ClassSchedule, ClassSection

        cache.clear()
        teacher_u = create_user(username='sec_t2', role='instructor', password='StrongPassword123!')
        teacher = create_instructor(user=teacher_u, faculty_id='FAC-SEC-2')
        section = create_section(name='SEC-1', teacher=teacher)
        schedule = create_schedule(section=section, day_of_week='Mon',
                                           start_time=time(8, 0), end_time=time(9, 0), room='R1')
        session = AttendanceSession.objects.create(schedule=schedule, date=timezone.localdate(),
                                                   started_by=teacher, status='open')
        client = Client()
        client.force_login(teacher_u)
        with patch('attendance_fr.api.views.face_recognition.AttendanceService.validate_session_time_window',
                   return_value=None):
            res = client.post('/api/face/recognize/', {'session_id': session.pk, 'frame': 'not-a-frame'},
                              content_type='application/json')
        self.assertEqual(res.status_code, 400)
        self.assertFalse(res.json()['success'])


class ImageUploadValidatorTests(TestCase):
    def test_valid_image_passes(self):
        validate_image_upload(SimpleUploadedFile('a.png', _image_bytes('PNG'), content_type='image/png'))

    def test_fake_image_rejected(self):
        with self.assertRaises(ValidationError):
            validate_image_upload(SimpleUploadedFile('a.jpg', b'<script>alert(1)</script>'))

    @override_settings(MAX_IMAGE_UPLOAD_BYTES=100)
    def test_large_image_rejected(self):
        with self.assertRaises(ValidationError):
            validate_image_upload(SimpleUploadedFile('a.jpg', _image_bytes('JPEG', (200, 200))))


class TokenRevocationTests(TestCase):
    """Logout really ends the session; refresh tokens are single-use."""

    def setUp(self):
        cache.clear()
        create_user(username='rev_user', role='instructor', password='StrongPassword123!')
        self.client = Client()
        res = self.client.post('/api/token/', {'username': 'rev_user', 'password': 'StrongPassword123!'},
                               content_type='application/json')
        self.access, self.refresh = res.json()['access'], res.json()['refresh']

    def tearDown(self):
        cache.clear()

    def _me(self, access):
        return self.client.get('/api/auth/me/', HTTP_AUTHORIZATION=f'Bearer {access}')

    def _refresh(self, refresh):
        return self.client.post('/api/token/refresh/', {'refresh': refresh}, content_type='application/json')

    def test_logout_revokes_access_and_refresh(self):
        self.assertEqual(self._me(self.access).status_code, 200)
        res = self.client.post('/api/auth/logout/', {'refresh': self.refresh}, content_type='application/json',
                               HTTP_AUTHORIZATION=f'Bearer {self.access}')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['revoked'], 2)

        self.assertEqual(self._me(self.access).status_code, 401)
        self.assertEqual(self._refresh(self.refresh).status_code, 401)

    def test_revocation_survives_cache_loss(self):
        self.client.post('/api/auth/logout/', {'refresh': self.refresh}, content_type='application/json',
                         HTTP_AUTHORIZATION=f'Bearer {self.access}')
        cache.clear()  # e.g. another worker / restart: the database is the source of truth
        self.assertEqual(self._me(self.access).status_code, 401)

    def test_refresh_token_is_single_use(self):
        first = self._refresh(self.refresh)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self._refresh(self.refresh).status_code, 401)  # replay rejected
        self.assertEqual(self._refresh(first.json()['refresh']).status_code, 200)  # rotated one works

    def test_logout_with_garbage_is_harmless(self):
        res = self.client.post('/api/auth/logout/', {'refresh': 'garbage'}, content_type='application/json',
                               HTTP_AUTHORIZATION='Bearer garbage')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()['revoked'], 0)
        self.assertEqual(self._me(self.access).status_code, 200)


class FlexibleLoginTests(TestCase):
    """Login works with username, Faculty ID, Student ID, or email (any case, trimmed)."""

    def setUp(self):
        cache.clear()
        from core.models import Instructor, Student
        self.teacher_u = create_user(
            username='jdelacruz', email='juan@school.edu', role='instructor', password='StrongPassword123!')
        create_instructor(user=self.teacher_u, faculty_id='FAC-0042')
        self.student_u = create_user(
            username='231000000500', role='student', password='StrongPassword123!')
        create_student(user=self.student_u, student_id='231000000500')

    def tearDown(self):
        cache.clear()

    def _login(self, identifier, password='StrongPassword123!'):
        return Client().post('/api/token/', {'username': identifier, 'password': password},
                             content_type='application/json')

    def test_faculty_can_use_username_faculty_id_or_email(self):
        for identifier in ('jdelacruz', 'JDelaCruz', ' jdelacruz ', 'FAC-0042', 'fac-0042', 'juan@school.edu'):
            self.assertEqual(self._login(identifier).status_code, 200, identifier)

    def test_student_can_use_student_id(self):
        self.assertEqual(self._login('231000000500').status_code, 200)

    def test_wrong_password_still_rejected(self):
        self.assertEqual(self._login('FAC-0042', 'WrongPassword1!').status_code, 401)

    def test_inactive_user_rejected(self):
        self.teacher_u.is_active = False
        self.teacher_u.save()
        self.assertEqual(self._login('FAC-0042').status_code, 401)

    def test_ambiguous_email_is_refused(self):
        create_user(username='other', email='juan@school.edu', role='instructor',
                                       password='StrongPassword123!')
        self.assertEqual(self._login('juan@school.edu').status_code, 401)

    def test_faculty_username_is_faculty_id(self):
        from attendance_fr.api.services.users import UserService
        user = UserService.create_user({
            'username': 'ignored', 'role': 'instructor', 'first_name': 'Maria', 'last_name': 'Reyes',
            'email': 'maria@school.edu', 'password': 'Blue-Harbor-2026!', 'faculty_id': '  FAC-0077 ',
        })
        self.assertEqual(user.username, 'FAC-0077')
        self.assertEqual(user.instructor.faculty_id, 'FAC-0077')
        self.assertEqual(self._login('FAC-0077', 'Blue-Harbor-2026!').status_code, 200)

    def test_blank_faculty_id_is_auto_assigned_and_used_as_username(self):
        from attendance_fr.api.services.users import UserService
        user = UserService.create_user({
            'role': 'instructor', 'first_name': 'Ana', 'last_name': 'Cruz',
            'email': 'ana@school.edu', 'password': 'Blue-Harbor-2026!',
        })
        self.assertEqual(user.username, 'FAC-0043')  # next after FAC-0042
        self.assertEqual(user.instructor.faculty_id, 'FAC-0043')

    def test_student_username_is_student_id(self):
        from attendance_fr.api.services.users import UserService
        user = UserService.create_user({
            'username': 'ignored', 'role': 'student', 'student_id': '231000000600',
            'first_name': 'Leo', 'last_name': 'Tan', 'password': 'Blue-Harbor-2026!',
        })
        self.assertEqual(user.username, '231000000600')

    def test_editing_faculty_id_updates_username(self):
        from attendance_fr.api.services.users import UserService
        UserService.update_user(self.teacher_u, {'faculty_id': 'FAC-0099'})
        self.teacher_u.refresh_from_db()
        self.assertEqual(self.teacher_u.username, 'FAC-0099')

    def test_duplicate_faculty_id_rejected(self):
        from attendance_fr.api.services.users import UserService
        with self.assertRaises(ValueError):
            UserService.create_user({
                'role': 'instructor', 'first_name': 'X', 'last_name': 'Y', 'email': 'x@school.edu',
                'password': 'Blue-Harbor-2026!', 'faculty_id': 'fac-0042',
            })


@override_settings(AUTH_PROXY_SECRET='test-proxy-secret', AUTH_PROXY_REQUIRED=True)
class CookieAuthViaProxyTests(TestCase):
    """Browser login through the Cloudflare Pages proxy: refresh token only in an httpOnly cookie."""

    ORIGIN = 'http://localhost:5173'  # in the default CORS/CSRF allow-list

    def setUp(self):
        cache.clear()
        caches['security'].clear()
        create_user(username='cookie_user', role='instructor', password='StrongPassword123!')
        self.client = Client()

    def tearDown(self):
        cache.clear()
        caches['security'].clear()

    def _proxy(self, **extra):
        headers = {'HTTP_X_PROXY_SECRET': 'test-proxy-secret', 'HTTP_X_CLIENT_IP': '203.0.113.7',
                   'HTTP_ORIGIN': self.ORIGIN, 'HTTP_X_AUTH_MODE': 'cookie'}
        headers.update(extra)
        return headers

    def _login(self, password='StrongPassword123!', **extra):
        return self.client.post('/api/token/', {'username': 'cookie_user', 'password': password},
                                content_type='application/json', **self._proxy(**extra))

    def test_login_sets_httponly_cookie_and_keeps_refresh_out_of_body(self):
        res = self._login()
        self.assertEqual(res.status_code, 200)
        self.assertIn('access', res.json())
        self.assertNotIn('refresh', res.json())
        cookie = res.cookies['attendfr_refresh']
        self.assertTrue(cookie['httponly'])
        self.assertEqual(cookie['samesite'], 'Strict')
        self.assertEqual(cookie['path'], '/api/')

    def test_refresh_from_cookie_rotates_cookie_and_never_returns_it(self):
        self._login()
        res = self.client.post('/api/token/refresh/', {}, content_type='application/json', **self._proxy())
        self.assertEqual(res.status_code, 200)
        self.assertIn('access', res.json())
        self.assertNotIn('refresh', res.json())  # a script can't extract it through this endpoint
        self.assertIn('attendfr_refresh', res.cookies)

    def test_cookie_refresh_from_foreign_origin_is_refused(self):
        self._login()
        res = self.client.post('/api/token/refresh/', {}, content_type='application/json',
                               **self._proxy(HTTP_ORIGIN='https://evil.example'))
        self.assertEqual(res.status_code, 403)

    def test_logout_revokes_cookie_session(self):
        self._login()
        old_cookie = self.client.cookies['attendfr_refresh'].value
        res = self.client.post('/api/auth/logout/', {}, content_type='application/json', **self._proxy())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.cookies['attendfr_refresh'].value, '')  # deleted
        self.client.cookies['attendfr_refresh'] = old_cookie
        again = self.client.post('/api/token/refresh/', {}, content_type='application/json', **self._proxy())
        self.assertEqual(again.status_code, 401)

    def test_token_endpoints_require_the_proxy(self):
        res = self.client.post('/api/token/', {'username': 'cookie_user', 'password': 'StrongPassword123!'},
                               content_type='application/json')
        self.assertEqual(res.status_code, 403)
        wrong = self._login(HTTP_X_PROXY_SECRET='wrong')
        self.assertEqual(wrong.status_code, 403)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=3)
    def test_lockout_uses_the_real_client_ip_from_the_proxy(self):
        """Different users behind Cloudflare must not share one lockout bucket."""
        for _ in range(3):
            self._login(password='wrong', HTTP_X_CLIENT_IP='198.51.100.1')
        self.assertEqual(self._login(password='wrong', HTTP_X_CLIENT_IP='198.51.100.1').status_code, 429)
        # Same account from another real IP is not blocked by that pair lock.
        self.assertEqual(self._login(HTTP_X_CLIENT_IP='198.51.100.2').status_code, 200)

    def test_client_ip_header_is_ignored_without_the_secret(self):
        from rest_framework.test import APIRequestFactory
        from attendance_fr.api.views.auth import LoginRateThrottle
        request = APIRequestFactory().post('/api/token/', HTTP_X_CLIENT_IP='1.2.3.4', REMOTE_ADDR='10.0.0.1')
        self.assertEqual(LoginRateThrottle().get_ident(request), '10.0.0.1')
