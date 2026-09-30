"""
DRF permission classes and authorization helpers.
"""
from django.db.models import Q
from rest_framework import permissions


def _instructor(user):
    return getattr(user, 'instructor', None) if user and user.is_authenticated and user.role == 'instructor' else None


def is_student_enrolled_for_schedule(student, schedule):
    """Whether a student is on the roster of a class meeting (block, or irregular for its subject)."""
    from core.models import Enrollment
    from core.services.attendance_service import AttendanceService
    return Enrollment.objects.filter(AttendanceService.roster_filter(schedule), student=student).exists()


def can_manage_session(user, session):
    """Whether an instructor may run / change an attendance session."""
    instructor = _instructor(user)
    if not instructor:
        return False
    schedule = session.schedule
    section = schedule.section
    has_subject_instructor = section.subjects.filter(instructor__isnull=False).exists()
    return (
        session.started_by_id == instructor.pk
        or (schedule.subject_id is not None and schedule.subject.instructor_id == instructor.pk)
        or (schedule.subject_id is None and section.subjects.filter(instructor=instructor).exists())
        or (schedule.subject_id is None and not has_subject_instructor and section.instructor_id == instructor.pk)
    )


def can_view_student_attendance(user, student, section=None):
    """Admin: anyone. Student: themselves. Instructor: students in classes they teach."""
    if not (user and user.is_authenticated):
        return False
    if user.role == 'admin':
        return True

    from core.models import Enrollment

    if user.role == 'student':
        if getattr(user, 'student', None) != student:
            return False
        return section is None or Enrollment.objects.filter(student=student, section=section).exists()

    instructor = _instructor(user)
    if instructor:
        qs = Enrollment.objects.filter(student=student)
        if section is not None:
            qs = qs.filter(section=section)
        return qs.filter(
            Q(section__instructor=instructor)
            | Q(section__subjects__instructor=instructor)
            | Q(section__schedules__subject__instructor=instructor)
        ).exists()
    return False


class _RolePermission(permissions.BasePermission):
    roles = ()

    def has_permission(self, request, view):
        user = request.user
        return bool(user and user.is_authenticated and user.role in self.roles)


class IsAdminRole(_RolePermission):
    message = 'Administrator privileges required to perform this action.'
    roles = ('admin',)


class IsInstructorRole(_RolePermission):
    message = 'Only an assigned instructor may take attendance.'
    roles = ('instructor',)


class IsInstructorOrAdminRole(_RolePermission):
    message = 'Instructor or Administrator privileges required to perform this action.'
    roles = ('admin', 'instructor')


class IsAdminOrReadOnly(permissions.BasePermission):
    """Read-only for signed-in users, writes for admins."""
    message = 'Only administrators are permitted to create, modify, or delete this resource.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated):
            return False
        return request.method in permissions.SAFE_METHODS or request.user.role == 'admin'


class IsSessionManager(IsInstructorRole):
    """Session access only for the instructor assigned to that session."""
    message = 'Only the assigned instructor may manage this attendance session.'

    def has_object_permission(self, request, view, obj):
        return can_manage_session(request.user, obj)
