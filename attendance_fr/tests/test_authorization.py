"""Authorization and attendance-integrity regression tests."""
from datetime import time

from django.test import Client, TestCase
from django.utils import timezone
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule,
)



class AuthorizationAndAttendanceIntegrityTests(TestCase):
    def setUp(self):
        self.admin = create_user(username='admin', role='admin', password='StrongPassword123!')
        self.teacher_user = create_user(username='teacher', role='instructor', password='StrongPassword123!')
        self.teacher = create_instructor(user=self.teacher_user, faculty_id='T-001')
        self.other_teacher_user = create_user(username='other_teacher', role='instructor', password='StrongPassword123!')
        self.other_teacher = create_instructor(user=self.other_teacher_user, faculty_id='T-002')
        self.student_user = create_user(username='student', role='student', password='StrongPassword123!')
        self.student = create_student(user=self.student_user, student_id='S-001')
        self.other_student_user = create_user(username='other_student', role='student', password='StrongPassword123!')
        self.other_student = create_student(user=self.other_student_user, student_id='S-002')

        program = Program.objects.create(code='AUTH', name='Authorization')
        subject = create_subject(code='AUTH101', name='Access Control')
        self.section = create_section(name='AUTH-1A', program=program, subject=subject, teacher=self.teacher)
        self.other_section = create_section(name='AUTH-1B', program=program, subject=subject, teacher=self.other_teacher)
        self.schedule = create_schedule(section=self.section, day_of_week='Mon', start_time=time(9), end_time=time(10), room='101')
        other_schedule = create_schedule(section=self.other_section, day_of_week='Tue', start_time=time(9), end_time=time(10), room='102')
        enroll(student=self.student, section=self.section)
        enroll(student=self.other_student, section=self.other_section)
        self.session = AttendanceSession.objects.create(schedule=self.schedule, date=timezone.localdate(), started_by=self.teacher)
        self.other_session = AttendanceSession.objects.create(schedule=other_schedule, date=timezone.localdate(), started_by=self.other_teacher)
        self.client = Client()

    def test_student_cannot_list_user_profiles(self):
        self.client.force_login(self.student_user)
        self.assertEqual(self.client.get('/api/users/').status_code, 403)

    def test_student_sees_only_enrolled_sessions(self):
        self.client.force_login(self.student_user)
        response = self.client.get('/api/attendance/sessions/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual({item['id'] for item in response.json()}, {self.session.id})

    def test_teacher_cannot_view_unrelated_student_report(self):
        self.client.force_login(self.teacher_user)
        response = self.client.get(f'/api/attendance/student/overview/?student_id={self.other_student.student_id}')
        self.assertEqual(response.status_code, 403)

    def test_student_cannot_view_unenrolled_section_calendar(self):
        self.client.force_login(self.student_user)
        response = self.client.get(f'/api/attendance/student/calendar/{self.other_section.id}/')
        self.assertEqual(response.status_code, 403)

    def test_manual_mark_rejects_unenrolled_student(self):
        from unittest.mock import patch

        self.client.force_login(self.teacher_user)
        with patch(
            'attendance_fr.api.views.attendance.AttendanceService.validate_session_time_window',
            return_value=None,
        ):
            response = self.client.post('/api/attendance/records/mark/', {
                'session_id': self.session.id, 'student_id': self.other_student.id, 'status': 'present',
            }, content_type='application/json')
        self.assertEqual(response.status_code, 400)

    def test_manual_mark_rejects_closed_session(self):
        self.session.status = 'closed'
        self.session.save(update_fields=['status'])
        self.client.force_login(self.teacher_user)
        response = self.client.post('/api/attendance/records/mark/', {
            'session_id': self.session.id, 'student_id': self.student.id, 'status': 'present',
        }, content_type='application/json')
        self.assertEqual(response.status_code, 409)

    def test_recognition_does_not_reopen_closed_session(self):
        self.session.status = 'closed'
        self.session.save(update_fields=['status'])
        self.client.force_login(self.teacher_user)
        response = self.client.post('/api/face/recognize/', {
            'session_id': self.session.id, 'frame': 'not-a-frame',
        }, content_type='application/json')
        self.assertEqual(response.status_code, 409)
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, 'closed')

    def test_admin_cannot_start_or_manage_attendance(self):
        self.client.force_login(self.admin)
        start = self.client.post('/api/attendance/sessions/start/', {
            'schedule_id': self.schedule.id,
        }, content_type='application/json')
        close = self.client.post(f'/api/attendance/sessions/{self.session.id}/close/')
        reopen = self.client.post(f'/api/attendance/sessions/{self.session.id}/reopen/')
        manual = self.client.post('/api/attendance/records/mark/', {
            'session_id': self.session.id, 'student_id': self.student.id, 'status': 'present',
        }, content_type='application/json')
        self.assertEqual(start.status_code, 403)
        self.assertEqual(close.status_code, 403)
        self.assertEqual(reopen.status_code, 403)
        self.assertEqual(manual.status_code, 403)

    def test_teacher_cannot_reopen_or_manually_mark_outside_schedule_window(self):
        from unittest.mock import patch

        self.session.status = 'closed'
        self.session.save(update_fields=['status'])
        self.client.force_login(self.teacher_user)
        with patch(
            'attendance_fr.api.views.attendance.AttendanceService.validate_session_time_window',
            return_value='Attendance cannot be started. Your class schedule already ended at 10:00 AM.',
        ):
            reopen = self.client.post(
                f'/api/attendance/sessions/{self.session.id}/reopen/',
                {'reason': 'Late-arriving students'},
                content_type='application/json',
            )
        self.assertEqual(reopen.status_code, 403)

        self.session.status = 'open'
        self.session.save(update_fields=['status'])
        with patch(
            'attendance_fr.api.views.attendance.AttendanceService.validate_session_time_window',
            return_value='Attendance cannot be started. Your class schedule already ended at 10:00 AM.',
        ):
            manual = self.client.post('/api/attendance/records/mark/', {
                'session_id': self.session.id, 'student_id': self.student.id, 'status': 'present',
            }, content_type='application/json')
        self.assertEqual(manual.status_code, 403)

    # ── Another teacher must not touch someone else's session ────────────────
    def _as_other_teacher_open_session(self):
        self.session.status = 'open'
        self.session.save(update_fields=['status'])
        self.client.force_login(self.other_teacher_user)

    def test_other_teacher_cannot_view_session_detail(self):
        self._as_other_teacher_open_session()
        response = self.client.get(f'/api/attendance/sessions/{self.session.id}/')
        self.assertIn(response.status_code, (403, 404))

    def test_other_teacher_cannot_close_session(self):
        self._as_other_teacher_open_session()
        response = self.client.post(f'/api/attendance/sessions/{self.session.id}/close/')
        self.assertIn(response.status_code, (403, 404))
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, 'open')

    def test_other_teacher_cannot_reopen_session(self):
        self.session.status = 'closed'
        self.session.save(update_fields=['status'])
        self.client.force_login(self.other_teacher_user)
        response = self.client.post(
            f'/api/attendance/sessions/{self.session.id}/reopen/',
            {'reason': 'Trying to reopen'}, content_type='application/json',
        )
        self.assertIn(response.status_code, (403, 404))
        self.session.refresh_from_db()
        self.assertEqual(self.session.status, 'closed')

    def test_other_teacher_cannot_manually_mark(self):
        from unittest.mock import patch

        self._as_other_teacher_open_session()
        with patch(
            'attendance_fr.api.views.attendance.AttendanceService.validate_session_time_window',
            return_value=None,
        ):
            response = self.client.post('/api/attendance/records/mark/', {
                'session_id': self.session.id, 'student_id': self.student.id, 'status': 'present',
            }, content_type='application/json')
        self.assertIn(response.status_code, (403, 404))
        self.assertFalse(self.session.records.filter(student=self.student, status='present').exists())

    def test_other_teacher_cannot_scan_session_and_learns_nothing(self):
        """Recognition on someone else's session looks exactly like a missing session."""
        self._as_other_teacher_open_session()
        foreign = self.client.post('/api/face/recognize/', {
            'session_id': self.session.id, 'frame': 'not-a-frame',
        }, content_type='application/json')
        missing = self.client.post('/api/face/recognize/', {
            'session_id': 999999, 'frame': 'not-a-frame',
        }, content_type='application/json')
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(
            foreign.json()['error'].replace(str(self.session.id), 'N'),
            missing.json()['error'].replace('999999', 'N'),
        )

    def test_recognition_does_not_resolve_schedule_id_as_session(self):
        """A schedule id must never be accepted in place of a session id."""
        self.client.force_login(self.teacher_user)
        AttendanceSession.objects.filter(pk=self.schedule.id).exclude(pk=self.session.id).delete()
        from attendance_fr.api.services.face_recognition import FaceRecognitionService
        self.assertIsNone(FaceRecognitionService.get_session('not-a-number'))
        self.assertEqual(FaceRecognitionService.get_session(self.session.id), self.session)

    def test_teacher_recognition_is_blocked_outside_schedule_window(self):
        from unittest.mock import patch

        self.client.force_login(self.teacher_user)
        with patch(
            'attendance_fr.api.views.face_recognition.AttendanceService.validate_session_time_window',
            return_value='Attendance cannot be started. Your class schedule already ended at 10:00 AM.',
        ):
            response = self.client.post('/api/face/recognize/', {
                'session_id': self.session.id, 'frame': 'not-a-frame',
            }, content_type='application/json')
        self.assertEqual(response.status_code, 403)
        self.assertTrue(response.json()['attendance_unavailable'])


