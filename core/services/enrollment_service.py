"""
Who may see which class sections, subjects and schedules.

Instructor rule (shared sections): an instructor sees the subjects assigned to them. The
section-level instructor sees the whole section only while no subject has its own instructor.
Student rule: a block enrollment (subject empty) covers every subject of the section; an
irregular enrollment covers only its subject.
"""
from django.db.models import Exists, OuterRef, Q

from core.models import Enrollment, Subject


def _instructor_of(user):
    return getattr(user, 'instructor', None) if user.role == 'instructor' else None


def _student_of(user):
    return getattr(user, 'student', None) if user.role == 'student' else None


class EnrollmentService:

    @staticmethod
    def filter_sections_for_instructor(qs, instructor):
        has_subject_instructor = Exists(Subject.objects.filter(section_id=OuterRef('pk'), instructor__isnull=False))
        return qs.annotate(_has_subject_instructor=has_subject_instructor).filter(
            Q(subjects__instructor=instructor)
            | Q(schedules__subject__instructor=instructor)
            | Q(_has_subject_instructor=False, instructor=instructor)
        ).distinct()

    @staticmethod
    def instructor_visible_subject_ids(instructor, section):
        """None = all subjects (section-level instructor, no subject instructors); else a set of ids."""
        subjects = Subject.objects.filter(section=section)
        if not subjects.filter(instructor__isnull=False).exists() and section.instructor_id == instructor.pk:
            return None
        return set(subjects.filter(instructor=instructor).values_list('id', flat=True))

    @staticmethod
    def filter_schedules_for_instructor(qs, instructor):
        has_subject_instructor = Exists(Subject.objects.filter(section_id=OuterRef('section_id'), instructor__isnull=False))
        return qs.annotate(_has_subject_instructor=has_subject_instructor).filter(
            Q(subject__instructor=instructor)
            | Q(_has_subject_instructor=False, section__instructor=instructor)
        ).distinct()

    @staticmethod
    def filter_sections_for_user(qs, user):
        instructor = _instructor_of(user)
        if instructor:
            return EnrollmentService.filter_sections_for_instructor(qs, instructor)
        student = _student_of(user)
        if student:
            return qs.filter(enrollments__student=student).distinct()
        return qs

    @staticmethod
    def filter_schedules_for_user(qs, user):
        instructor = _instructor_of(user)
        if instructor:
            return EnrollmentService.filter_schedules_for_instructor(qs, instructor)
        student = _student_of(user)
        if student:
            enrollments = list(Enrollment.objects.filter(student=student))
            if not enrollments:
                return qs.none()
            q = Q()
            for e in enrollments:
                q |= Q(section_id=e.section_id, subject_id=e.subject_id) if e.subject_id else Q(section_id=e.section_id)
            return qs.filter(q).distinct()
        return qs

    @staticmethod
    def student_enrolled_subject_ids(student, section):
        """None = block enrollment (all subjects); otherwise the list of subject ids."""
        enrollments = Enrollment.objects.filter(student=student, section=section)
        if not enrollments.exists():
            return []
        if enrollments.filter(subject__isnull=True).exists():
            return None
        return list(enrollments.exclude(subject__isnull=True).values_list('subject_id', flat=True))

    @staticmethod
    def visible_subject_ids(user, section):
        """None = all subjects of the section; otherwise the ids this user may see."""
        instructor = _instructor_of(user)
        if user and user.role == 'instructor':
            return EnrollmentService.instructor_visible_subject_ids(instructor, section) if instructor else set()
        if user and user.role == 'student':
            student = _student_of(user)
            return EnrollmentService.student_enrolled_subject_ids(student, section) if student else set()
        return None

    @staticmethod
    def user_can_access_section(user, section):
        if user.role == 'admin':
            return True
        instructor = _instructor_of(user)
        if instructor:
            has_subject_instructor = section.subjects.filter(instructor__isnull=False).exists()
            return (
                section.subjects.filter(instructor=instructor).exists()
                or section.schedules.filter(subject__instructor=instructor).exists()
                or (not has_subject_instructor and section.instructor_id == instructor.pk)
            )
        student = _student_of(user)
        if student:
            return Enrollment.objects.filter(section=section, student=student).exists()
        return False
