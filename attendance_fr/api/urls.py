"""
API URL Configuration
Maps all /api/ routes to the appropriate modular view classes.
No business logic lives here — only URL ↔ View binding.
"""
from django.urls import path
from attendance_fr.api.views.auth import (
    CurrentUserAPIView,
    LogoutAPIView,
    ThrottledTokenObtainPairView,
    ThrottledTokenRefreshView,
)
from attendance_fr.api.views.students import (
    UserListCreateAPIView,
    UserDetailAPIView,
    StudentListAPIView,
    NextStudentIdAPIView,
)
from attendance_fr.api.views.classes import (
    ProgramListCreateAPIView,
    ProgramDetailAPIView,
    ProgramSectionListCreateAPIView,
    ProgramSectionDetailAPIView,
    SubjectListCreateAPIView,
    SubjectDetailAPIView,
    SectionListCreateAPIView,
    SectionDetailAPIView,
    SectionEnrollmentListCreateAPIView,
    SectionEnrollmentDestroyAPIView,
    ScheduleListCreateAPIView,
    ScheduleDetailAPIView,
)
from attendance_fr.api.views.courses import (
    CourseListCreateAPIView,
    CourseDetailAPIView,
)
from attendance_fr.api.views.attendance import (
    AttendanceSessionListAPIView,
    AttendanceSessionStartAPIView,
    AttendanceSessionCloseAPIView,
    AttendanceSessionReopenAPIView,
    AttendanceSessionDetailAPIView,
    ManualAttendanceMarkAPIView,
)
from attendance_fr.api.views.media import FacePhotoAPIView
from attendance_fr.api.views.face_recognition import (
    FaceRecognizeAPIView,
    FaceEnrollAPIView,
    FaceEnrollCheckAPIView,
)
from attendance_fr.api.views.reports import (
    DashboardStatsAPIView,
    StudentAttendanceOverviewAPIView,
    StudentSectionCalendarAPIView,
)

from attendance_fr.api.views.sync import SyncVersionsAPIView

urlpatterns = [
    # ── Live sync: data-group versions (clients refresh silently on change) ──
    path('sync/versions/', SyncVersionsAPIView.as_view(), name='api_sync_versions'),

    # ── JWT Authentication ────────────────────────────────────────────────────
    path('token/', ThrottledTokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', ThrottledTokenRefreshView.as_view(), name='token_refresh'),
    path('auth/me/', CurrentUserAPIView.as_view(), name='api_auth_me'),
    path('auth/logout/', LogoutAPIView.as_view(), name='api_auth_logout'),

    # ── Dashboard & Users ────────────────────────────────────────────────────
    path('dashboard/stats/', DashboardStatsAPIView.as_view(), name='api_dashboard_stats'),
    path('programs/', ProgramListCreateAPIView.as_view(), name='api_programs'),
    path('programs/<int:pk>/', ProgramDetailAPIView.as_view(), name='api_program_detail'),
    path('courses/', CourseListCreateAPIView.as_view(), name='api_courses'),
    path('courses/<int:pk>/', CourseDetailAPIView.as_view(), name='api_course_detail'),
    path('program-sections/', ProgramSectionListCreateAPIView.as_view(), name='api_program_sections'),
    path('program-sections/<int:pk>/', ProgramSectionDetailAPIView.as_view(), name='api_program_section_detail'),
    path('users/', UserListCreateAPIView.as_view(), name='api_users'),
    path('users/<int:pk>/', UserDetailAPIView.as_view(), name='api_user_detail'),
    path('students/', StudentListAPIView.as_view(), name='api_students'),
    path('students/next-id/', NextStudentIdAPIView.as_view(), name='api_students_next_id'),

    # ── Academic Structure ───────────────────────────────────────────────────
    path('subjects/', SubjectListCreateAPIView.as_view(), name='api_subjects'),
    path('subjects/<int:pk>/', SubjectDetailAPIView.as_view(), name='api_subject_detail'),
    path('sections/', SectionListCreateAPIView.as_view(), name='api_sections'),
    path('sections/<int:pk>/', SectionDetailAPIView.as_view(), name='api_section_detail'),
    path('sections/<int:pk>/enrollments/', SectionEnrollmentListCreateAPIView.as_view(), name='api_section_enrollments'),
    path('sections/<int:pk>/enrollments/<int:enrollment_pk>/', SectionEnrollmentDestroyAPIView.as_view(), name='api_section_enrollment_detail'),
    path('schedules/', ScheduleListCreateAPIView.as_view(), name='api_schedules'),
    path('schedules/<int:pk>/', ScheduleDetailAPIView.as_view(), name='api_schedule_detail'),

    # ── Attendance ───────────────────────────────────────────────────────────
    path('attendance/sessions/', AttendanceSessionListAPIView.as_view(), name='api_attendance_sessions'),
    path('attendance/sessions/start/', AttendanceSessionStartAPIView.as_view(), name='api_attendance_sessions_start'),
    path('attendance/sessions/<int:pk>/close/', AttendanceSessionCloseAPIView.as_view(), name='api_attendance_sessions_close'),
    path('attendance/sessions/<int:pk>/reopen/', AttendanceSessionReopenAPIView.as_view(), name='api_attendance_sessions_reopen'),
    path('attendance/sessions/<int:pk>/', AttendanceSessionDetailAPIView.as_view(), name='api_attendance_sessions_detail'),
    path('attendance/records/mark/', ManualAttendanceMarkAPIView.as_view(), name='api_attendance_record_mark'),
    path('attendance/student/overview/', StudentAttendanceOverviewAPIView.as_view(), name='api_student_attendance_overview'),
    path('attendance/student/calendar/<int:section_pk>/', StudentSectionCalendarAPIView.as_view(), name='api_student_section_calendar'),

    # ── Face Recognition ─────────────────────────────────────────────────────
    path('face/recognize/', FaceRecognizeAPIView.as_view(), name='api_face_recognize'),
    path('face/enroll/', FaceEnrollAPIView.as_view(), name='api_face_enroll'),
    path('face/enroll/check/', FaceEnrollCheckAPIView.as_view(), name='api_face_enroll_check'),
    path('media/face/<int:student_pk>/', FacePhotoAPIView.as_view(), name='api_face_photo'),
]
