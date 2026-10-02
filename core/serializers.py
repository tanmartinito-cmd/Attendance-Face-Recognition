"""
API serializers for the academic structure and attendance.

JSON keys follow the existing API contract the frontend uses (e.g. `program_section` for the
section template, `course` = course code and `course_ref` = course id, `day_of_week` / `day_2`
for meeting days). Underneath, the data comes from the normalized models.
"""
from django.db.models import Q
from rest_framework import serializers

from accounts.serializers import InstructorSerializer, StudentSerializer
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassSection, Course, Enrollment,
    Instructor, Program, SectionTemplate, SessionReopenLog, Subject, DAY_CHOICES,
)


def _is_status_only_update(serializer, attrs):
    """True for PATCH requests that only toggle is_active (activate / deactivate)."""
    return bool(serializer.instance) and serializer.partial and set(attrs) <= {'is_active'}


def _person_name(instructor):
    if instructor and instructor.user_id:
        return instructor.user.get_full_name() or instructor.user.username
    return None


# ── Programs & courses ────────────────────────────────────────────────────────
class CourseSerializer(serializers.ModelSerializer):
    program_details = serializers.SerializerMethodField()

    class Meta:
        model = Course
        fields = ['id', 'program', 'program_details', 'code', 'name', 'description', 'is_active', 'created_at']
        read_only_fields = ['created_at']

    def get_program_details(self, obj):
        return {'id': obj.program_id, 'code': obj.program.code, 'name': obj.program.name} if obj.program_id else None


class ProgramSerializer(serializers.ModelSerializer):
    course_count = serializers.SerializerMethodField()
    section_count = serializers.SerializerMethodField()
    subject_count = serializers.SerializerMethodField()

    class Meta:
        model = Program
        fields = ['id', 'code', 'name', 'college', 'description', 'is_active', 'course_count', 'section_count', 'subject_count', 'created_at']

    def get_course_count(self, obj):
        return obj.courses.count()

    def get_section_count(self, obj):
        return ClassSection.objects.filter(template__course__program=obj).count()

    def get_subject_count(self, obj):
        return Subject.objects.filter(course__program=obj).count()


# ── Section templates (API name: program-sections) ────────────────────────────
class ProgramSectionSerializer(serializers.ModelSerializer):
    """A reusable section definition (SectionTemplate)."""
    program = serializers.PrimaryKeyRelatedField(queryset=Program.objects.all(), required=False, write_only=True)
    course_ref = serializers.PrimaryKeyRelatedField(source='course', queryset=Course.objects.all(), required=False)
    course_details = CourseSerializer(source='course', read_only=True)
    year_level_display = serializers.CharField(source='get_year_level_display', read_only=True)
    active_classes_count = serializers.SerializerMethodField()

    class Meta:
        model = SectionTemplate
        fields = [
            'id', 'program', 'course_ref', 'course_details', 'name', 'year_level', 'year_level_display',
            'description', 'is_active', 'active_classes_count', 'created_at',
        ]
        read_only_fields = ['created_at']

    def validate(self, attrs):
        if _is_status_only_update(self, attrs):
            return attrs
        program = attrs.pop('program', None)
        course = attrs.get('course', getattr(self.instance, 'course', None))
        if not course:
            raise serializers.ValidationError({'course_ref': 'Select a Course from Course Management.'})
        if program and course.program_id != program.pk:
            raise serializers.ValidationError({'course_ref': 'The selected Course does not belong to the selected Program.'})
        name = attrs.get('name', getattr(self.instance, 'name', None))
        duplicate = SectionTemplate.objects.filter(course=course, name__iexact=name)
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if name and duplicate.exists():
            raise serializers.ValidationError({'name': f'Section "{name}" already exists for {course.code}.'})
        return attrs

    def to_representation(self, obj):
        data = super().to_representation(obj)
        program = obj.course.program
        data['program'] = program.pk
        data['program_details'] = ProgramSerializer(program, context=self.context).data
        data['course'] = obj.course.code
        return data

    def get_active_classes_count(self, obj):
        return obj.class_sections.count()


