"""
Academic & Class Management API Tests
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


class RestAcademicApiTests(TestCase):
    def setUp(self):
        self.admin = create_user(
            username='api_admin', role='admin', password='StrongPassword123!'
        )
        self.student_u = create_user(
            username='api_student', role='student', first_name='John', last_name='Nash',
            password='StrongPassword123!'
        )
        self.student = create_student(
            user=self.student_u, student_id='STU-API-101', course='BS Mathematics', year_level=3
        )
        self.program = Program.objects.create(code='CS', name='Computer Science')
        self.subject = create_subject(code='CS101', name='Intro to CS', units=3)
        self.section = create_section(name='CS-3A', program=self.program, subject=self.subject)
        self.client = Client()

    def test_programs_list_endpoint(self):
        """GET /api/programs/ returns program entities."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/programs/')
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(len(res.json()), 1)

    def test_subjects_list_endpoint(self):
        """GET /api/subjects/ returns subject catalog."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/subjects/')
        self.assertEqual(res.status_code, 200)

    def test_sections_list_endpoint(self):
        """GET /api/sections/ returns active sections."""
        self.client.force_login(self.admin)
        res = self.client.get('/api/sections/')
        self.assertEqual(res.status_code, 200)


    def test_admin_create_section_api(self):
        """POST /api/sections/ allows administrator to register sections."""
        # Create Course and SectionTemplate (ClassSection Catalog definition) first
        from core.models import Course, SectionTemplate
        course = Course.objects.create(
            program=self.program,
            code='BSCS',
            name='Bachelor of Science in Computer Science'
        )
        prog_section = create_template(
            program=self.program,
            course_ref=course,
            name='CS-4B',
            year_level=4,
            description='Computer Science 4th Year ClassSection B'
        )
        
        self.client.force_login(self.admin)
        res = self.client.post(
            '/api/sections/',
            {
                'name': 'CS-4B',  # Will be overridden by program_section.name on save
                'program_section': prog_section.pk,
                'school_year': '2025-2026',
                'semester': '1st',
            },
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 201)

    def test_admin_enroll_student_in_section(self):
        """POST /api/sections/<id>/enrollments/ enrolls student in section."""
        self.client.force_login(self.admin)
        res = self.client.post(
            f'/api/sections/{self.section.pk}/enrollments/',
            {'student_id': self.student.pk},
            content_type='application/json'
        )
        self.assertIn(res.status_code, [200, 201])
        self.assertTrue(Enrollment.objects.filter(student=self.student, section=self.section).exists())

    def test_student_sections_list_is_scoped_to_enrollments(self):
        """Students only see sections they are enrolled in."""
        other_section = create_section(name='CS-4Z', program=self.program, subject=self.subject)
        enroll(student=self.student, section=self.section)

        self.client.force_login(self.student_u)
        res = self.client.get('/api/sections/')
        self.assertEqual(res.status_code, 200)
        section_ids = {item['id'] for item in res.json()}
        self.assertEqual(section_ids, {self.section.pk})
        self.assertNotIn(other_section.pk, section_ids)

    def test_student_schedules_list_is_scoped_to_enrollments(self):
        """Students only see schedules for enrolled sections/subjects."""
        other_section = create_section(name='CS-4Z', program=self.program, subject=self.subject)
        enrolled_schedule = create_schedule(
            section=self.section,
            subject=self.subject,
            day_of_week='Mon',
            start_time='08:00',
            end_time='09:30',
            room='101',
        )
        create_schedule(
            section=other_section,
            subject=self.subject,
            day_of_week='Tue',
            start_time='10:00',
            end_time='11:30',
            room='102',
        )
        enroll(student=self.student, section=self.section)

        self.client.force_login(self.student_u)
        res = self.client.get('/api/schedules/')
        self.assertEqual(res.status_code, 200)
        schedule_ids = {item['id'] for item in res.json()}
        self.assertEqual(schedule_ids, {enrolled_schedule.pk})

    def test_student_cannot_view_unenrolled_section_detail(self):
        """Students cannot fetch section detail for classes they are not enrolled in."""
        other_section = create_section(name='CS-4Z', program=self.program, subject=self.subject)
        self.client.force_login(self.student_u)
        res = self.client.get(f'/api/sections/{other_section.pk}/')
        self.assertEqual(res.status_code, 404)


class AcademicDeactivationTests(TestCase):
    """Programs, catalog sections, class sections and subjects can be temporarily deactivated."""

    def setUp(self):
        from core.models import Course, SectionTemplate
        self.admin = create_user(username='deact_admin', role='admin', password='StrongPassword123!')
        self.program = Program.objects.create(code='DX', name='Deactivation Program')
        self.course = Course.objects.create(program=self.program, code='BSDX', name='BS Deactivation')
        self.catalog = create_template(program=self.program, course_ref=self.course, name='DX-1A', year_level=1)
        self.subject = create_subject(code='DX101', name='Deactivation 101')
        # Legacy section without a catalog link: a status-only PATCH must still work.
        self.section = create_section(name='DX-LEGACY', program=self.program, subject=self.subject)
        self.client = Client()
        self.client.force_login(self.admin)

    def _patch(self, url, data):
        return self.client.patch(url, data, content_type='application/json')

    def test_status_only_patch_toggles_each_entity(self):
        cases = [
            (f'/api/programs/{self.program.pk}/', self.program),
            (f'/api/program-sections/{self.catalog.pk}/', self.catalog),
            (f'/api/sections/{self.section.pk}/', self.section),
            (f'/api/subjects/{self.subject.pk}/', self.subject),
        ]
        for url, obj in cases:
            res = self._patch(url, {'is_active': False})
            self.assertEqual(res.status_code, 200, (url, res.content))
            self.assertFalse(res.json()['is_active'])
            obj.refresh_from_db()
            self.assertFalse(obj.is_active)

    def test_catalog_definition_can_be_edited(self):
        res = self._patch(f'/api/program-sections/{self.catalog.pk}/', {
            'program': self.program.pk, 'course_ref': self.course.pk, 'name': 'DX-1B', 'year_level': 2,
        })
        self.assertEqual(res.status_code, 200, res.content)
        self.catalog.refresh_from_db()
        self.assertEqual((self.catalog.name, self.catalog.year_level), ('DX-1B', 2))

    def test_attendance_cannot_start_for_deactivated_section(self):
        from attendance_fr.api.services.attendance import AttendanceService
        from datetime import time
        schedule = create_schedule(
            section=self.section, subject=self.subject, day_of_week='Mon',
            start_time=time(8, 0), end_time=time(9, 0), room='R1',
        )
        self.assertIsNone(AttendanceService.inactive_offering_error(schedule))
        self.section.is_active = False
        self.section.save(update_fields=['is_active'])
        schedule.refresh_from_db()
        self.assertIn('temporarily deactivated', AttendanceService.inactive_offering_error(schedule))
