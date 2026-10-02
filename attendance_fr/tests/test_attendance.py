"""
Attendance Session & Records API Tests
"""
from datetime import time
from django.test import TestCase, Client
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


class RestAttendanceApiTests(TestCase):
    def setUp(self):
        self.admin = create_user(
            username='api_bio_admin', role='admin', password='StrongPassword123!'
        )
        self.teacher_u = create_user(
            username='api_bio_teacher', role='instructor', password='StrongPassword123!'
        )
        self.teacher = create_instructor(user=self.teacher_u, faculty_id='EMP-BIO-1')

        self.student_u = create_user(
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

    def test_attendance_sessions_list_api(self):
        """GET /api/attendance/sessions/ queries historical and active sessions."""
        self.client.force_login(self.teacher_u)
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
        """POST /api/attendance/sessions/{id}/close/ finalizes session."""
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='open'
        )
        self.client.force_login(self.teacher_u)
        res = self.client.post(f'/api/attendance/sessions/{session.pk}/close/')
        self.assertEqual(res.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.status, 'closed')

    def test_attendance_session_reopen_api(self):
        """POST /api/attendance/sessions/{id}/reopen/ reopens a closed session."""
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='closed'
        )
        self.client.force_login(self.teacher_u)
        res = self.client.post(
            f'/api/attendance/sessions/{session.pk}/reopen/',
            {'reason': 'Late-arriving students'},
            content_type='application/json',
        )
        self.assertEqual(res.status_code, 200)
        session.refresh_from_db()
        self.assertEqual(session.status, 'open')
        audit = SessionReopenLog.objects.get(session=session)
        self.assertEqual(audit.reopened_by, self.teacher)
        self.assertEqual(audit.reason, 'Late-arriving students')

    def test_manual_attendance_mark_api(self):
        """POST /api/attendance/records/mark/ manually updates student attendance status."""
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='open'
        )
        self.client.force_login(self.teacher_u)
        res = self.client.post(
            '/api/attendance/records/mark/',
            {
                'session_id': session.pk,
                'student_id': self.student.pk,
                'status': 'present',
            },
            content_type='application/json'
        )
        self.assertEqual(res.status_code, 200)
        record = AttendanceRecord.objects.get(session=session, student=self.student)
        self.assertEqual(record.status, 'present')

    def test_attendance_reopen_requires_reason(self):
        session = AttendanceSession.objects.create(
            schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher, status='closed'
        )
        self.client.force_login(self.teacher_u)
        response = self.client.post(
            f'/api/attendance/sessions/{session.pk}/reopen/', {}, content_type='application/json'
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('reason', response.json())
        self.assertFalse(SessionReopenLog.objects.filter(session=session).exists())
