"""
Academic structure, the people in it, and attendance.

    instructors                instructor-only data (faculty ID, department...)
    students                   student-only data (student ID, course, year level)
    student_biometrics         face data (encoding + photo), kept apart for privacy
    academic_programs          college / program (e.g. CITEC)
    academic_courses           degree course under a program (e.g. BSIT)
    academic_terms             school year + semester
    academic_section_templates reusable section definition (e.g. "BSIT-4A", 4th year) of a course
    academic_class_sections    a section template offered in a term
    academic_subjects          a subject taught in a class section (code, units, instructor)
    academic_class_schedules   when/where a class meets
    academic_class_schedule_days  one row per meeting day
    academic_enrollments       a student in a class section (whole block, or one subject if irregular)
    attendance_sessions        one class meeting's attendance
    attendance_records         one student's status in a session
    attendance_session_reopen_logs  audit of reopened sessions
"""
from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.utils import timezone

from accounts.validators import validate_image_upload
from attendance_fr.storage import get_face_storage

YEAR_LEVEL_CHOICES = [(1, '1st Year'), (2, '2nd Year'), (3, '3rd Year'), (4, '4th Year')]


class Program(models.Model):
    code = models.CharField(max_length=20, unique=True)
    name = models.CharField(max_length=150)
    college = models.CharField(max_length=150, blank=True)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True, help_text='Inactive records are temporarily closed and hidden from new activity.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'academic_programs'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} - {self.name}'


class Course(models.Model):
    program = models.ForeignKey(Program, on_delete=models.PROTECT, related_name='courses')
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'academic_courses'
        ordering = ['program__code', 'code']
        constraints = [models.UniqueConstraint(fields=['program', 'code'], name='unique_course_per_program')]

    def __str__(self):
        return f'{self.code} - {self.name}'


