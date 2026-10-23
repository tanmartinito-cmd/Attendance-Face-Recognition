"""
Class sections, enrollments and schedule saving.
"""
from django.db.models import ProtectedError
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError as DRFValidationError

from core.models import AttendanceSession, ClassSection, Enrollment, Student, Subject
from core.services.enrollment_service import EnrollmentService
from face_app.services.face_service import FaceService


class AttendanceHistoryProtected(Exception):
    """Delete refused because attendance was already taken (deactivate instead)."""

    def __init__(self, message, session_count):
        super().__init__(message)
        self.session_count = session_count


def _plural(n, word):
    return f"{n} {word}{'s' if n != 1 else ''}"


class ClassService:
    filter_sections_for_user = staticmethod(EnrollmentService.filter_sections_for_user)
    filter_schedules_for_user = staticmethod(EnrollmentService.filter_schedules_for_user)
    student_enrolled_subject_ids = staticmethod(EnrollmentService.student_enrolled_subject_ids)
    user_can_access_section = staticmethod(EnrollmentService.user_can_access_section)

    @staticmethod
    def enroll_student(section_id, student_id, subject_id=None):
        """Enroll a student (whole block, or one subject if irregular). Returns (enrollment, created).

        Block enrollment is limited to the student's own course. An irregular student may take a
        subject in a section of any course / department (e.g. to avoid a schedule conflict).
        Timetable conflicts are rejected by Enrollment.save (SchedulingConflict -> 409).
        """
        section = get_object_or_404(ClassSection.objects.select_related('template__course', 'term'), pk=section_id)
        student = get_object_or_404(Student.objects.select_related('user', 'course'), pk=student_id)
        subject = None
        if subject_id:
            subject = get_object_or_404(Subject, pk=subject_id)
            if subject.section_id != section.pk:
                raise DRFValidationError({'subject_id': f'{subject.code} is not offered in {section.name}.'})
        elif student.course_id and student.course_id != section.template.course_id:
            raise DRFValidationError({'student_id': (
                f'{student} is a {student.course.code} student and cannot join {section.name} '
                f'({section.template.course.code}) as a block. Enroll them per subject (irregular) instead.'
            )})
        if section.is_active is False:
            raise DRFValidationError({'section': f'{section.name} is deactivated. Activate it before enrolling students.'})
        if subject is not None and subject.is_active is False:
            raise DRFValidationError({'subject_id': f'{subject.code} is deactivated. Activate it before enrolling students.'})
        enrollment, created = Enrollment.objects.get_or_create(student=student, section=section, subject=subject)
        FaceService.invalidate_cache(section.pk)
        return enrollment, created

    @staticmethod
    def unenroll_student(section_id, enrollment_id):
        enrollment = get_object_or_404(Enrollment, pk=enrollment_id, section_id=section_id)
        enrollment.delete()
        FaceService.invalidate_cache(section_id)
        return True

    @staticmethod
    def validate_and_save_schedule(serializer, is_update=False):
        """Save a schedule. Model validation rejects missing days, bad dates, a subject from another
        section, and room / instructor / student conflicts; the API exception handler turns those
        into 400 / 409 responses with readable messages."""
        return serializer.save()

    # ── Deletes that would erase attendance history ──────────────────────────
    @staticmethod
    def _guard_delete(sessions, what, deactivate_hint):
        count = sessions.count()
        if count:
            raise AttendanceHistoryProtected(
                f'{what} has {_plural(count, "attendance session")} and cannot be deleted. '
                f'{deactivate_hint} to keep its attendance history.',
                count,
            )

    @staticmethod
    def delete_schedule(schedule):
        ClassService._guard_delete(
            AttendanceSession.objects.filter(schedule=schedule), 'This schedule', 'Deactivate the schedule instead',
        )
        ClassService._delete(schedule)

    @staticmethod
    def delete_subject(subject):
        ClassService._guard_delete(
            AttendanceSession.objects.filter(schedule__subject=subject), f'Subject {subject.code}',
            'Deactivate the subject instead',
        )
        ClassService._delete(subject)

    @staticmethod
    def delete_section(section):
        ClassService._guard_delete(
            AttendanceSession.objects.filter(schedule__section=section), f'Section {section.name}',
            'Deactivate the section instead',
        )
        ClassService._delete(section)

    @staticmethod
    def _delete(obj):
        try:
            obj.delete()
        except ProtectedError as e:  # race: attendance started meanwhile
            raise AttendanceHistoryProtected(
                'This record has attendance history and cannot be deleted. Deactivate it instead.',
                len(e.protected_objects),
            ) from e