class TeacherSubjectIsolationTests(TestCase):
    """A teacher only sees their own subjects/schedules inside a shared section."""

    def setUp(self):
        from rest_framework.test import APIClient
        self.t1_user = create_user(username='iso_t1', role='instructor', password='StrongPassword123!')
        self.t1 = create_instructor(user=self.t1_user, faculty_id='FAC-ISO-1')
        self.t2_user = create_user(username='iso_t2', role='instructor', password='StrongPassword123!')
        self.t2 = create_instructor(user=self.t2_user, faculty_id='FAC-ISO-2')
        self.section = create_section(name='ISO-1A', teacher=self.t1)
        self.mine = create_subject(code='IT101', name='Mine', section=self.section, teacher=self.t1)
        self.theirs = create_subject(code='IT102', name='Theirs', section=self.section, teacher=self.t2)
        create_schedule(section=self.section, subject=self.mine, day_of_week='Mon', start_time=time(8), end_time=time(9), room='A')
        create_schedule(section=self.section, subject=self.theirs, day_of_week='Tue', start_time=time(8), end_time=time(9), room='B')
        self.client = APIClient()

    def _section_for(self, user):
        from django.core.cache import cache
        cache.clear()
        self.client.force_authenticate(user)
        rows = self.client.get('/api/sections/').json()
        rows = rows.get('results', rows) if isinstance(rows, dict) else rows
        return next(r for r in rows if r['id'] == self.section.id)

    def test_each_teacher_sees_only_their_subject_and_schedule(self):
        row = self._section_for(self.t1_user)
        self.assertEqual([s['code'] for s in row['subjects']], ['IT101'])
        self.assertEqual({s['subject'] for s in row['schedules']}, {self.mine.id})

        row = self._section_for(self.t2_user)
        self.assertEqual([s['code'] for s in row['subjects']], ['IT102'])
        self.assertEqual({s['subject'] for s in row['schedules']}, {self.theirs.id})

    def test_schedules_endpoint_is_isolated(self):
        from django.core.cache import cache
        cache.clear()
        self.client.force_authenticate(self.t1_user)
        rows = self.client.get('/api/schedules/').json()
        rows = rows.get('results', rows) if isinstance(rows, dict) else rows
        self.assertEqual({r['subject'] for r in rows if r['section'] == self.section.id}, {self.mine.id})


class StudentEditCourseTests(TestCase):
    def test_admin_can_change_student_course_by_id(self):
        from core.models import Course
        from attendance_fr.api.services.users import UserService
        program = Program.objects.create(code='CITEC', name='Computing')
        course_a = Course.objects.create(program=program, code='BSIT', name='IT')
        course_b = Course.objects.create(program=program, code='BSCS', name='CS')
        user = create_user(username='S-EDIT', role='student', password='StrongPassword123!')
        student = create_student(user=user, student_id='S-EDIT', course_ref=course_a)

        UserService.update_user(user, {'course_ref': course_b.id, 'gender': 'Female'})
        student.refresh_from_db()
        self.assertEqual(student.course_id, course_b.id)
        self.assertEqual(student.course.code, 'BSCS')

        with self.assertRaises(ValueError):
            UserService.update_user(user, {'course_ref': 999999})
