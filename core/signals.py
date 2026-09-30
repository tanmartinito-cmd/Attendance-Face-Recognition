"""Targeted face-index cache invalidation for roster and biometric changes."""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from accounts.models import CustomUser, Student, StudentBiometric, Teacher
from core.models import (
    AttendanceRecord, AttendanceSession, Course, Program, ProgramSection,
    Schedule, Section, StudentSection, Subject,
)


def _invalidate_sections(section_ids):
    from face_app.services.face_service import FaceService

    for section_id in set(filter(None, section_ids)):
        FaceService.invalidate_cache(section_id=section_id)


@receiver(post_save, sender=StudentSection)
def invalidate_face_index_after_enrollment_save(sender, instance, **kwargs):
    _invalidate_sections([instance.section_id])


@receiver(post_delete, sender=StudentSection)
def invalidate_face_index_after_enrollment_delete(sender, instance, **kwargs):
    _invalidate_sections([instance.section_id])


@receiver(post_save, sender=Student)
def invalidate_face_index_after_student_save(sender, instance, **kwargs):
    # A face vector can be enrolled, replaced, or cleared through any write path.
    _invalidate_sections(instance.enrollments.values_list('section_id', flat=True))


# API response-cache invalidation for model writes that may occur outside API services.
@receiver(post_save, sender=StudentSection)
@receiver(post_delete, sender=StudentSection)
def invalidate_api_cache_after_enrollment_change(sender, instance, **kwargs):
    from attendance_fr.api.services.response_cache import ResponseCache
    ResponseCache.invalidate_on_commit('academic', 'attendance', 'dashboard', 'reports')


@receiver(post_save, sender=Student)
@receiver(post_delete, sender=Student)
@receiver(post_save, sender=Teacher)
@receiver(post_delete, sender=Teacher)
@receiver(post_save, sender=CustomUser)
@receiver(post_delete, sender=CustomUser)
@receiver(post_save, sender=StudentBiometric)
@receiver(post_delete, sender=StudentBiometric)
def invalidate_api_cache_after_student_change(sender, instance, **kwargs):
    from attendance_fr.api.services.response_cache import ResponseCache
    update_fields = kwargs.get('update_fields')
    if update_fields and set(update_fields) <= {'last_login'}:
        return  # a sign-in is not a data change
    # Rosters show names and face status, so academic (sections/enrollments) changes too.
    ResponseCache.invalidate_on_commit('people', 'academic', 'dashboard', 'reports')


@receiver(post_save, sender=Program)
@receiver(post_delete, sender=Program)
@receiver(post_save, sender=Course)
@receiver(post_delete, sender=Course)
@receiver(post_save, sender=ProgramSection)
@receiver(post_delete, sender=ProgramSection)
@receiver(post_save, sender=Subject)
@receiver(post_delete, sender=Subject)
@receiver(post_save, sender=Section)
@receiver(post_delete, sender=Section)
@receiver(post_save, sender=Schedule)
@receiver(post_delete, sender=Schedule)
def invalidate_api_cache_after_academic_change(sender, instance, **kwargs):
    from attendance_fr.api.services.response_cache import ResponseCache
    ResponseCache.invalidate_on_commit('academic', 'attendance', 'dashboard', 'reports')


@receiver(post_save, sender=AttendanceSession)
@receiver(post_delete, sender=AttendanceSession)
@receiver(post_save, sender=AttendanceRecord)
@receiver(post_delete, sender=AttendanceRecord)
def invalidate_api_cache_after_attendance_change(sender, instance, **kwargs):
    from attendance_fr.api.services.response_cache import ResponseCache
    ResponseCache.invalidate_on_commit('attendance', 'dashboard', 'reports')
