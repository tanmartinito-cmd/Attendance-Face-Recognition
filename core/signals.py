"""Cache invalidation after data changes (face-recognition index + API response cache)."""
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

from accounts.models import User, UserAddress, UserLanguage, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, Student, StudentBiometric, Subject,
)


def _invalidate_face_index(section_ids):
    from face_app.services.face_service import FaceService
    for section_id in set(filter(None, section_ids)):
        FaceService.invalidate_cache(section_id=section_id)


def _invalidate_responses(*groups):
    from attendance_fr.api.services.response_cache import ResponseCache
    ResponseCache.invalidate_on_commit(*groups)


def _only_last_login(kwargs):
    update_fields = kwargs.get('update_fields')
    return bool(update_fields) and set(update_fields) <= {'last_login'}


# ── Face-recognition index: rosters and face data ─────────────────────────────
@receiver(post_save, sender=Enrollment)
@receiver(post_delete, sender=Enrollment)
def enrollment_changed(sender, instance, **kwargs):
    _invalidate_face_index([instance.section_id])
    _invalidate_responses('academic', 'attendance', 'dashboard', 'reports')


@receiver(post_save, sender=StudentBiometric)
@receiver(post_delete, sender=StudentBiometric)
def biometric_changed(sender, instance, **kwargs):
    _invalidate_face_index(Enrollment.objects.filter(student_id=instance.student_id).values_list('section_id', flat=True))
    from face_app.services.face_service import FaceService
    FaceService.invalidate_cache()  # global index
    _invalidate_responses('people', 'academic', 'dashboard', 'reports')


# ── People ────────────────────────────────────────────────────────────────────
@receiver(post_save, sender=User)
@receiver(post_delete, sender=User)
@receiver(post_save, sender=UserProfile)
@receiver(post_delete, sender=UserProfile)
@receiver(post_save, sender=UserAddress)
@receiver(post_delete, sender=UserAddress)
@receiver(post_save, sender=UserLanguage)
@receiver(post_delete, sender=UserLanguage)
@receiver(post_save, sender=Student)
@receiver(post_delete, sender=Student)
@receiver(post_save, sender=Instructor)
@receiver(post_delete, sender=Instructor)
def people_changed(sender, instance, **kwargs):
    if _only_last_login(kwargs):
        return  # a sign-in is not a data change
    # Rosters show names and face status, so academic lists change too.
    _invalidate_responses('people', 'academic', 'dashboard', 'reports')


# ── Academic structure ────────────────────────────────────────────────────────
@receiver(post_save, sender=Program)
@receiver(post_delete, sender=Program)
@receiver(post_save, sender=Course)
@receiver(post_delete, sender=Course)
@receiver(post_save, sender=AcademicTerm)
@receiver(post_delete, sender=AcademicTerm)
@receiver(post_save, sender=SectionTemplate)
@receiver(post_delete, sender=SectionTemplate)
@receiver(post_save, sender=ClassSection)
@receiver(post_delete, sender=ClassSection)
@receiver(post_save, sender=Subject)
@receiver(post_delete, sender=Subject)
@receiver(post_save, sender=ClassSchedule)
@receiver(post_delete, sender=ClassSchedule)
@receiver(post_save, sender=ClassScheduleDay)
@receiver(post_delete, sender=ClassScheduleDay)
def academic_changed(sender, instance, **kwargs):
    _invalidate_responses('academic', 'attendance', 'dashboard', 'reports')


# ── Attendance ────────────────────────────────────────────────────────────────
@receiver(post_save, sender=AttendanceSession)
@receiver(post_delete, sender=AttendanceSession)
@receiver(post_save, sender=AttendanceRecord)
@receiver(post_delete, sender=AttendanceRecord)
def attendance_changed(sender, instance, **kwargs):
    _invalidate_responses('attendance', 'dashboard', 'reports')
