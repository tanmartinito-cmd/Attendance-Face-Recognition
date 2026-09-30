"""
Course Module API Tests
Covers the standalone Course endpoints (list/create/update/delete) that now
live in their own module: attendance_fr/api/views/courses.py.
"""
from django.test import TestCase, Client
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule,
)


class CourseApiTests(TestCase):
    def setUp(self):
        self.admin = create_user(
            username='course_api_admin', role='admin', password='StrongPassword123!'
        )
        self.teacher = create_user(
            username='course_api_teacher', role='instructor', password='StrongPassword123!'
        )
        self.program = Program.objects.create(code='BSIT', name='Bachelor of Science in IT', college='CCS')
        self.client = Client()

    def test_courses_list_endpoint(self):
        """GET /api/courses/ returns the course catalog."""
        Course.objects.create(program=self.program, code='BSIT-CORE', name='IT Core')
        self.client.force_login(self.admin)
        res = self.client.get('/api/courses/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.json()), 1)

    def test_courses_list_filters_by_program(self):
        other_program = Program.objects.create(code='BSCS', name='Bachelor of Science in CS', college='CCS')
        Course.objects.create(program=self.program, code='BSIT-CORE', name='IT Core')
        Course.objects.create(program=other_program, code='BSCS-CORE', name='CS Core')

        self.client.force_login(self.admin)
        res = self.client.get(f'/api/courses/?program={self.program.pk}')
        self.assertEqual(res.status_code, 200)
        codes = {item['code'] for item in res.json()}
        self.assertEqual(codes, {'BSIT-CORE'})

    def test_admin_create_course_api(self):
        """POST /api/courses/ allows an administrator to add a Course to a Program."""
        self.client.force_login(self.admin)
        res = self.client.post(
            '/api/courses/',
            {
                'program': self.program.pk,
                'code': 'BSIT-NET',
                'name': 'Networking Track',
                'description': 'Networking specialization',
                'is_active': True,
            },
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 201)
        body = res.json()
        self.assertEqual(body['code'], 'BSIT-NET')
        self.assertTrue(Course.objects.filter(program=self.program, code='BSIT-NET').exists())

    def test_non_admin_cannot_create_course_api(self):
        """POST /api/courses/ is rejected for non-admin roles."""
        self.client.force_login(self.teacher)
        res = self.client.post(
            '/api/courses/',
            {'program': self.program.pk, 'code': 'BSIT-SEC', 'name': 'Security Track'},
            content_type='application/json',
        )
        self.assertIn(res.status_code, [401, 403])
        self.assertFalse(Course.objects.filter(code='BSIT-SEC').exists())

    def test_admin_update_course_api(self):
        """PATCH /api/courses/<id>/ updates a Course's fields."""
        course = Course.objects.create(program=self.program, code='BSIT-WEB', name='Web Track')
        self.client.force_login(self.admin)
        res = self.client.patch(
            f'/api/courses/{course.pk}/',
            {'is_active': False},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        course.refresh_from_db()
        self.assertFalse(course.is_active)

    def test_admin_delete_unused_course_api(self):
        """DELETE /api/courses/<id>/ removes a Course that has no dependents."""
        course = Course.objects.create(program=self.program, code='BSIT-TMP', name='Temp Track')
        self.client.force_login(self.admin)
        res = self.client.delete(f'/api/courses/{course.pk}/')
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Course.objects.filter(pk=course.pk).exists())