# ── Subjects ──────────────────────────────────────────────────────────────────
class SubjectSerializer(serializers.ModelSerializer):
    program = serializers.PrimaryKeyRelatedField(queryset=Program.objects.all(), required=False, allow_null=True, write_only=True)
    course_ref = serializers.PrimaryKeyRelatedField(source='course', queryset=Course.objects.all(), required=False, allow_null=True)
    course_details = CourseSerializer(source='course', read_only=True)
    section = serializers.PrimaryKeyRelatedField(queryset=ClassSection.objects.all(), required=False, allow_null=True)
    section_name = serializers.SerializerMethodField()
    instructor = serializers.PrimaryKeyRelatedField(queryset=Instructor.objects.all(), required=False, allow_null=True)
    instructor_details = InstructorSerializer(source='instructor', read_only=True)
    student_count = serializers.SerializerMethodField()

    class Meta:
        model = Subject
        fields = [
            'id', 'name', 'code', 'description', 'units', 'is_active', 'program', 'course_ref', 'course_details',
            'section', 'section_name', 'instructor', 'instructor_details', 'student_count', 'created_at',
        ]
        read_only_fields = ['created_at']

    def validate(self, attrs):
        if _is_status_only_update(self, attrs):
            return attrs
        program = attrs.pop('program', None)
        course = attrs.get('course')
        section = attrs.get('section')
        if course and program and course.program_id != program.pk:
            raise serializers.ValidationError({'course_ref': 'The selected Course does not belong to the selected Program.'})
        if course and section and section.course.pk != course.pk:
            raise serializers.ValidationError({'course_ref': 'The selected Course does not belong to the selected Section.'})
        if section and not course:
            attrs['course'] = section.course
        return attrs

    def to_representation(self, obj):
        data = super().to_representation(obj)
        program = obj.program
        data['program'] = program.pk if program else None
        data['program_details'] = ProgramSerializer(program, context=self.context).data if program else None
        return data

    def get_section_name(self, obj):
        return obj.section.name if obj.section_id else ''

    def get_student_count(self, obj):
        if not obj.section_id:
            return 0
        return Enrollment.objects.filter(
            Q(section_id=obj.section_id) & (Q(subject__isnull=True) | Q(subject_id=obj.id))
        ).values('student_id').distinct().count()


# ── Schedules ─────────────────────────────────────────────────────────────────
class ScheduleSerializer(serializers.ModelSerializer):
    section = serializers.PrimaryKeyRelatedField(queryset=ClassSection.objects.all())
    subject = serializers.PrimaryKeyRelatedField(queryset=Subject.objects.all(), required=False, allow_null=True)
    day_of_week = serializers.ChoiceField(choices=DAY_CHOICES)
    day_2 = serializers.ChoiceField(choices=DAY_CHOICES, required=False, allow_null=True, allow_blank=True)
    section_name = serializers.SerializerMethodField()
    day_display = serializers.CharField(source='get_day_of_week_display', read_only=True)
    days_display = serializers.CharField(read_only=True)
    time_display = serializers.CharField(read_only=True)
    full_days_display = serializers.CharField(read_only=True)
    subject_details = SubjectSerializer(source='subject', read_only=True)
    subject_code = serializers.SerializerMethodField()
    subject_name = serializers.SerializerMethodField()
    instructor_name = serializers.SerializerMethodField()

    class Meta:
        model = ClassSchedule
        fields = [
            'id', 'section', 'section_name', 'subject', 'subject_details', 'day_of_week', 'day_2', 'day_display',
            'days_display', 'full_days_display', 'start_time', 'end_time', 'time_display', 'room',
            'effective_from', 'effective_to', 'subject_code', 'subject_name', 'instructor_name',
        ]

    def _apply_days(self, instance, validated_data):
        first = validated_data.pop('day_of_week', None)
        second = validated_data.pop('day_2', None) if 'day_2' in validated_data else ...
        if first is None and second is ...:
            return
        current = instance.meeting_days if instance.pk else []
        first = first or (current[0] if current else '')
        if second is ...:
            second = current[1] if len(current) > 1 else None
        instance.set_days([first] + ([second] if second and second != first else []))

    def create(self, validated_data):
        schedule = ClassSchedule(**{k: v for k, v in validated_data.items() if k not in ('day_of_week', 'day_2')})
        self._apply_days(schedule, validated_data)
        schedule.save()  # model validation checks days and room/instructor conflicts
        return schedule

    def update(self, instance, validated_data):
        self._apply_days(instance, validated_data)
        for key, value in validated_data.items():
            setattr(instance, key, value)
        instance.save()
        return instance

    def _subject(self, obj):
        return obj.subject if obj.subject_id else (obj.section.effective_subject if obj.section_id else None)

    def get_section_name(self, obj):
        return obj.section.name if obj.section_id else ''

    def get_subject_code(self, obj):
        subject = self._subject(obj)
        return subject.code if subject else '—'

    def get_subject_name(self, obj):
        subject = self._subject(obj)
        return subject.name if subject else ''

    def get_instructor_name(self, obj):
        return (_person_name(obj.instructor) if obj.section_id else None) or '—'


