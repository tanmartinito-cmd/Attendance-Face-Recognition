"""
The normalized schema behind the unchanged API: credentials vs profile, addresses and
languages as rows, meeting days as rows, class sections reading their identity from the template.
"""
import json
from datetime import time

from django.test import Client, TestCase

from accounts.models import User, UserAddress, UserLanguage, UserProfile
from core.models import ClassScheduleDay, Course, Program, SectionTemplate
from attendance_fr.tests.factories import create_instructor, create_section, create_user


class UserSchemaTests(TestCase):
    def setUp(self):
        self.admin = create_user('schema_admin', role='admin')
        self.client = Client()
        self.client.force_login(self.admin)
        program = Program.objects.create(code='CITEC', name='Computing')
        self.course = Course.objects.create(program=program, code='BSIT', name='BS IT')

    def _create_student(self):
        return self.client.post('/api/users/', json.dumps({
            'role': 'student', 'student_id': '23100000999', 'password': 'StrongPassword123!',
            'first_name': 'Ana', 'last_name': 'Reyes', 'middle_name': 'M', 'course_ref': self.course.pk,
            'year_level': 2, 'mobile_number': '09123456789', 'languages_spoken': 'English, Cebuano',
            'current_address': '12 Main St', 'permanent_address': 'Purok 3',
        }), content_type='application/json')

    def test_student_without_password_or_with_old_default_is_rejected(self):
        """No default password: every student account needs its own strong password."""
        base = {'role': 'student', 'student_id': '23100000998', 'first_name': 'Ben', 'last_name': 'Cruz',
                'course_ref': self.course.pk, 'year_level': 1}
        for password in (None, '', 'student123'):
            payload = dict(base) if password is None else {**base, 'password': password}
            res = self.client.post('/api/users/', json.dumps(payload), content_type='application/json')
            self.assertEqual(res.status_code, 400, (password, res.content))
        self.assertFalse(User.objects.filter(username='23100000998').exists())

    def test_student_payload_is_split_into_normalized_tables(self):
        res = self._create_student()
        self.assertEqual(res.status_code, 201, res.content)
        user = User.objects.get(username='23100000999')
        profile = UserProfile.objects.get(user=user)
        self.assertEqual((profile.first_name, profile.middle_name, profile.mobile_number), ('Ana', 'M', '09123456789'))
        self.assertEqual(UserAddress.objects.get(user=user, kind='current').street, '12 Main St')
        self.assertEqual(UserAddress.objects.get(user=user, kind='permanent').street, 'Purok 3')
        self.assertEqual(list(UserLanguage.objects.filter(user=user).values_list('name', flat=True)), ['English', 'Cebuano'])
        self.assertEqual(user.student.course, self.course)

    def test_api_still_returns_the_flat_shape(self):
        self._create_student()
        row = next(r for r in self.client.get('/api/students/').json() if r['student_id'] == '23100000999')
        self.assertEqual(row['user']['first_name'], 'Ana')
        self.assertEqual(row['user']['phone'], '09123456789')
        self.assertEqual(row['course'], 'BSIT')
        self.assertEqual(row['course_ref'], self.course.pk)
        self.assertEqual(row['current_address'], '12 Main St')
        self.assertEqual(row['languages_spoken'], 'English, Cebuano')

    def test_editing_languages_replaces_rows(self):
        self._create_student()
        user = User.objects.get(username='23100000999')
        res = self.client.patch(f'/api/users/{user.pk}/', json.dumps({'languages_spoken': 'Filipino'}),
                                content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(list(user.languages.values_list('name', flat=True)), ['Filipino'])

    def test_credentials_table_has_no_personal_columns(self):
        columns = {f.name for f in User._meta.concrete_fields}
        self.assertFalse(columns & {'first_name', 'last_name', 'phone', 'profile_image'})


class AcademicSchemaTests(TestCase):
    def setUp(self):
        self.admin = create_user('schema_admin2', role='admin')
        self.client = Client()
        self.client.force_login(self.admin)
        self.instructor = create_instructor(faculty_id='FAC-0100')

    def test_class_section_identity_comes_from_template(self):
        section = create_section(name='BSIT-2B', year_level=2, instructor=self.instructor)
        SectionTemplate.objects.filter(pk=section.template_id).update(name='BSIT-2C')
        data = self.client.get(f'/api/sections/{section.pk}/').json()
        self.assertEqual((data['name'], data['year_level'], data['instructor']), ('BSIT-2C', 2, self.instructor.pk))

    def test_schedule_days_are_rows_and_api_keeps_day_fields(self):
        section = create_section(name='BSIT-3A')
        res = self.client.post('/api/schedules/', json.dumps({
            'section': section.pk, 'day_of_week': 'Tue', 'day_2': 'Thu',
            'start_time': '13:00', 'end_time': '14:30', 'room': 'Lab 2',
        }), content_type='application/json')
        self.assertEqual(res.status_code, 201, res.content)
        body = res.json()
        self.assertEqual((body['day_of_week'], body['day_2'], body['days_display']), ('Tue', 'Thu', 'T/TH'))
        self.assertEqual(set(ClassScheduleDay.objects.filter(schedule_id=body['id']).values_list('day', flat=True)), {'Tue', 'Thu'})

    def test_schedule_needs_a_meeting_day(self):
        section = create_section(name='BSIT-3B')
        res = self.client.post('/api/schedules/', json.dumps({
            'section': section.pk, 'start_time': '13:00', 'end_time': '14:30', 'room': 'Lab 3',
        }), content_type='application/json')
        self.assertEqual(res.status_code, 400)

    def test_instructor_role_value(self):
        self.assertEqual(self.instructor.user.role, 'instructor')
        self.assertEqual(self.client.get('/api/users/?role=instructor').json()[0]['instructor_profile']['faculty_id'], 'FAC-0100')
