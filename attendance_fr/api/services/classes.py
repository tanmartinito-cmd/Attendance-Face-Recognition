"""
Class sections, enrollments and schedule saving.
"""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError as DRFValidationError

from core.models import ClassSection, Enrollment, Student, Subject
from core.services.enrollment_service import EnrollmentService
from face_app.services.face_service import FaceService


class ClassService:
    filter_sections_for_user = staticmethod(EnrollmentService.filter_sections_for_user)
    filter_schedules_for_user = staticmethod(EnrollmentService.filter_schedules_for_user)
    student_enrolled_subject_ids = staticmethod(EnrollmentService.student_enrolled_subject_ids)
    user_can_access_section = staticmethod(EnrollmentService.user_can_access_section)

    @staticmethod
    def enroll_student(section_id, student_id, subject_id=None):
        """Enroll a student (whole block, or one subject if irregular). Returns (enrollment, created)."""
        section = get_object_or_404(ClassSection.objects.select_related('template'), pk=section_id)
        student = get_object_or_404(Student, pk=student_id)
        if student.course_id and student.course_id != section.template.course_id:
            raise DRFValidationError({'student_id': 'This student belongs to a different Course than the selected Section.'})
        subject = None
        if subject_id:
            subject = get_object_or_404(Subject, pk=subject_id)
            if subject.section_id and subject.section_id != section.pk:
                raise DRFValidationError({'subject_id': 'The selected Subject does not belong to this Section.'})
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
        """Save a schedule; model validation rejects missing days and room/instructor conflicts."""
        try:
            return serializer.save()
        except DjangoValidationError as e:
            messages = list(getattr(e, 'messages', []) or [str(e)])
            raise DRFValidationError({'detail': messages[0]})
