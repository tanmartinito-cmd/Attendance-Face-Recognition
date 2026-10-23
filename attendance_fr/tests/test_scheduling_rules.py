"""
College timetable rules through the API: one instructor / room / student cannot be in two
places at once, subjects with schedules stay in their section, attendance history is never
deleted, and every error has a readable message.
"""
from datetime import time

from django.core.management import call_command
from django.test import TestCase
from io import StringIO
from rest_framework.test import APIClient

from core.models import AttendanceRecord, AttendanceSession, ClassSchedule, Enrollment, Subject
from attendance_fr.tests.factories import (
    course_for, create_instructor, create_schedule, create_section, create_student, create_subject, create_user,
    default_program, enroll,
)


class SchedulingRulesBase(TestCase):
    def setUp(self):
        self.admin = create_user('admin1', role='admin')
        self.api = APIClient()
        self.api.force_authenticate(self.admin)
        self.santos = create_instructor(create_user('santos', role='instructor', first_name='Ana', last_name='Santos'), faculty_id='T1')
        self.reyes = create_instructor(create_user('reyes', role='instructor', first_name='Ben', last_name='Reyes'), faculty_id='T2')
        self.bsit = course_for(default_program(), 'BSIT')
        self.bscs = course_for(default_program(), 'BSCS')
        self.sec_a = create_section(name='BSIT-2A', course_ref=self.bsit)
        self.sec_b = create_section(name='BSIT-2B', course_ref=self.bsit)

    def post_schedule(self, section, subject, room, start='08:00', end='09:30', day='Mon', day_2=None, **extra):
        payload = {
            'section': section.pk, 'subject': subject.pk if subject else None, 'day_of_week': day,
            'day_2': day_2, 'start_time': start, 'end_time': end, 'room': room, **extra,
        }
        return self.api.post('/api/schedules/', payload, format='json')


