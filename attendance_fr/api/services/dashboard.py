"""
Role-specific dashboard statistics.
"""
from django.db.models import Q
from django.utils import timezone

from core.models import AttendanceSession, ClassSchedule, ClassSection, Enrollment, Instructor, Student, StudentBiometric, Subject
from core.services.enrollment_service import EnrollmentService


class DashboardService:
    @staticmethod
    def get_admin_stats():
        today = timezone.localdate()
        total_students = Student.objects.count()
        face_enrolled = StudentBiometric.objects.exclude(face_encoding='').count()
        return {
            'role': 'admin',
            'total_instructors': Instructor.objects.count(),
            'total_students': total_students,
            'total_subjects': Subject.objects.count(),
            'total_sections': ClassSection.objects.count(),
            'open_sessions_count': AttendanceSession.objects.filter(status='open').count(),
            'sessions_today_count': AttendanceSession.objects.filter(date=today).count(),
            'sessions_today_closed': AttendanceSession.objects.filter(date=today, status='closed').count(),
            'face_enrolled_count': face_enrolled,
            'face_enrollment_pct': round(face_enrolled / total_students * 100, 1) if total_students else 0,
        }

    @staticmethod
    def get_instructor_stats(instructor):
        if instructor is None:
            return {'role': 'instructor', 'total_sections': 0, 'total_students': 0, 'total_schedules': 0, 'open_sessions_count': 0}
        sections = EnrollmentService.filter_sections_for_instructor(ClassSection.objects.all(), instructor)
        section_ids = list(sections.values_list('pk', flat=True))
        return {
            'role': 'instructor',
            'total_sections': len(section_ids),
            'total_students': Enrollment.objects.filter(section_id__in=section_ids).values('student_id').distinct().count(),
            'total_schedules': ClassSchedule.objects.filter(section_id__in=section_ids).count(),
            'open_sessions_count': AttendanceSession.objects.filter(
                Q(started_by=instructor) | Q(schedule__section_id__in=section_ids), status='open',
            ).distinct().count(),
        }

    @staticmethod
    def get_student_stats(student):
        return {
            'role': 'student',
            'enrolled_sections': Enrollment.objects.filter(student=student).count() if student else 0,
            'is_face_enrolled': student.is_face_enrolled if student else False,
        }