class Instructor(models.Model):
    """Instructor-only data. Personal details and contact number are in UserProfile."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='instructor')
    faculty_id = models.CharField(max_length=20, unique=True)
    department = models.CharField(max_length=100, blank=True)
    specialization = models.CharField(max_length=150, blank=True)
    title = models.CharField(max_length=50, blank=True, help_text='Academic title, e.g. Prof., Dr., Engr.')
    position = models.CharField(max_length=100, blank=True, help_text='Rank, e.g. Assistant Professor')
    employment_status = models.CharField(max_length=50, blank=True, default='Regular')
    date_hired = models.DateField(null=True, blank=True)
    office_location = models.CharField(max_length=150, blank=True)
    consultation_hours = models.TextField(blank=True)
    education_background = models.TextField(blank=True)
    certifications = models.TextField(blank=True)

    class Meta:
        db_table = 'instructors'
        verbose_name = 'Instructor'

    def __str__(self):
        return self.user.get_full_name() or self.user.username


class Student(models.Model):
    """Student-only data. Personal details are in UserProfile, face data in StudentBiometric."""
    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='student')
    student_id = models.CharField(max_length=20, unique=True)
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, related_name='students')
    year_level = models.PositiveSmallIntegerField(default=1)

    class Meta:
        db_table = 'students'
        verbose_name = 'Student'
        indexes = [models.Index(fields=['course', 'year_level'], name='student_course_year_idx')]

    def __str__(self):
        return f"{self.user.get_full_name() or self.user.username} ({self.student_id})"

    @property
    def course_code(self):
        return self.course.code if self.course_id else ''

    @property
    def biometric_or_none(self):
        try:
            return self.biometric
        except StudentBiometric.DoesNotExist:
            return None

    @property
    def is_face_enrolled(self):
        bio = self.biometric_or_none
        return bool(bio and bio.face_encoding)


class StudentBiometric(models.Model):
    """The one stored face identity of a student (sensitive, private storage)."""
    student = models.OneToOneField(Student, on_delete=models.CASCADE, primary_key=True, related_name='biometric')
    face_encoding = models.TextField(help_text='JSON list of 128 floats')
    face_image = models.ImageField(
        upload_to='face_images/', null=True, blank=True, validators=[validate_image_upload],
        storage=get_face_storage,
    )
    enrolled_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'student_biometrics'
        verbose_name = 'Student Biometric'

    def __str__(self):
        return f'Biometric: {self.student}'


class AcademicTerm(models.Model):
    class Semester(models.TextChoices):
        FIRST = '1st', '1st Semester'
        SECOND = '2nd', '2nd Semester'
        SUMMER = 'summer', 'Summer'

    school_year = models.CharField(max_length=20, help_text='e.g. 2025-2026')
    semester = models.CharField(max_length=10, choices=Semester.choices, default=Semester.FIRST)

    class Meta:
        db_table = 'academic_terms'
        ordering = ['-school_year', 'semester']
        constraints = [models.UniqueConstraint(fields=['school_year', 'semester'], name='unique_academic_term')]

    def __str__(self):
        return f'{self.school_year} ({self.get_semester_display()})'


class SectionTemplate(models.Model):
    """Reusable section definition of a course, e.g. BSIT-4A (4th year)."""
    course = models.ForeignKey(Course, on_delete=models.PROTECT, related_name='section_templates')
    name = models.CharField(max_length=50)
    year_level = models.PositiveSmallIntegerField(choices=YEAR_LEVEL_CHOICES, default=1)
    description = models.CharField(max_length=150, blank=True)
    is_active = models.BooleanField(default=True, help_text='Inactive records are temporarily closed and hidden from new activity.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'academic_section_templates'
        ordering = ['course__program__code', 'course__code', 'year_level', 'name']
        constraints = [models.UniqueConstraint(fields=['course', 'name'], name='unique_section_name_per_course')]
        indexes = [models.Index(fields=['course', 'year_level'], name='template_course_year_idx')]

    def __str__(self):
        return f'{self.name} ({self.get_year_level_display()} • {self.course.code})'

    @property
    def program(self):
        return self.course.program


class ClassSection(models.Model):
    """A section template offered in a term. Name, course, program and year come from the template."""
    template = models.ForeignKey(SectionTemplate, on_delete=models.PROTECT, related_name='class_sections')
    term = models.ForeignKey(AcademicTerm, on_delete=models.PROTECT, related_name='class_sections')
    instructor = models.ForeignKey(
        Instructor, on_delete=models.SET_NULL, null=True, blank=True, related_name='class_sections',
        help_text='Section-level instructor; used only when no subject in the section has its own instructor.',
    )
    is_active = models.BooleanField(default=True, help_text='Inactive records are temporarily closed and hidden from new activity.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'academic_class_sections'
        ordering = ['template__name']
        constraints = [models.UniqueConstraint(fields=['template', 'term'], name='unique_section_per_term')]

    def __str__(self):
        return f'{self.name} ({self.term})'

    # Read-only views of data owned by the template / term.
    @property
    def name(self):
        return self.template.name

    @property
    def year_level(self):
        return self.template.year_level

    def get_year_level_display(self):
        return self.template.get_year_level_display()

    @property
    def course(self):
        return self.template.course

    @property
    def program(self):
        return self.template.course.program

    @property
    def school_year(self):
        return self.term.school_year

    @property
    def semester(self):
        return self.term.semester

    @property
    def effective_subject(self):
        """The section's first subject (used for one-line summaries)."""
        subjects = getattr(self, '_prefetched_objects_cache', {}).get('subjects')
        if subjects is not None:
            return min(subjects, key=lambda s: s.pk) if subjects else None
        return self.subjects.order_by('pk').first()

    @property
    def schedule_display(self):
        """e.g. 'T/TH 06:00PM-07:30PM/06:00PM-07:30PM @ Room 226'."""
        schedules = sorted(self.schedules.all(), key=lambda s: (DAY_ORDER.get(s.day_of_week, 99), s.start_time))
        if not schedules:
            return 'No schedule set'
        return ', '.join(f'{s.days_display} {s.time_display} @ {s.room}' for s in schedules)


