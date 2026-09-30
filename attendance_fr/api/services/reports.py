"""
Reports & analytics: dashboard metrics, student attendance overview and monthly calendar.
"""
from attendance_fr.api.services.attendance import AttendanceReportService
from attendance_fr.api.services.dashboard import DashboardService


class ReportService:
    @staticmethod
    def get_dashboard_stats(user):
        if user.role == 'admin':
            return DashboardService.get_admin_stats()
        if user.role == 'instructor':
            return DashboardService.get_instructor_stats(getattr(user, 'instructor', None))
        if user.role == 'student':
            return DashboardService.get_student_stats(getattr(user, 'student', None))
        return {'role': user.role}

    @staticmethod
    def get_student_overview(student):
        return AttendanceReportService.get_student_overview(student)

    @staticmethod
    def get_student_section_calendar(student, section, target_year, target_month):
        return AttendanceReportService.get_student_section_calendar(student, section, target_year, target_month)