# ── Enrollments ───────────────────────────────────────────────────────────────
class StudentSectionSerializer(serializers.ModelSerializer):
    """An enrollment (API key names kept)."""
    student_details = StudentSerializer(source='student', read_only=True)
    subject_details = SubjectSerializer(source='subject', read_only=True)
    subject_code = serializers.CharField(source='subject.code', read_only=True, default=None)
    subject_name = serializers.CharField(source='subject.name', read_only=True, default=None)
    is_irregular = serializers.BooleanField(read_only=True)

    class Meta:
        model = Enrollment
        fields = [
            'id', 'student', 'student_details', 'section', 'subject', 'subject_details',
            'subject_code', 'subject_name', 'is_irregular', 'enrolled_at',
        ]


EnrollmentSerializer = StudentSectionSerializer


# ── Class sections ────────────────────────────────────────────────────────────
class SectionSerializer(serializers.ModelSerializer):
    """A class section. Name / course / program / year come from its section template."""
    program_section = serializers.PrimaryKeyRelatedField(source='template', queryset=SectionTemplate.objects.all(), required=False)
    program = serializers.PrimaryKeyRelatedField(queryset=Program.objects.all(), required=False, allow_null=True, write_only=True)
    course_ref = serializers.PrimaryKeyRelatedField(queryset=Course.objects.all(), required=False, allow_null=True, write_only=True)
    school_year = serializers.CharField(required=False, max_length=20)
    semester = serializers.ChoiceField(choices=AcademicTerm.Semester.choices, required=False)
    instructor = serializers.PrimaryKeyRelatedField(queryset=Instructor.objects.all(), required=False, allow_null=True)
    instructor_details = InstructorSerializer(source='instructor', read_only=True)
    schedule_display = serializers.ReadOnlyField()
    effective_subject_code = serializers.SerializerMethodField()
    effective_subject_name = serializers.SerializerMethodField()
    subjects = serializers.SerializerMethodField()
    schedules = serializers.SerializerMethodField()
    student_count = serializers.SerializerMethodField()

    class Meta:
        model = ClassSection
        fields = [
            'id', 'program_section', 'program', 'course_ref', 'school_year', 'semester', 'instructor',
            'instructor_details', 'is_active', 'schedule_display', 'effective_subject_code',
            'effective_subject_name', 'subjects', 'schedules', 'student_count', 'created_at',
        ]
        read_only_fields = ['created_at']

    def validate(self, attrs):
        if _is_status_only_update(self, attrs):
            return attrs
        template = attrs.get('template', getattr(self.instance, 'template', None))
        program = attrs.pop('program', None)
        course = attrs.pop('course_ref', None)
        if not template:
            raise serializers.ValidationError({'program_section': 'Select a Section Catalog definition.'})
        if program and program.pk != template.course.program_id:
            raise serializers.ValidationError({'program_section': 'The selected Section Catalog definition does not belong to the selected Program.'})
        if course and course.pk != template.course_id:
            raise serializers.ValidationError({'program_section': 'The selected Section Catalog definition does not belong to the selected Course.'})

        current_term = getattr(self.instance, 'term', None)
        school_year = attrs.pop('school_year', None) or getattr(current_term, 'school_year', None) or '2025-2026'
        semester = attrs.pop('semester', None) or getattr(current_term, 'semester', None) or AcademicTerm.Semester.FIRST
        attrs['term'], _ = AcademicTerm.objects.get_or_create(school_year=school_year.strip(), semester=semester)
        duplicate = ClassSection.objects.filter(template=template, term=attrs['term'])
        if self.instance:
            duplicate = duplicate.exclude(pk=self.instance.pk)
        if duplicate.exists():
            raise serializers.ValidationError({'program_section': f'{template.name} is already offered in {attrs["term"]}.'})
        return attrs

    def to_representation(self, obj):
        data = super().to_representation(obj)
        template, course = obj.template, obj.template.course
        program = course.program
        first = obj.effective_subject
        data.update({
            'name': template.name,
            'year_level': template.year_level,
            'year_level_display': template.get_year_level_display(),
            'program_section_details': ProgramSectionSerializer(template, context=self.context).data,
            'course': course.code,
            'course_ref': course.pk,
            'course_details': CourseSerializer(course, context=self.context).data,
            'program': program.pk,
            'program_details': ProgramSerializer(program, context=self.context).data,
            'school_year': obj.term.school_year,
            'semester': obj.term.semester,
            'subject': first.pk if first else None,
            'subject_details': SubjectSerializer(first, context=self.context).data if first else None,
        })
        return data

    def get_effective_subject_code(self, obj):
        subject = obj.effective_subject
        return subject.code if subject else '—'

    def get_effective_subject_name(self, obj):
        subject = obj.effective_subject
        return subject.name if subject else ''

    def get_student_count(self, obj):
        return obj.enrollments.values('student_id').distinct().count()

    def _visible_subject_ids(self, obj):
        from core.services.enrollment_service import EnrollmentService
        request = self.context.get('request')
        user = getattr(request, 'user', None)
        return EnrollmentService.visible_subject_ids(user, obj) if user and user.is_authenticated else None

    def get_subjects(self, obj):
        subjects = obj.subjects.all()
        allowed = self._visible_subject_ids(obj)
        if allowed is not None:
            subjects = subjects.filter(id__in=allowed) if allowed else subjects.none()
        return SubjectSerializer(subjects, many=True, context=self.context).data

    def get_schedules(self, obj):
        schedules = obj.schedules.all().prefetch_related('days')
        allowed = self._visible_subject_ids(obj)
        if allowed is not None:
            schedules = schedules.filter(subject_id__in=allowed) if allowed else schedules.none()
        return ScheduleSerializer(schedules, many=True, context=self.context).data


