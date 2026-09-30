"""Accounts and current REST API workflow tests."""
import json

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.test import Client, TestCase
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


class AccountsFeatureTests(TestCase):
    def test_custom_user_roles(self):
        admin = User.objects.create_user(username='admin_u', role='admin', password='StrongPassword123!')
        teacher = User.objects.create_user(username='teacher_u', role='instructor', password='StrongPassword123!')
        student = User.objects.create_user(username='student_u', role='student', password='StrongPassword123!')

        self.assertTrue(admin.is_admin_role)
        self.assertFalse(admin.is_instructor_role)
        self.assertFalse(admin.is_student_role)
        self.assertTrue(teacher.is_instructor_role)
        self.assertTrue(student.is_student_role)

    def test_teacher_profile_creation(self):
        user = User.objects.create_user(
            username='prof_smith', first_name='John', last_name='Smith',
            role='instructor', password='StrongPassword123!'
        )
        teacher = create_instructor(
            user=user, faculty_id='EMP-1001', department='Computer Science',
            specialization='Artificial Intelligence'
        )
        self.assertEqual(teacher.faculty_id, 'EMP-1001')
        self.assertIn('John Smith', str(teacher))

    def test_student_profile_creation(self):
        user = User.objects.create_user(
            username='stud_doe', first_name='Jane', last_name='Doe',
            role='student', password='StrongPassword123!'
        )
        student = create_student(
            user=user, student_id='STU-2026-001', year_level=3,
            course='BS Computer Science'
        )
        self.assertEqual(student.student_id, 'STU-2026-001')
        self.assertFalse(student.is_face_enrolled)

    def test_password_validators_enforcement(self):
        with self.assertRaises(ValidationError):
            validate_password('Ab1!')
        with self.assertRaises(ValidationError):
            validate_password('lowercase@123')
        with self.assertRaises(ValidationError):
            validate_password('UPPERCASE@123')
        with self.assertRaises(ValidationError):
            validate_password('Password123')
        with self.assertRaises(ValidationError):
            validate_password('Pass@1')        # too short (min 8)
        with self.assertRaises(ValidationError):
            validate_password('Secure@Pass')   # no number
        validate_password('SecurePass2026!#')

    def test_admin_creates_teacher_through_current_api(self):
        admin = User.objects.create_user(username='super_admin', role='admin', password='StrongPassword123!')
        client = Client()
        client.force_login(admin)
        response = client.post(
            '/api/users/',
            data=json.dumps({
                'username': 'prof_newton', 'role': 'instructor', 'first_name': 'Isaac',
                'last_name': 'Newton', 'email': 'newton@attendfr.edu',
                'phone': '09123456789', 'password': 'StrongPassword123!',
                'faculty_id': 'EMP-2026-99', 'department': 'Mathematics',
                'specialization': 'Calculus',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        # Faculty login username is their Faculty ID (typed username is ignored).
        new_teacher = User.objects.get(username='EMP-2026-99')
        self.assertEqual(new_teacher.instructor.faculty_id, 'EMP-2026-99')
        self.assertEqual(new_teacher.instructor.department, 'Mathematics')

    def test_admin_creates_admin_through_current_api(self):
        admin = User.objects.create_user(username='super_admin2', role='admin', password='StrongPassword123!')
        client = Client()
        client.force_login(admin)
        response = client.post(
            '/api/users/',
            data=json.dumps({
                'username': 'admin_assistant', 'role': 'admin', 'first_name': 'Grace',
                'last_name': 'Hopper', 'email': 'hopper@attendfr.edu',
                'password': 'StrongPassword123!',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.get(username='admin_assistant').role, 'admin')

    def test_admin_creates_student_through_current_api(self):
        admin = User.objects.create_user(username='super_admin3', role='admin', password='StrongPassword123!')
        client = Client()
        client.force_login(admin)
        response = client.post(
            '/api/users/',
            data=json.dumps({
                'role': 'student', 'student_id': 'STU-API-888', 'first_name': 'Rosalind',
                'last_name': 'Franklin', 'email': 'franklin@attendfr.edu',
                'course_ref': Course.objects.create(program=Program.objects.create(code='COS', name='Sciences'), code='BS Biology', name='BS Biology').pk,
                'year_level': 2,
                'password': 'StrongPassword123!',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 201)
        student = Student.objects.get(student_id='STU-API-888')
        self.assertEqual(student.user.first_name, 'Rosalind')
        self.assertEqual(student.course.code, 'BS Biology')

    def test_non_admin_cannot_create_users_through_current_api(self):
        teacher = User.objects.create_user(username='teacher_anon', role='instructor', password='StrongPassword123!')
        create_instructor(user=teacher, faculty_id='EMP-ANON')
        client = Client()
        client.force_login(teacher)
        response = client.post(
            '/api/users/',
            data=json.dumps({'username': 'blocked', 'role': 'instructor', 'password': 'StrongPassword123!'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 403)

    def test_user_list_api_filters_by_role(self):
        admin = User.objects.create_user(username='u_admin', role='admin', password='StrongPassword123!')
        teacher = User.objects.create_user(username='u_teacher', role='instructor', password='StrongPassword123!')
        student_user = User.objects.create_user(username='u_student', role='student', password='StrongPassword123!')
        create_student(user=student_user, student_id='STU-FILTER-1')
        client = Client()
        client.force_login(admin)

        students = client.get('/api/users/?role=student')
        self.assertEqual(students.status_code, 200)
        self.assertTrue(any(item['username'] == 'u_student' for item in students.json()))
        self.assertFalse(any(item['username'] == 'u_teacher' for item in students.json()))

        teachers = client.get('/api/users/?role=instructor')
        self.assertEqual(teachers.status_code, 200)
        self.assertTrue(any(item['username'] == 'u_teacher' for item in teachers.json()))

    def test_student_creation_requires_explicit_strong_password(self):
        admin = User.objects.create_user(username='password_admin', role='admin', password='StrongPassword123!')
        client = Client()
        client.force_login(admin)
        response = client.post(
            '/api/users/',
            data=json.dumps({
                'role': 'student', 'student_id': 'STU-NO-PASSWORD',
                'first_name': 'No', 'last_name': 'Password',
            }),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('password', response.json()['error'].lower())
