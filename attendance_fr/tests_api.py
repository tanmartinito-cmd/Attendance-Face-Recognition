"""
AttendFR Centralized REST API Test Suite.
Validates all JWT authentication, academic resources, attendance sessions, and biometric endpoints.
"""
import io
import json
import base64
from datetime import time
from unittest.mock import patch
from PIL import Image

from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from django.utils import timezone
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule, schedule_window_around_now,
)


User = get_user_model()


class RestAuthenticationApiTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username='api_teacher',
            email='teacher@attendfr.edu',
            role='instructor',
            first_name='Marie',
            last_name='Curie',
            password='StrongPassword123!'
        )
        self.teacher = create_instructor(
            user=self.user,
            faculty_id='EMP-API-01',
            department='Physics'
        )
        self.client = Client()

    def test_jwt_token_pair_generation(self):
        """POST /api/token/ generates JWT access & refresh tokens."""
        res = self.client.post(
            '/api/token/',
            {'username': 'api_teacher', 'password': 'StrongPassword123!'},
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn('access', data)
        self.assertIn('refresh', data)

    def test_jwt_token_refresh_cycle(self):
        """POST /api/token/refresh/ cycles and grants fresh access token."""
        token_res = self.client.post(
            '/api/token/',
            {'username': 'api_teacher', 'password': 'StrongPassword123!'},
            content_type='application/json'
        )
        refresh_token = token_res.json()['refresh']

        res = self.client.post(
            '/api/token/refresh/',
            {'refresh': refresh_token},
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn('access', res.json())

    def test_authenticated_user_profile(self):
        """GET /api/auth/me/ returns authenticated user role and profile details."""
        token_res = self.client.post(
            '/api/token/',
            {'username': 'api_teacher', 'password': 'StrongPassword123!'},
            content_type='application/json'
        )
        access_token = token_res.json()['access']

        res = self.client.get(
            '/api/auth/me/',
            HTTP_AUTHORIZATION=f'Bearer {access_token}'
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get('username'), 'api_teacher')
        self.assertEqual(data.get('role'), 'instructor')
        self.assertIn('instructor_profile', data)


class RestAcademicApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='api_admin', role='admin', password='StrongPassword123!'
        )
        self.student_u = User.objects.create_user(
            username='api_student', role='student', first_name='John', last_name='Nash',
            password='StrongPassword123!'
        )
        self.student = create_student(
            user=self.student_u, student_id='STU-API-101', course='BS Mathematics', year_level=3
        )
        self.program = Program.objects.create(code='CS', name='Computer Science')
        self.subject = create_subject(code='CS201', name='Data Structures', units=3)
        self.section = create_section(
            name='CS-2A', program=self.program, subject=self.subject
        )
        self.schedule = create_schedule(
            section=self.section, day_of_week='Mon',
            start_time=time(9, 0), end_time=time(11, 0), room='Lab 4'
        )
        self.client = Client()

    def test_subject_catalog_api(self):
        """GET /api/subjects/ returns active subject catalog."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/subjects/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(len(data), 1)

    def test_section_catalog_api(self):
        """GET /api/sections/ returns section roster definitions."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/sections/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(len(data), 1)

    def test_program_course_subject_relationship_api(self):
        """Program owns Courses and Subjects can be assigned to a Course."""
        self.client.force_login(self.admin)
        course_res = self.client.post(
            '/api/courses/',
            json.dumps({
                'program': self.program.pk,
                'code': 'BSCS',
                'name': 'Bachelor of Science in Computer Science',
                'is_active': True,
            }),
            content_type='application/json',
        )
        self.assertEqual(course_res.status_code, 201)
        course = course_res.json()
        self.assertEqual(course['program'], self.program.pk)
        # The class section is offered for this course (a subject must match its section's course).
        SectionTemplate.objects.filter(pk=self.section.template_id).update(course_id=course['id'])

        subject_res = self.client.patch(
            f'/api/subjects/{self.subject.pk}/',
            json.dumps({
                'program': self.program.pk,
                'course_ref': course['id'],
                'section': self.section.pk,
            }),
            content_type='application/json',
        )
        self.assertEqual(subject_res.status_code, 200)
        self.assertEqual(subject_res.json()['course_ref'], course['id'])
        self.assertEqual(subject_res.json()['course_details']['code'], 'BSCS')

        courses_res = self.client.get(f'/api/courses/?program={self.program.pk}')
        self.assertEqual(courses_res.status_code, 200)
        self.assertEqual(courses_res.json()[0]['code'], 'BSCS')

    def test_section_catalog_requires_course_and_class_section_uses_catalog(self):
        """Catalog courses come from Course Management and offerings inherit catalog identity."""
        self.client.force_login(self.admin)
        course = Course.objects.create(program=self.program, code='BSIT', name='Information Technology')

        catalog_res = self.client.post(
            '/api/program-sections/',
            json.dumps({
                'program': self.program.pk,
                'course_ref': course.pk,
                'name': 'IT-43',
                'year_level': 3,
            }),
            content_type='application/json',
        )
        self.assertEqual(catalog_res.status_code, 201)
        catalog = catalog_res.json()
        self.assertEqual(catalog['course_ref'], course.pk)
        self.assertEqual(catalog['course_details']['code'], 'BSIT')

        section_res = self.client.post(
            '/api/sections/',
            json.dumps({
                'program_section': catalog['id'],
                'program': self.program.pk,
                'course_ref': course.pk,
                'name': 'MANUAL-NAME',
                'year_level': 1,
                'school_year': '2025-2026',
                'semester': '1st',
            }),
            content_type='application/json',
        )
        self.assertEqual(section_res.status_code, 201)
        self.assertEqual(section_res.json()['name'], 'IT-43')
        self.assertEqual(section_res.json()['year_level'], 3)

    def test_section_catalog_rejects_course_from_another_program(self):
        """A catalog definition cannot connect a Program to another Program's Course."""
        self.client.force_login(self.admin)
        other_program = Program.objects.create(code='NURS', name='Nursing')
        other_course = Course.objects.create(program=other_program, code='BSN', name='Nursing')

        response = self.client.post(
            '/api/program-sections/',
            json.dumps({
                'program': self.program.pk,
                'course_ref': other_course.pk,
                'name': 'INVALID',
                'year_level': 1,
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('course_ref', response.json())

    def test_section_creation_requires_catalog_definition(self):
        """Class Sections cannot be created from a manually typed section name."""
        self.client.force_login(self.admin)
        response = self.client.post(
            '/api/sections/',
            json.dumps({'name': 'MANUAL-ONLY', 'program': self.program.pk}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('program_section', response.json())

    def test_schedule_matrix_api(self):
        """GET /api/schedules/ returns scheduled timeslots."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/schedules/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertGreaterEqual(len(data), 1)

    def test_section_enrollment_rejects_mismatched_course(self):
        """A student cannot be enrolled into a ClassSection from another Course."""
        course_a = Course.objects.create(program=self.program, code='COURSE-A', name='Course A')
        course_b = Course.objects.create(program=self.program, code='COURSE-B', name='Course B')
        self.student.course = course_a
        self.student.save(update_fields=['course'])
        self.section.template.course = course_b
        self.section.template.save(update_fields=['course'])

        self.client.force_login(self.admin)
        res = self.client.post(
            f'/api/sections/{self.section.pk}/enrollments/',
            {'student_id': self.student.pk},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn('student_id', res.json())

    def test_student_search_api(self):
        """GET /api/students/?search= uses the current student list endpoint."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/students/?search=Nash')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['student_id'], 'STU-API-101')

    def test_section_enrollment_api_permissions(self):
        """POST /api/sections/<id>/enrollments/ enforces administrator access."""
        self.client.force_login(self.student_u)
        res_denied = self.client.post(
            f'/api/sections/{self.section.pk}/enrollments/',
            {'student_id': self.student.pk},
            content_type='application/json',
        )
        self.assertEqual(res_denied.status_code, 403)

        self.client.force_login(self.admin)
        res_ok = self.client.post(
            f'/api/sections/{self.section.pk}/enrollments/',
            {'student_id': self.student.pk},
            content_type='application/json',
        )
        self.assertIn(res_ok.status_code, [200, 201])
        self.assertEqual(res_ok.json()['student'], self.student.pk)


class RestAttendanceBiometricsApiTests(TestCase):
    def setUp(self):
        self.admin = User.objects.create_user(
            username='api_bio_admin', role='admin', password='StrongPassword123!'
        )
        self.teacher_u = User.objects.create_user(
            username='api_bio_teacher', role='instructor', password='StrongPassword123!'
        )
        self.teacher = create_instructor(user=self.teacher_u, faculty_id='EMP-BIO-1')

        self.student_u = User.objects.create_user(
            username='api_bio_student', role='student', first_name='Ada', last_name='Lovelace',
            password='StrongPassword123!'
        )
        self.student = create_student(
            user=self.student_u, student_id='STU-BIO-001', course='BSCS', year_level=2
        )
        self.program = Program.objects.create(code='IT', name='Info Tech')
        self.subject = create_subject(code='IT101', name='Intro to Computing', units=3)
        self.section = create_section(
            name='IT-1A', program=self.program, subject=self.subject, teacher=self.teacher
        )
        # A class running right now (clamped to today so it never wraps past midnight)
        today_code, start_t, end_t = schedule_window_around_now()

        self.schedule = create_schedule(
            section=self.section, day_of_week=today_code,
            start_time=start_t, end_time=end_t, room='Room 303'
        )
        enroll(student=self.student, section=self.section)
        self.client = Client()

    def test_system_health_probe_api(self):
        """GET /api/health/ verifies database and service health status."""
        res = self.client.get('/api/health/')
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data.get('status'), 'healthy')
        self.assertEqual(data.get('database'), 'connected')

    def test_attendance_sessions_list_api(self):
        """GET /api/attendance/sessions/ queries historical and active sessions."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/attendance/sessions/')
        self.assertEqual(res.status_code, 200)

    def test_attendance_session_start_api(self):
        """POST /api/attendance/sessions/start/ launches live session for assigned schedule within class hours."""
        # Skip test on Sunday since ClassSchedule model doesn't support Sunday classes
        from datetime import datetime
        if datetime.now().weekday() == 6:  # Sunday
            self.skipTest("Attendance tests don't run on Sunday (no Sunday classes in schedule)")
        
        self.client.force_login(self.teacher_u)
        res = self.client.post(
            '/api/attendance/sessions/start/',
            {'schedule_id': self.schedule.pk},
            content_type='application/json'
        )
        if res.status_code == 409:  # the class began a while ago: the instructor must choose
            self.assertEqual(res.json()['code'], 'late_start')
            res = self.client.post(
                '/api/attendance/sessions/start/',
                {'schedule_id': self.schedule.pk, 'start_mode': 'present'},
                content_type='application/json'
            )
        self.assertIn(res.status_code, [200, 201])
        data = res.json()
        self.assertEqual(data.get('status'), 'open')

    def test_attendance_session_start_outside_schedule_window(self):
        """Teacher cannot start attendance session outside scheduled day/time."""
        other_day = 'Tue' if self.schedule.day_of_week != 'Tue' else 'Wed'
        off_schedule = create_schedule(
            section=self.section, day_of_week=other_day,
            start_time=time(1, 0), end_time=time(2, 0), room='Room 303'
        )
        self.client.force_login(self.teacher_u)
        res = self.client.post(
            '/api/attendance/sessions/start/',
            {'schedule_id': off_schedule.pk},
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 403)
        self.assertIn('cannot be started', res.json().get('error', ''))

    def test_attendance_session_close_api(self):
        """POST /api/attendance/sessions/{id}/close/ finalizes session roster."""
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='open'
        )
        # Closing is reserved for the session's teacher (admins get 403, see test_authorization)
        self.client.force_login(self.teacher_u)
        res = self.client.post(f'/api/attendance/sessions/{session.pk}/close/')
        self.assertEqual(res.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.status, 'closed')

    def test_face_recognition_match_api(self):
        """POST /api/face/recognize/ matches vectors against section enrollment cache."""
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='open'
        )
        self.client.force_login(self.teacher_u)

        mock_vector = [0.15] * 128
        with patch('face_app.services.face_service.FaceService.recognize_all_faces_in_frame', return_value={
            'faces': [{'student_id': self.student.pk, 'name': 'Ada Lovelace', 'confidence': 0.95}],
            'recognized': True
        }):
            res = self.client.post(
                '/api/face/recognize/',
                {'session_id': session.pk, 'frame': self._tiny_jpeg_b64()},
                content_type='application/json'
            )
            self.assertEqual(res.status_code, 200)

    @staticmethod
    def _tiny_jpeg_b64():
        buf = io.BytesIO()
        Image.new('RGB', (40, 40), color='white').save(buf, format='JPEG')
        return 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('utf-8')

    def test_face_enrollment_api(self):
        """POST /api/face/enroll/ persists face enrollment through the current API."""
        self.client.force_login(self.admin)

        buf = io.BytesIO()
        im = Image.new('RGB', (40, 40), color='white')
        im.save(buf, format='JPEG')
        valid_b64 = 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode('utf-8')

        mock_vector = [0.33] * 128
        with patch('attendance_fr.api.services.face_recognition.FaceEnrollService.enroll_student_face', return_value='Face enrolled successfully.'):
            payload = {'student_id': self.student.pk, 'frame': valid_b64}
            res = self.client.post('/api/face/enroll/', payload, content_type='application/json')
            self.assertEqual(res.status_code, 200)
            self.assertTrue(res.json().get('success'))
