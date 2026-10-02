"""
Core Feature Tests:
Tests academic structures, 1-to-many teacher sections,
schedule conflict validation, attendance session lifecycle,
dynamic late detection, and API health check.
"""
from datetime import time, timedelta
import unittest
from django.test import TestCase, Client
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.utils import timezone
from core.services.schedule_service import ScheduleService
from core.services.attendance_service import AttendanceService
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


class CoreFeatureTests(TestCase):
    def setUp(self):
        # Create users
        self.admin_user = User.objects.create_user(
            username='admin_boss', first_name='Admin', last_name='Boss',
            role='admin', password='StrongPassword123!'
        )
        self.teacher_user = User.objects.create_user(
            username='prof_albert', first_name='Albert', last_name='Einstein',
            role='instructor', password='StrongPassword123!'
        )
        self.teacher = create_instructor(
            user=self.teacher_user, faculty_id='TCH-001', department='Physics'
        )

        self.student_user = User.objects.create_user(
            username='stud_marie', first_name='Marie', last_name='Curie',
            role='student', password='StrongPassword123!'
        )
        self.student = create_student(
            user=self.student_user, student_id='STU-2026-002', year_level=2
        )

        # Create Subject
        self.subject = create_subject(
            name='Data Structures & Algorithms',
            code='CS201',
            units=3
        )

        # Create ClassSection
        self.section_a = create_section(
            name='BSCS-2A',
            subject=self.subject,
            teacher=self.teacher
        )

    def test_teacher_can_have_many_sections(self):
        """Verify 1 teacher to many sections relationship."""
        section_b = create_section(
            name='BSCS-2B',
            subject=self.subject,
            teacher=self.teacher
        )
        teacher_sections = self.teacher.class_sections.all()
        self.assertEqual(teacher_sections.count(), 2)
        self.assertIn(self.section_a, teacher_sections)
        self.assertIn(section_b, teacher_sections)

    def test_schedule_invalid_time_raises_error(self):
        """Verify end_time must be after start_time."""
        sched = build_schedule(
            section=self.section_a,
            day_of_week='Mon',
            start_time=time(10, 0),
            end_time=time(9, 0),  # End time before start time
            room='Lab 1'
        )
        with self.assertRaises(ValidationError):
            sched.full_clean()

    def test_schedule_room_conflict_rejected(self):
        """Verify two sections cannot book the same room at overlapping times."""
        # ClassSection A: Mon 08:00 - 10:00 @ Room 301
        create_schedule(
            section=self.section_a,
            day_of_week='Mon',
            start_time=time(8, 0),
            end_time=time(10, 0),
            room='Room 301'
        )

        # ClassSection B: Mon 09:00 - 11:00 @ Room 301 (Overlaps 09:00-10:00)
        section_b = create_section(name='BSCS-2B', subject=self.subject)
        conflicting_sched = build_schedule(
            section=section_b,
            day_of_week='Mon',
            start_time=time(9, 0),
            end_time=time(11, 0),
            room='Room 301'
        )

        with self.assertRaises(ValidationError) as ctx:
            conflicting_sched.full_clean()
        self.assertIn("Room conflict", str(ctx.exception))

    def test_schedule_teacher_conflict_rejected(self):
        """Verify teacher cannot be scheduled in two sections at overlapping times."""
        # ClassSection A: Tue 13:00 - 15:00 with Teacher Einstein
        create_schedule(
            section=self.section_a,
            day_of_week='Tue',
            start_time=time(13, 0),
            end_time=time(15, 0),
            room='Room 101'
        )

        # ClassSection B: Tue 14:00 - 16:00 with SAME Teacher Einstein in different room
        section_b = create_section(
            name='BSCS-2B', subject=self.subject, teacher=self.teacher
        )
        conflicting_sched = build_schedule(
            section=section_b,
            day_of_week='Tue',
            start_time=time(14, 0),
            end_time=time(16, 0),
            room='Room 202'
        )

        with self.assertRaises(ValidationError) as ctx:
            conflicting_sched.full_clean()
        self.assertIn("Instructor conflict", str(ctx.exception))

    def test_schedule_non_overlapping_allowed(self):
        """Verify non-overlapping schedules save successfully."""
        sched1 = create_schedule(
            section=self.section_a,
            day_of_week='Wed',
            start_time=time(8, 0),
            end_time=time(10, 0),
            room='Room 101'
        )
        sched2 = create_schedule(
            section=self.section_a,
            day_of_week='Wed',
            start_time=time(10, 0),
            end_time=time(12, 0),
            room='Room 101'
        )
        self.assertIsNotNone(sched1.pk)
        self.assertIsNotNone(sched2.pk)

    def test_dynamic_late_status_calculation(self):
        """Verify dynamic late status: present within threshold, late after threshold."""
        schedule = create_schedule(
            section=self.section_a,
            day_of_week='Thu',
            start_time=time(8, 0),
            end_time=time(10, 0),
            room='Room 404'
        )
        session_date = timezone.localdate()
        session = AttendanceSession.objects.create(
            schedule=schedule,
            date=session_date,
            started_by=self.teacher
        )

        start_dt = timezone.make_aware(
            timezone.datetime.combine(session_date, time(8, 0))
        )

        # Scan at 08:10 (10 mins in, threshold is 15 mins) -> PRESENT
        on_time = start_dt + timedelta(minutes=10)
        status_on_time = AttendanceService.calculate_attendance_status(session, scan_time=on_time)
        self.assertEqual(status_on_time, 'present')

        # Scan at 08:25 (25 mins in, threshold is 15 mins) -> LATE
        late_time = start_dt + timedelta(minutes=25)
        status_late = AttendanceService.calculate_attendance_status(session, scan_time=late_time)
        self.assertEqual(status_late, 'late')

    def test_attendance_service_mark_attendance(self):
        """Verify AttendanceService creates or updates record and avoids duplicate mark."""
        schedule = create_schedule(
            section=self.section_a,
            day_of_week='Fri',
            start_time=time(9, 0),
            end_time=time(11, 0),
            room='Room 501'
        )
        session = AttendanceSession.objects.create(
            schedule=schedule,
            date=timezone.localdate(),
            started_by=self.teacher
        )
        enroll(student=self.student, section=self.section_a)

        # Mark attendance first time
        record, is_new = AttendanceService.mark_attendance(session, self.student, confidence=0.95)
        self.assertTrue(is_new)
        self.assertIn(record.status, ['present', 'late'])

        # Mark second time (e.g. repeated face scan)
        record2, is_new2 = AttendanceService.mark_attendance(session, self.student, confidence=0.98)
        self.assertFalse(is_new2)
        self.assertEqual(record.pk, record2.pk)

    def test_health_check_api_endpoint(self):
        """Verify /api/health/ returns 200 and healthy status."""
        client = Client()
        response = client.get('/api/health/')
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data.get('status'), 'healthy')
        self.assertEqual(data.get('database'), 'connected')

    def test_jwt_token_and_auth_me_api(self):
        """Verify POST /api/token/ and GET /api/auth/me/ with Bearer token."""
        client = Client()
        # Request JWT tokens
        res = client.post(
            '/api/token/',
            {'username': 'prof_albert', 'password': 'StrongPassword123!'},
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn('access', data)
        self.assertIn('refresh', data)

        access_token = data['access']

        # Request protected user profile endpoint with Bearer token
        res_me = client.get(
            '/api/auth/me/',
            HTTP_AUTHORIZATION=f'Bearer {access_token}'
        )
        self.assertEqual(res_me.status_code, 200)
        user_data = res_me.json()
        self.assertEqual(user_data.get('username'), 'prof_albert')
        self.assertEqual(user_data.get('role'), 'instructor')
        self.assertIn('instructor_profile', user_data)

    def test_dynamic_schedule_display_formatting(self):
        """Verify dynamic schedule display handles M-TH grouping and individual days."""
        # Empty schedules
        self.assertEqual(self.section_a.schedule_display, "No schedule set")

        # Single day
        create_schedule(
            section=self.section_a, day_of_week='Mon',
            start_time=time(8, 0), end_time=time(9, 30), room='Room 101'
        )
        self.assertEqual(self.section_a.schedule_display, "M 08:00AM-09:30AM @ Room 101")

        # Additional day (Thu) at same time and room
        create_schedule(
            section=self.section_a, day_of_week='Thu',
            start_time=time(8, 0), end_time=time(9, 30), room='Room 101'
        )
        self.assertEqual(self.section_a.schedule_display, "M 08:00AM-09:30AM @ Room 101, TH 08:00AM-09:30AM @ Room 101")

    def test_fsuu_single_section_multiple_subjects_and_instructors(self):
        """Verify FSUU model: 1 ClassSection (e.g. IT-43) contains multiple dedicated subjects with separate instructors."""
        teacher2_user = User.objects.create_user(
            username='prof_subrastas', first_name='John Ray', last_name='Subrastas',
            role='instructor', password='StrongPassword123!'
        )
        teacher2 = create_instructor(user=teacher2_user, faculty_id='TCH-002', department='CITEC')

        # Single section IT-43
        sec_it43 = create_section(name='IT-43')

        # Multiple subjects dedicated to IT-43
        subj_it473 = create_subject(
            name='System Integration Architecture', code='IT 473', units=3,
            section=sec_it43, teacher=self.teacher
        )
        subj_ge119 = create_subject(
            name='Living in IT Era', code='GE 119', units=3,
            section=sec_it43, teacher=teacher2
        )
        subj_capstone = create_subject(
            name='Capstone Project', code='IT 474', units=3,
            section=sec_it43, teacher=None  # Unassigned instructor
        )

        self.assertEqual(sec_it43.subjects.count(), 3)
        self.assertIn(subj_it473, sec_it43.subjects.all())
        self.assertIn(subj_ge119, sec_it43.subjects.all())
        self.assertIn(subj_capstone, sec_it43.subjects.all())
        self.assertEqual(subj_it473.instructor, self.teacher)
        self.assertEqual(subj_ge119.instructor, teacher2)
        self.assertIsNone(subj_capstone.instructor)

    def test_irregular_student_subject_specific_attendance(self):
        """
        Verify FSUU irregular student workflow:
        A 4th year student enrolled in IT-11 for IT 101 ONLY appears in IT 101 attendance,
        and is NOT included or falsely marked absent in MATH 101.
        """
        # ClassSection IT-11
        sec_it11 = create_section(name='IT-11')
        subj_it101 = create_subject(name='Intro to Computing', code='IT 101', section=sec_it11, teacher=self.teacher)
        subj_math101 = create_subject(name='Calculus', code='MATH 101', section=sec_it11, teacher=self.teacher)

        sched_it101 = create_schedule(
            section=sec_it11, subject=subj_it101, day_of_week='Mon',
            start_time=time(8, 0), end_time=time(9, 30), room='Lab 1'
        )
        sched_math101 = create_schedule(
            section=sec_it11, subject=subj_math101, day_of_week='Tue',
            start_time=time(10, 0), end_time=time(11, 30), room='Room 301'
        )

        # 1st year regular student (regular block enrollment in IT-11: subject is NULL)
        stud1_user = User.objects.create_user(username='stud_first_year', role='student', password='StrongPassword123!')
        stud_regular = create_student(user=stud1_user, student_id='STU-2026-101', year_level=1)
        enroll(student=stud_regular, section=sec_it11, subject=None)

        # 4th year irregular student (irregular subject-specific enrollment in IT-11: subject=subj_it101)
        stud4_user = User.objects.create_user(username='stud_fourth_year_irreg', role='student', password='StrongPassword123!')
        stud_irreg = create_student(user=stud4_user, student_id='STU-2022-401', year_level=4)
        enroll(student=stud_irreg, section=sec_it11, subject=subj_it101)

        # Only the assigned teacher may start attendance (admins are read-only here).
        # The schedule-window check depends on the real clock, so it is bypassed for this test.
        from unittest.mock import patch
        window_patch = patch(
            'attendance_fr.api.views.attendance.AttendanceService.validate_schedule_time_window',
            return_value=None,
        )
        window_patch.start()
        self.addCleanup(window_patch.stop)
        client = Client()
        client.force_login(self.teacher_user)
        # Roster rules are tested here, not the late-start question: always answer "present".
        start_mode = {'start_mode': 'present'}

        # Start Attendance Session for IT 101 (API endpoint)
        res_it101 = client.post(
            '/api/attendance/sessions/start/',
            data={'schedule_id': sched_it101.pk, **start_mode},
            content_type='application/json'
        )
        self.assertEqual(res_it101.status_code, 201)
        session_it101_id = res_it101.data['id']
        session_it101 = AttendanceSession.objects.get(pk=session_it101_id)

        # Both regular student and irregular student MUST be on the roster for IT 101
        it101_roster = AttendanceRecord.objects.filter(session=session_it101)
        self.assertEqual(it101_roster.count(), 2)
        it101_students = [r.student for r in it101_roster]
        self.assertIn(stud_regular, it101_students)
        self.assertIn(stud_irreg, it101_students)

        # Start Attendance Session for MATH 101 (API endpoint)
        res_math101 = client.post(
            '/api/attendance/sessions/start/',
            data={'schedule_id': sched_math101.pk, **start_mode},
            content_type='application/json'
        )
        self.assertEqual(res_math101.status_code, 201)
        session_math101_id = res_math101.data['id']
        session_math101 = AttendanceSession.objects.get(pk=session_math101_id)

        # Regular student MUST be on roster, but irregular student MUST NOT be included in MATH 101
        math101_roster = AttendanceRecord.objects.filter(session=session_math101)
        self.assertEqual(math101_roster.count(), 1)
        self.assertEqual(math101_roster.first().student, stud_regular)
        math101_students = [r.student for r in math101_roster]
        self.assertNotIn(stud_irreg, math101_students)

    def test_section_enrollment_api_endpoints(self):
        """Verify GET/POST/DELETE on /api/sections/<pk>/enrollments/."""
        client = Client()
        client.force_login(self.admin_user)

        sec = create_section(name='IT-43')
        subj = create_subject(name='Living in IT Era', code='GE 119', section=sec)

        # 1. Enroll regular student (subject=None)
        res_reg = client.post(
            f'/api/sections/{sec.pk}/enrollments/',
            data={'student_id': self.student.pk},
            content_type='application/json'
        )
        self.assertEqual(res_reg.status_code, 201)
        self.assertIsNone(res_reg.data['subject'])
        enrollment_id = res_reg.data['id']

        # 2. List enrollments
        res_list = client.get(f'/api/sections/{sec.pk}/enrollments/')
        self.assertEqual(res_list.status_code, 200)
        self.assertEqual(len(res_list.data), 1)

        # 3. Enroll irregular student into GE 119
        stud2_user = User.objects.create_user(username='stud_irreg2', role='student', password='StrongPassword123!')
        stud2 = create_student(user=stud2_user, student_id='STU-IRREG-2')
        res_irreg = client.post(
            f'/api/sections/{sec.pk}/enrollments/',
            data={'student_id': stud2.pk, 'subject_id': subj.pk},
            content_type='application/json'
        )
        self.assertEqual(res_irreg.status_code, 201)
        self.assertEqual(res_irreg.data['subject'], subj.pk)
        self.assertEqual(res_irreg.data['subject_code'], 'GE 119')

        # 4. Remove enrollment
        res_del = client.delete(f'/api/sections/{sec.pk}/enrollments/{enrollment_id}/')
        self.assertEqual(res_del.status_code, 200)
        self.assertFalse(Enrollment.objects.filter(pk=enrollment_id).exists())




