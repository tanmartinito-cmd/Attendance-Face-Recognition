"""
Reports & Analytics Serializers
Handles serialization for dashboard statistics, attendance overviews, and academic calendar reports.
"""
from rest_framework import serializers


class DashboardStatsSerializer(serializers.Serializer):
    """Serializes role-based dashboard metric summaries."""
    role = serializers.CharField()
    # Admin metrics
    total_instructors = serializers.IntegerField(required=False)
    total_students = serializers.IntegerField(required=False)
    total_subjects = serializers.IntegerField(required=False)
    total_sections = serializers.IntegerField(required=False)
    open_sessions_count = serializers.IntegerField(required=False)
    sessions_today_count = serializers.IntegerField(required=False)
    sessions_today_closed = serializers.IntegerField(required=False)
    face_enrolled_count = serializers.IntegerField(required=False)
    face_enrollment_pct = serializers.FloatField(required=False)
    # Instructor metrics
    total_schedules = serializers.IntegerField(required=False)
    # Student metrics
    enrolled_sections = serializers.IntegerField(required=False)
    is_face_enrolled = serializers.BooleanField(required=False)


class StudentAttendanceOverviewSerializer(serializers.Serializer):
    """Serializes student attendance summary metrics."""
    student_id = serializers.CharField()
    full_name = serializers.CharField()
    overall_attendance_rate = serializers.FloatField()
    total_sessions = serializers.IntegerField()
    total_present = serializers.IntegerField()
    total_late = serializers.IntegerField()
    total_absent = serializers.IntegerField()
    sections = serializers.ListField()


class StudentSectionCalendarSerializer(serializers.Serializer):
    """Serializes calendar schedule and attendance events for a section."""
    section_id = serializers.IntegerField()
    section_name = serializers.CharField()
    year = serializers.IntegerField()
    month = serializers.IntegerField()
    month_name = serializers.CharField()
    meetings = serializers.ListField()
    attendance_records = serializers.ListField()
