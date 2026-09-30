"""
Student queries and re-exports of the user service helpers.
"""
from django.db.models import Q

from attendance_fr.api.services.users import (
    UserService,
    get_next_student_id,
    validate_password_strength,
    validate_ph_phone,
)
from core.models import Student


class StudentService:
    @staticmethod
    def get_students_queryset(search=None):
        qs = Student.objects.select_related(
            'user__profile', 'course__program', 'biometric',
        ).prefetch_related('user__addresses', 'user__languages').order_by(
            'user__profile__last_name', 'user__profile__first_name',
        )
        if search:
            qs = qs.filter(
                Q(student_id__icontains=search)
                | Q(user__profile__first_name__icontains=search)
                | Q(user__profile__last_name__icontains=search)
                | Q(user__email__icontains=search)
            )
        return qs

    @staticmethod
    def get_next_id():
        return get_next_student_id()


__all__ = ['StudentService', 'UserService', 'get_next_student_id', 'validate_ph_phone', 'validate_password_strength']