class Subject(models.Model):
    """A subject taught in a class section (or not yet placed in one)."""
    course = models.ForeignKey(Course, on_delete=models.SET_NULL, null=True, blank=True, related_name='subjects')
    section = models.ForeignKey(ClassSection, on_delete=models.SET_NULL, null=True, blank=True, related_name='subjects')
    instructor = models.ForeignKey(Instructor, on_delete=models.SET_NULL, null=True, blank=True, related_name='subjects')
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=150)
    description = models.TextField(blank=True)
    units = models.PositiveSmallIntegerField(default=3)
    is_active = models.BooleanField(default=True, help_text='Inactive records are temporarily closed and hidden from new activity.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'academic_subjects'
        ordering = ['code']

    def __str__(self):
        return f'{self.code} - {self.name}'

    def clean(self):
        if self.section_id and self.course_id and self.section.course.pk != self.course_id:
            raise ValidationError({'course': 'The subject course must match the class section course.'})

    def save(self, *args, **kwargs):
        # A subject placed in a section always belongs to that section's course.
        if self.section_id and not self.course_id:
            self.course = self.section.course
        super().save(*args, **kwargs)

    @property
    def program(self):
        return self.course.program if self.course_id else None


DAY_CHOICES = [('Mon', 'Monday'), ('Tue', 'Tuesday'), ('Wed', 'Wednesday'),
               ('Thu', 'Thursday'), ('Fri', 'Friday'), ('Sat', 'Saturday')]
DAY_ORDER = {'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6, 'Sun': 7}
DAY_SHORT = {'Mon': 'M', 'Tue': 'T', 'Wed': 'W', 'Thu': 'TH', 'Fri': 'F', 'Sat': 'S', 'Sun': 'SU'}
DAY_NAMES = dict(DAY_CHOICES)


class ClassSchedule(models.Model):
    """When and where a class meets. Meeting days are rows in ClassScheduleDay."""
    section = models.ForeignKey(ClassSection, on_delete=models.CASCADE, related_name='schedules')
    subject = models.ForeignKey(Subject, on_delete=models.CASCADE, null=True, blank=True, related_name='schedules')
    start_time = models.TimeField()
    end_time = models.TimeField()
    room = models.CharField(max_length=50)
    effective_from = models.DateField(null=True, blank=True, help_text='First date this schedule is active')
    effective_to = models.DateField(null=True, blank=True, help_text='Last date this schedule is active')

    DAY_CHOICES = DAY_CHOICES
    DAY_SHORT = DAY_SHORT

    class Meta:
        db_table = 'academic_class_schedules'
        ordering = ['start_time']

    def __str__(self):
        return f'{self.section.name} | {self.days_display} {self.time_display} @ {self.room}'

    # ── Meeting days ────────────────────────────────────────────────────────
    def set_days(self, days):
        """Stage meeting days (saved with the schedule). Order is kept, duplicates dropped."""
        self._pending_days = list(dict.fromkeys(d for d in days if d))

    @property
    def meeting_days(self):
        pending = getattr(self, '_pending_days', None)
        if pending is not None:
            return list(pending)
        if not self.pk:
            return []
        rows = getattr(self, '_prefetched_objects_cache', {}).get('days')
        rows = rows if rows is not None else self.days.all()
        return sorted((r.day for r in rows), key=lambda d: DAY_ORDER.get(d, 99))

    @property
    def day_of_week(self):
        days = self.meeting_days
        return days[0] if days else ''

    @property
    def day_2(self):
        days = self.meeting_days
        return days[1] if len(days) > 1 else None

    def get_day_of_week_display(self):
        return DAY_NAMES.get(self.day_of_week, self.day_of_week)

    @property
    def days_display(self):
        return '/'.join(DAY_SHORT.get(d, d) for d in self.meeting_days)

    @property
    def full_days_display(self):
        return ' & '.join(DAY_NAMES.get(d, d) for d in self.meeting_days)

    @property
    def time_display(self):
        def fmt(t):
            return f"{t.hour % 12 or 12:02d}:{t.minute:02d}{'PM' if t.hour >= 12 else 'AM'}"
        slot = f'{fmt(self.start_time)}-{fmt(self.end_time)}'
        return '/'.join([slot] * max(1, len(self.meeting_days)))

    @property
    def instructor(self):
        """Who teaches this meeting: the subject's instructor, else the section's."""
        if self.subject_id and self.subject.instructor_id:
            return self.subject.instructor
        return self.section.instructor

    def clean(self):
        from core.services.schedule_service import ScheduleService
        if not self.meeting_days:
            raise ValidationError('Select at least one meeting day.')
        conflicts = ScheduleService.check_conflicts(self)
        if conflicts:
            raise ValidationError(conflicts[0])

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)
        pending = getattr(self, '_pending_days', None)
        if pending is not None:
            self.days.exclude(day__in=pending).delete()
            existing = set(self.days.values_list('day', flat=True))
            ClassScheduleDay.objects.bulk_create(
                [ClassScheduleDay(schedule=self, day=d) for d in pending if d not in existing]
            )
            del self._pending_days
            getattr(self, '_prefetched_objects_cache', {}).pop('days', None)


class ClassScheduleDay(models.Model):
    schedule = models.ForeignKey(ClassSchedule, on_delete=models.CASCADE, related_name='days')
    day = models.CharField(max_length=3, choices=DAY_CHOICES)

    class Meta:
        db_table = 'academic_class_schedule_days'
        constraints = [models.UniqueConstraint(fields=['schedule', 'day'], name='unique_day_per_schedule')]
        indexes = [models.Index(fields=['day'], name='schedule_day_idx')]

    def __str__(self):
        return f'{self.schedule_id}: {self.get_day_display()}'


class Enrollment(models.Model):
    """A student in a class section: whole block (subject empty) or one subject (irregular)."""
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='enrollments')
    section = models.ForeignKey(ClassSection, on_delete=models.CASCADE, related_name='enrollments')
    subject = models.ForeignKey(
        Subject, on_delete=models.CASCADE, null=True, blank=True, related_name='enrollments',
        help_text='Leave empty for a regular block student; set for an irregular student.',
    )
    enrolled_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'academic_enrollments'
        constraints = [models.UniqueConstraint(fields=['student', 'section', 'subject'], name='unique_enrollment')]
        indexes = [models.Index(fields=['section', 'subject'], name='enrollment_section_subject_idx')]

    def __str__(self):
        extra = f' [{self.subject.code}]' if self.subject_id else ''
        return f'{self.student} → {self.section}{extra}'

    @property
    def is_irregular(self):
        return self.subject_id is not None