# ── Attendance ────────────────────────────────────────────────────────────────
class AttendanceRecordSerializer(serializers.ModelSerializer):
    student_details = StudentSerializer(source='student', read_only=True)
    student_info = StudentSerializer(source='student', read_only=True)
    student_name = serializers.SerializerMethodField()
    student_id_number = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceRecord
        fields = [
            'id', 'session', 'student', 'student_details', 'student_info', 'student_name',
            'student_id_number', 'status', 'recognized_at', 'confidence_score', 'remarks',
        ]

    def get_student_name(self, obj):
        if obj.student_id:
            return obj.student.user.get_full_name() or obj.student.user.username
        return 'Unknown Student'

    def get_student_id_number(self, obj):
        return obj.student.student_id if obj.student_id else ''


class AttendanceSessionSerializer(serializers.ModelSerializer):
    schedule_details = ScheduleSerializer(source='schedule', read_only=True)
    summary = serializers.SerializerMethodField()
    section_name = serializers.SerializerMethodField()
    subject_code = serializers.SerializerMethodField()
    subject_name = serializers.SerializerMethodField()
    schedule_display = serializers.SerializerMethodField()
    room = serializers.SerializerMethodField()
    instructor_name = serializers.SerializerMethodField()
    started_by_name = serializers.SerializerMethodField()

    class Meta:
        model = AttendanceSession
        fields = [
            'id', 'schedule', 'schedule_details', 'section_name', 'subject_code', 'subject_name',
            'schedule_display', 'room', 'instructor_name', 'started_by_name',
            'date', 'started_by', 'status', 'start_mode', 'late_reason', 'was_reopened',
            'created_at', 'closed_at', 'summary',
        ]

    was_reopened = serializers.SerializerMethodField()

    def get_was_reopened(self, obj):
        return obj.reopen_history.exists()

    def _subject(self, obj):
        schedule = obj.schedule
        return schedule.subject if schedule.subject_id else schedule.section.effective_subject

    def get_summary(self, obj):
        from core.services.attendance_service import AttendanceService
        return AttendanceService.get_session_summary(obj)

    def get_section_name(self, obj):
        return obj.schedule.section.name

    def get_subject_code(self, obj):
        subject = self._subject(obj)
        return subject.code if subject else '—'

    def get_subject_name(self, obj):
        subject = self._subject(obj)
        return subject.name if subject else ''

    def get_schedule_display(self, obj):
        schedule = obj.schedule
        parts = [f'{schedule.days_display} {schedule.time_display}'.strip(), f'@{schedule.room}' if schedule.room else '']
        return ' '.join(p for p in parts if p) or '—'

    def get_room(self, obj):
        return obj.schedule.room or ''

    def get_instructor_name(self, obj):
        return _person_name(obj.schedule.instructor) or '—'

    def get_started_by_name(self, obj):
        return _person_name(obj.started_by) or self.get_instructor_name(obj)


class SessionReopenLogSerializer(serializers.ModelSerializer):
    reopened_by_name = serializers.SerializerMethodField()

    class Meta:
        model = SessionReopenLog
        fields = ['id', 'session', 'reopened_by', 'reopened_by_name', 'reason', 'reopened_at']
        read_only_fields = fields

    def get_reopened_by_name(self, obj):
        return _person_name(obj.reopened_by)
