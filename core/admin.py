from django.contrib import admin

from .models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)


@admin.register(Program)
class ProgramAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'college', 'is_active']
    search_fields = ['code', 'name', 'college']


@admin.register(Course)
class CourseAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'program', 'is_active']
    list_filter = ['program', 'is_active']
    search_fields = ['code', 'name', 'program__code']


@admin.register(AcademicTerm)
class AcademicTermAdmin(admin.ModelAdmin):
    list_display = ['school_year', 'semester']


@admin.register(SectionTemplate)
class SectionTemplateAdmin(admin.ModelAdmin):
    list_display = ['name', 'course', 'year_level', 'is_active']
    list_filter = ['course__program', 'course', 'year_level']
    search_fields = ['name', 'course__code']


@admin.register(ClassSection)
class ClassSectionAdmin(admin.ModelAdmin):
    list_display = ['__str__', 'term', 'instructor', 'is_active']
    list_filter = ['term', 'template__course']
    search_fields = ['template__name', 'template__course__code']
    raw_id_fields = ['instructor']


@admin.register(Subject)
class SubjectAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'course', 'section', 'instructor', 'units']
    list_filter = ['course']
    search_fields = ['code', 'name']


class ClassScheduleDayInline(admin.TabularInline):
    model = ClassScheduleDay
    extra = 0


@admin.register(ClassSchedule)
class ClassScheduleAdmin(admin.ModelAdmin):
    list_display = ['section', 'subject', 'days_display', 'start_time', 'end_time', 'room']
    inlines = [ClassScheduleDayInline]


@admin.register(Enrollment)
class EnrollmentAdmin(admin.ModelAdmin):
    list_display = ['student', 'section', 'subject', 'enrolled_at']
    search_fields = ['student__student_id', 'student__user__username', 'section__template__name']


@admin.register(AttendanceSession)
class AttendanceSessionAdmin(admin.ModelAdmin):
    list_display = ['schedule', 'date', 'started_by', 'status', 'created_at']
    list_filter = ['status', 'date']


@admin.register(AttendanceRecord)
class AttendanceRecordAdmin(admin.ModelAdmin):
    list_display = ['student', 'session', 'status', 'recognized_at', 'confidence_score']
    list_filter = ['status']
    search_fields = ['student__student_id', 'student__user__username']


@admin.register(SessionReopenLog)
class SessionReopenLogAdmin(admin.ModelAdmin):
    list_display = ['session', 'reopened_by', 'reason', 'reopened_at']
    readonly_fields = ['session', 'reopened_by', 'reason', 'reopened_at']


@admin.register(Instructor)
class InstructorAdmin(admin.ModelAdmin):
    list_display = ['user', 'faculty_id', 'department', 'position']
    search_fields = ['user__username', 'user__profile__first_name', 'user__profile__last_name', 'faculty_id']


@admin.register(Student)
class StudentAdmin(admin.ModelAdmin):
    list_display = ['user', 'student_id', 'course', 'year_level', 'is_face_enrolled']
    search_fields = ['user__username', 'user__profile__first_name', 'user__profile__last_name', 'student_id']
    list_filter = ['course', 'year_level']


@admin.register(StudentBiometric)
class StudentBiometricAdmin(admin.ModelAdmin):
    list_display = ['student', 'enrolled_at', 'updated_at']
    readonly_fields = ['face_encoding', 'enrolled_at', 'updated_at']
    search_fields = ['student__student_id']
