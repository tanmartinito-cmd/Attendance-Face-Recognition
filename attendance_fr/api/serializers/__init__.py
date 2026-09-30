"""
API Serializers Package
Exports serializers across auth, students, classes, courses, attendance, and reports.
"""
from attendance_fr.api.serializers.auth import (
    CurrentUserProfileSerializer,
    UserProfileUpdateSerializer,
)
from attendance_fr.api.serializers.students import (
    UserSerializer,
    InstructorSerializer,
    StudentSerializer,
    UserCreateInputSerializer,
    UserUpdateInputSerializer,
)
from attendance_fr.api.serializers.classes import (
    ProgramSerializer,
    ProgramSectionSerializer,
    SubjectSerializer,
    SectionSerializer,
    ScheduleSerializer,
    StudentSectionSerializer,
    SectionEnrollmentCreateSerializer,
)
from attendance_fr.api.serializers.courses import CourseSerializer
from attendance_fr.api.serializers.attendance import (
    AttendanceSessionSerializer,
    AttendanceRecordSerializer,
    AttendanceSessionStartSerializer,
    ManualAttendanceMarkSerializer,
)
from attendance_fr.api.serializers.reports import (
    DashboardStatsSerializer,
    StudentAttendanceOverviewSerializer,
    StudentSectionCalendarSerializer,
)

__all__ = [
    'CurrentUserProfileSerializer',
    'UserProfileUpdateSerializer',
    'UserSerializer',
    'InstructorSerializer',
    'StudentSerializer',
    'UserCreateInputSerializer',
    'UserUpdateInputSerializer',
    'CourseSerializer',
    'ProgramSerializer',
    'ProgramSectionSerializer',
    'SubjectSerializer',
    'SectionSerializer',
    'ScheduleSerializer',
    'StudentSectionSerializer',
    'SectionEnrollmentCreateSerializer',
    'AttendanceSessionSerializer',
    'AttendanceRecordSerializer',
    'AttendanceSessionStartSerializer',
    'ManualAttendanceMarkSerializer',
    'DashboardStatsSerializer',
    'StudentAttendanceOverviewSerializer',
    'StudentSectionCalendarSerializer',
]