class AttendanceSession(models.Model):
    class Status(models.TextChoices):
        OPEN = 'open', 'Open'
        CLOSED = 'closed', 'Closed'

    STATUS_CHOICES = Status.choices

    schedule = models.ForeignKey(ClassSchedule, on_delete=models.CASCADE, related_name='sessions')
    date = models.DateField(default=timezone.localdate)
    started_by = models.ForeignKey(Instructor, on_delete=models.SET_NULL, null=True, blank=True, related_name='sessions_started')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.OPEN)
    created_at = models.DateTimeField(auto_now_add=True)
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'attendance_sessions'
        ordering = ['-date', '-created_at']
        constraints = [models.UniqueConstraint(fields=['schedule', 'date'], name='one_session_per_meeting')]

    def __str__(self):
        return f'{self.schedule.section.name} | {self.date} [{self.status}]'

    def validate_unique(self, exclude=None):
        if self.schedule_id and self.date and AttendanceSession.objects.filter(
            schedule_id=self.schedule_id, date=self.date,
        ).exclude(pk=self.pk).exists():
            raise ValidationError(
                f'An attendance session already exists for this class schedule on {self.date}. '
                '1 subject, 1 meeting, 1 attendance session only — no duplication allowed.'
            )
        super().validate_unique(exclude=exclude)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)


class SessionReopenLog(models.Model):
    """Immutable audit record for an instructor reopening a closed attendance session."""
    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name='reopen_history')
    reopened_by = models.ForeignKey(Instructor, on_delete=models.PROTECT, related_name='session_reopens')
    reason = models.CharField(max_length=300)
    reopened_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'attendance_session_reopen_logs'
        ordering = ['-reopened_at']

    def __str__(self):
        return f'Session #{self.session_id} reopened: {self.reason}'


class AttendanceRecord(models.Model):
    class Status(models.TextChoices):
        PRESENT = 'present', 'Present'
        ABSENT = 'absent', 'Absent'
        LATE = 'late', 'Late'
        EXCUSED = 'excused', 'Excused'

    STATUS_CHOICES = Status.choices

    session = models.ForeignKey(AttendanceSession, on_delete=models.CASCADE, related_name='records')
    student = models.ForeignKey(Student, on_delete=models.CASCADE, related_name='attendance_records')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.ABSENT)
    recognized_at = models.DateTimeField(null=True, blank=True)
    confidence_score = models.FloatField(null=True, blank=True)
    remarks = models.CharField(max_length=200, blank=True)

    class Meta:
        db_table = 'attendance_records'
        ordering = ['student__user__profile__last_name']
        constraints = [models.UniqueConstraint(fields=['session', 'student'], name='one_record_per_student_session')]

    def __str__(self):
        return f'{self.student} | {self.session.date} - {self.status}'

    def validate_unique(self, exclude=None):
        if self.session_id and self.student_id and AttendanceRecord.objects.filter(
            session_id=self.session_id, student_id=self.student_id,
        ).exclude(pk=self.pk).exists():
            raise ValidationError(
                f'Student {self.student} already has an attendance record for this meeting on {self.session.date}. '
                '1 subject, 1 meeting, 1 attendance only — no duplication allowed.'
            )
        super().validate_unique(exclude=exclude)

    def save(self, *args, **kwargs):
        self.full_clean()
        super().save(*args, **kwargs)