class InstructorAndRoomConflictTests(SchedulingRulesBase):
    def test_same_instructor_two_subjects_same_time_rejected(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        self.assertEqual(self.post_schedule(self.sec_a, it201, 'Room 226').status_code, 201)
        res = self.post_schedule(self.sec_b, it202, 'Room 301')
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body['code'], 'schedule_conflict')
        self.assertIn('Instructor conflict: Ana Santos already teaches IT201 (BSIT-2A)', body['error'])
        self.assertEqual(body['conflicts'][0]['type'], 'instructor')

    def test_parallel_subjects_in_one_section_allowed_with_different_room_and_instructor(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_a, instructor=self.reyes)
        self.assertEqual(self.post_schedule(self.sec_a, it201, 'Room 226').status_code, 201)
        self.assertEqual(self.post_schedule(self.sec_a, it202, 'Room 301').status_code, 201)

    def test_back_to_back_classes_allowed(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        self.assertEqual(self.post_schedule(self.sec_a, it201, 'Room 226', '08:00', '09:30').status_code, 201)
        self.assertEqual(self.post_schedule(self.sec_b, it202, 'Room 226', '09:30', '11:00').status_code, 201)

    def test_room_name_compared_ignoring_case_and_spacing(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        it202 = create_subject(code='IT202', section=self.sec_b)
        self.post_schedule(self.sec_a, it201, 'Room 101')
        res = self.post_schedule(self.sec_b, it202, '  room   101 ')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['conflicts'][0]['type'], 'room')

    def test_room_is_stored_with_tidy_spacing(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        res = self.post_schedule(self.sec_a, it201, '  Room   101 ')
        self.assertEqual(res.status_code, 201)
        self.assertEqual(ClassSchedule.objects.get().room, 'Room 101')

    def test_all_conflicts_are_reported(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        self.post_schedule(self.sec_a, it201, 'Room 226')
        res = self.post_schedule(self.sec_b, it202, 'Room 226')
        self.assertEqual({c['type'] for c in res.json()['conflicts']}, {'room', 'instructor'})

    def test_other_term_does_not_conflict(self):
        old = create_section(name='BSIT-2A', course_ref=self.bsit, school_year='2024-2025')
        old_subject = create_subject(code='IT201', section=old, instructor=self.santos)
        new_subject = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        self.assertEqual(self.post_schedule(old, old_subject, 'Room 226').status_code, 201)
        self.assertEqual(self.post_schedule(self.sec_a, new_subject, 'Room 226').status_code, 201)

    def test_non_overlapping_effective_dates_do_not_conflict(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        self.post_schedule(self.sec_a, it201, 'Room 226', effective_from='2025-08-01', effective_to='2025-09-30')
        res = self.post_schedule(self.sec_b, it202, 'Room 226', effective_from='2025-10-01', effective_to='2025-12-15')
        self.assertEqual(res.status_code, 201)

    def test_inactive_schedule_does_not_block_and_cannot_be_reactivated_into_conflict(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        first = self.post_schedule(self.sec_a, it201, 'Room 226').json()['id']
        self.assertEqual(self.api.patch(f'/api/schedules/{first}/', {'is_active': False}, format='json').status_code, 200)
        self.assertEqual(self.post_schedule(self.sec_b, it202, 'Room 301').status_code, 201)
        res = self.api.patch(f'/api/schedules/{first}/', {'is_active': True}, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertIn('Instructor conflict', res.json()['error'])


class AssignmentConflictTests(SchedulingRulesBase):
    """The reported bug: assigning an instructor after scheduling skipped the conflict check."""

    def test_assigning_instructor_to_overlapping_subject_rejected(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        it202 = create_subject(code='IT202', section=self.sec_b)
        self.post_schedule(self.sec_a, it201, 'Room 226')
        self.post_schedule(self.sec_b, it202, 'Room 301')
        self.assertEqual(self.api.patch(f'/api/subjects/{it201.pk}/', {'instructor': self.santos.pk}, format='json').status_code, 200)
        res = self.api.patch(f'/api/subjects/{it202.pk}/', {'instructor': self.santos.pk}, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertIn('Ana Santos already teaches IT201 (BSIT-2A)', res.json()['error'])
        self.assertIn('which overlaps IT202 (BSIT-2B)', res.json()['error'])
        it202.refresh_from_db()
        self.assertIsNone(it202.instructor_id)

    def test_setting_section_instructor_into_overlap_rejected(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        self.post_schedule(self.sec_a, it201, 'Room 226')
        self.post_schedule(self.sec_b, None, 'Room 301')
        res = self.api.patch(f'/api/sections/{self.sec_b.pk}/', {'instructor': self.santos.pk}, format='json')
        self.assertEqual(res.status_code, 409)
        self.sec_b.refresh_from_db()
        self.assertIsNone(self.sec_b.instructor_id)

    def test_reactivating_subject_into_conflict_rejected(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        self.post_schedule(self.sec_a, it201, 'Room 226')
        self.api.patch(f'/api/subjects/{it201.pk}/', {'is_active': False}, format='json')
        self.assertEqual(self.post_schedule(self.sec_b, it202, 'Room 301').status_code, 201)
        res = self.api.patch(f'/api/subjects/{it201.pk}/', {'is_active': True}, format='json')
        self.assertEqual(res.status_code, 409)

    def test_assigning_instructor_without_overlap_allowed(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        it202 = create_subject(code='IT202', section=self.sec_b, instructor=self.santos)
        self.post_schedule(self.sec_a, it201, 'Room 226', '08:00', '09:30')
        self.post_schedule(self.sec_b, it202, 'Room 301', '10:00', '11:30')
        self.assertEqual(self.api.patch(f'/api/subjects/{it201.pk}/', {'instructor': self.santos.pk}, format='json').status_code, 200)


class SubjectRulesTests(SchedulingRulesBase):
    def test_schedule_subject_must_belong_to_section(self):
        other = create_subject(code='IT301', section=self.sec_b)
        res = self.post_schedule(self.sec_a, other, 'Room 226')
        self.assertEqual(res.status_code, 400)
        self.assertIn('IT301 belongs to section BSIT-2B, not BSIT-2A', res.json()['error'])
        self.assertIn('subject', res.json()['fields'])

    def test_moving_scheduled_subject_blocked(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        self.post_schedule(self.sec_a, it201, 'Room 226')
        res = self.api.patch(f'/api/subjects/{it201.pk}/', {'section': self.sec_b.pk}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('cannot be moved to another section', res.json()['error'])
        it201.refresh_from_db()
        self.assertEqual(it201.section_id, self.sec_a.pk)

    def test_moving_unscheduled_subject_allowed(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        res = self.api.patch(f'/api/subjects/{it201.pk}/', {'section': self.sec_b.pk}, format='json')
        self.assertEqual(res.status_code, 200)

    def test_duplicate_subject_code_in_section_rejected(self):
        create_subject(code='IT201', section=self.sec_a)
        res = self.api.post('/api/subjects/', {'code': 'it201', 'name': 'Dup', 'section': self.sec_a.pk}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('BSIT-2A already has a subject with code it201', res.json()['error'])
        self.assertEqual(Subject.objects.filter(section=self.sec_a).count(), 1)

    def test_effective_to_before_from_rejected(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        res = self.post_schedule(self.sec_a, it201, 'R', effective_from='2026-05-01', effective_to='2026-01-01')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Effective To must be on or after Effective From', res.json()['error'])

    def test_field_errors_have_readable_summary(self):
        res = self.api.post('/api/schedules/', {
            'section': self.sec_a.pk, 'day_of_week': 'Xyz', 'start_time': '08:00', 'end_time': '09:00', 'room': 'R',
        }, format='json')
        self.assertEqual(res.status_code, 400)
        body = res.json()
        self.assertEqual(body['code'], 'validation_error')
        self.assertIn('Day 1:', body['error'])
        self.assertIn('day_of_week', body['fields'])
        self.assertIn('day_of_week', body)  # older clients read the field key directly

    def test_end_before_start_message(self):
        it201 = create_subject(code='IT201', section=self.sec_a)
        res = self.post_schedule(self.sec_a, it201, 'R', '10:00', '09:00')
        self.assertEqual(res.status_code, 400)
        self.assertIn('End time must be after start time.', res.json()['error'])


class StudentConflictTests(SchedulingRulesBase):
    def setUp(self):
        super().setUp()
        self.juan = create_student(create_user('juan', first_name='Juan', last_name='Dela Cruz'), student_id='S1', course=self.bsit)
        self.it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        self.post_schedule(self.sec_a, self.it201, 'Room 226', '08:00', '09:30')
        enroll(self.juan, self.sec_a)

    def test_block_enrollment_into_overlapping_section_rejected(self):
        it150 = create_subject(code='IT150', section=self.sec_b, instructor=self.reyes)
        self.post_schedule(self.sec_b, it150, 'Room 301', '08:30', '10:00')
        res = self.api.post(f'/api/sections/{self.sec_b.pk}/enrollments/', {'student_id': self.juan.pk}, format='json')
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body['code'], 'student_schedule_conflict')
        self.assertIn('Juan Dela Cruz already has IT201 (BSIT-2A)', body['error'])
        self.assertIn('Enroll the student per subject (irregular)', body['error'])
        self.assertFalse(Enrollment.objects.filter(student=self.juan, section=self.sec_b).exists())

    def test_irregular_enrollment_conflict_suggests_other_sections_any_department(self):
        it150_b = create_subject(code='IT150', section=self.sec_b, instructor=self.reyes)
        self.post_schedule(self.sec_b, it150_b, 'Room 301', '08:30', '10:00')
        bscs = create_section(name='BSCS-2A', course_ref=self.bscs)
        it150_cs = create_subject(code='IT150', section=bscs, instructor=self.reyes)
        self.post_schedule(bscs, it150_cs, 'Room 401', '13:00', '14:30', day='Tue')

        res = self.api.post(
            f'/api/sections/{self.sec_b.pk}/enrollments/', {'student_id': self.juan.pk, 'subject_id': it150_b.pk}, format='json',
        )
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body['alternatives'][0]['section'], 'BSCS-2A')
        self.assertIn('BSCS-2A (BSCS): Tue 1:00 PM–2:30 PM', body['error'])

        # Taking the subject in another department's section (different course) is allowed.
        ok = self.api.post(
            f'/api/sections/{bscs.pk}/enrollments/', {'student_id': self.juan.pk, 'subject_id': it150_cs.pk}, format='json',
        )
        self.assertEqual(ok.status_code, 201, ok.content)

    def test_block_enrollment_in_another_course_still_rejected(self):
        bscs = create_section(name='BSCS-2A', course_ref=self.bscs)
        res = self.api.post(f'/api/sections/{bscs.pk}/enrollments/', {'student_id': self.juan.pk}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('Enroll them per subject (irregular) instead', res.json()['error'])

    def test_block_student_in_parallel_section_subjects_allowed(self):
        it202 = create_subject(code='IT202', section=self.sec_a, instructor=self.reyes)
        self.assertEqual(self.post_schedule(self.sec_a, it202, 'Room 301', '08:00', '09:30').status_code, 201)

    def test_new_schedule_that_double_books_enrolled_students_rejected(self):
        it150 = create_subject(code='IT150', section=self.sec_b, instructor=self.reyes)
        self.post_schedule(self.sec_b, it150, 'Room 301', '13:00', '14:30')
        enroll(self.juan, self.sec_b, it150)
        sched = ClassSchedule.objects.get(subject=it150)
        res = self.api.patch(f'/api/schedules/{sched.pk}/', {'start_time': '08:00', 'end_time': '09:00'}, format='json')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['conflicts'][0]['type'], 'student')
        self.assertIn('Juan Dela Cruz already has IT201 (BSIT-2A)', res.json()['error'])


class SubjectOncePerTermTests(SchedulingRulesBase):
    """A student takes each subject (by code) only once per term, in any course / department."""

    def setUp(self):
        super().setUp()
        self.juan = create_student(create_user('juan', first_name='Juan', last_name='Dela Cruz'), student_id='S1', course=self.bsit)
        self.it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        self.post_schedule(self.sec_a, self.it201, 'Room 226', '08:00', '09:30')
        enroll(self.juan, self.sec_a)  # block: Juan takes IT201 through BSIT-2A
        self.cs_sec = create_section(name='BSCS-2A', course_ref=self.bscs)  # another department's section
        self.it201_cs = create_subject(code='it201', section=self.cs_sec, instructor=self.reyes)  # case-insensitive match
        self.post_schedule(self.cs_sec, self.it201_cs, 'Room 401', '13:00', '14:30', day='Tue')  # no overlap

    def test_same_subject_in_another_section_rejected_even_without_overlap(self):
        res = self.api.post(
            f'/api/sections/{self.cs_sec.pk}/enrollments/', {'student_id': self.juan.pk, 'subject_id': self.it201_cs.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        body = res.json()
        self.assertEqual(body['code'], 'duplicate_subject')
        self.assertIn('Juan Dela Cruz already takes IT201 in BSIT-2A this term', body['error'])
        self.assertIn('only once per term', body['error'])
        self.assertFalse(Enrollment.objects.filter(student=self.juan, section=self.cs_sec).exists())
        self.assertEqual(res.json()['conflicts'][0]['section'], 'BSIT-2A')

    def test_irregular_twice_in_different_sections_rejected(self):
        it150_b = create_subject(code='IT150', section=self.sec_b)
        it150_c = create_subject(code='IT150', section=self.cs_sec)
        enroll(self.juan, self.sec_b, it150_b)
        res = self.api.post(
            f'/api/sections/{self.cs_sec.pk}/enrollments/', {'student_id': self.juan.pk, 'subject_id': it150_c.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'duplicate_subject')

    def test_same_subject_in_another_term_allowed(self):
        next_term = create_section(name='BSIT-2A', course_ref=self.bsit, semester='2nd')
        retake = create_subject(code='IT201', section=next_term)
        res = self.api.post(
            f'/api/sections/{next_term.pk}/enrollments/', {'student_id': self.juan.pk, 'subject_id': retake.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)

    def test_moving_subject_after_removing_it_from_the_first_section(self):
        # Switch Juan to per-subject enrollment in BSIT-2A without IT201, then take IT201 in BSCS-2A.
        it202 = create_subject(code='IT202', section=self.sec_a, instructor=self.reyes)
        Enrollment.objects.filter(student=self.juan, section=self.sec_a).delete()
        enroll(self.juan, self.sec_a, it202)
        res = self.api.post(
            f'/api/sections/{self.cs_sec.pk}/enrollments/', {'student_id': self.juan.pk, 'subject_id': self.it201_cs.pk},
            format='json',
        )
        self.assertEqual(res.status_code, 201, res.content)

    def test_adding_a_subject_the_block_already_takes_elsewhere_rejected(self):
        it150_c = create_subject(code='IT150', section=self.cs_sec)
        enroll(self.juan, self.cs_sec, it150_c)
        res = self.api.post('/api/subjects/', {'code': 'IT150', 'name': 'Dup', 'section': self.sec_a.pk}, format='json')
        self.assertEqual(res.status_code, 400)
        self.assertIn('already takes IT150 in another section this term', res.json()['error'])

    def test_block_enrollment_over_own_irregular_enrollment_allowed(self):
        other = create_student(student_id='S2', course=self.bsit)
        enroll(other, self.sec_a, self.it201)
        res = self.api.post(f'/api/sections/{self.sec_a.pk}/enrollments/', {'student_id': other.pk}, format='json')
        self.assertEqual(res.status_code, 201, res.content)


class AttendanceHistoryTests(SchedulingRulesBase):
    def setUp(self):
        super().setUp()
        self.it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        self.schedule = create_schedule(self.sec_a, subject=self.it201, start_time=time(8, 0), end_time=time(9, 30))
        student = create_student(student_id='S9', course=self.bsit)
        enroll(student, self.sec_a)
        session = AttendanceSession.objects.create(schedule=self.schedule)
        AttendanceRecord.objects.create(session=session, student=student, status='present')

    def test_delete_schedule_with_attendance_blocked(self):
        res = self.api.delete(f'/api/schedules/{self.schedule.pk}/')
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.json()['code'], 'has_attendance')
        self.assertIn('Deactivate the schedule instead', res.json()['error'])
        self.assertEqual(AttendanceRecord.objects.count(), 1)

    def test_delete_subject_and_section_with_attendance_blocked(self):
        self.assertEqual(self.api.delete(f'/api/subjects/{self.it201.pk}/').status_code, 409)
        self.assertEqual(self.api.delete(f'/api/sections/{self.sec_a.pk}/').status_code, 409)
        self.assertEqual(AttendanceSession.objects.count(), 1)

    def test_deactivated_schedule_keeps_history_and_cannot_take_attendance(self):
        res = self.api.patch(f'/api/schedules/{self.schedule.pk}/', {'is_active': False}, format='json')
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.json()['is_active'])
        from attendance_fr.api.services.attendance import AttendanceService
        self.schedule.refresh_from_db()
        self.assertIn('schedule is temporarily deactivated', AttendanceService.inactive_offering_error(self.schedule))
        self.assertEqual(AttendanceRecord.objects.count(), 1)

    def test_delete_schedule_without_attendance_allowed(self):
        other = create_subject(code='IT202', section=self.sec_b)
        sched = create_schedule(self.sec_b, subject=other, room='Room 9')
        self.assertEqual(self.api.delete(f'/api/schedules/{sched.pk}/').status_code, 204)


class ConflictReportCommandTests(SchedulingRulesBase):
    def test_reports_existing_conflicts_without_changing_data(self):
        it201 = create_subject(code='IT201', section=self.sec_a, instructor=self.santos)
        it202 = create_subject(code='IT202', section=self.sec_b)
        create_schedule(self.sec_a, subject=it201, room='Room 226')
        create_schedule(self.sec_b, subject=it202, room='Room 301')
        # Legacy bad data written around the rules.
        Subject.objects.filter(pk=it202.pk).update(instructor=self.santos)
        out = StringIO()
        call_command('find_schedule_conflicts', stdout=out)
        self.assertIn('[INSTRUCTOR]', out.getvalue())
        self.assertIn('1 conflict(s) found.', out.getvalue())
        self.assertEqual(ClassSchedule.objects.count(), 2)
