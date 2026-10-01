"""
Output serializers for users, instructors and students.

The JSON keys match what the frontend reads (e.g. `first_name`, `phone`, `profile_image`,
student `course` code + `course_ref` id, flat address keys). Values come from the
normalized tables through accounts.profile_data.
"""
from rest_framework import serializers

from accounts.models import User
from accounts.profile_data import contact_number, photo_url, read_personal
from core.models import Instructor, Student


class UserSerializer(serializers.ModelSerializer):
    first_name = serializers.SerializerMethodField()
    last_name = serializers.SerializerMethodField()
    phone = serializers.SerializerMethodField()
    profile_image = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'username', 'first_name', 'last_name', 'email', 'role', 'phone', 'is_active', 'profile_image']
        read_only_fields = fields

    def get_first_name(self, obj):
        return obj.first_name

    def get_last_name(self, obj):
        return obj.last_name

    def get_phone(self, obj):
        return contact_number(obj)

    def get_profile_image(self, obj):
        return photo_url(obj)


class InstructorSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    contact_number = serializers.SerializerMethodField()

    class Meta:
        model = Instructor
        fields = [
            'id', 'user', 'faculty_id', 'department', 'specialization', 'title', 'date_hired',
            'employment_status', 'position', 'contact_number', 'office_location', 'consultation_hours',
            'education_background', 'certifications',
        ]
        read_only_fields = fields

    def get_contact_number(self, obj):
        return contact_number(obj.user)


class StudentSerializer(serializers.ModelSerializer):
    user = UserSerializer(read_only=True)
    course = serializers.SerializerMethodField()
    course_ref = serializers.SerializerMethodField()
    course_details = serializers.SerializerMethodField()
    program_code = serializers.SerializerMethodField()
    program_name = serializers.SerializerMethodField()
    display_academic_program = serializers.SerializerMethodField()
    is_face_enrolled = serializers.SerializerMethodField()
    face_enrolled_at = serializers.SerializerMethodField()
    face_image = serializers.SerializerMethodField()

    PERSONAL_KEYS = [
        'middle_name', 'gender', 'birth_date', 'birth_place', 'civil_status', 'blood_type', 'height',
        'religion', 'citizenship', 'languages_spoken',
        'current_address', 'current_region', 'current_province', 'current_municipality',
        'permanent_address', 'permanent_region', 'permanent_province', 'permanent_municipality',
        'telephone', 'mobile_number',
    ]

    class Meta:
        model = Student
        fields = [
            'id', 'user', 'student_id', 'year_level', 'course', 'course_ref', 'course_details',
            'program_code', 'program_name', 'display_academic_program',
            'is_face_enrolled', 'face_enrolled_at', 'face_image',
        ]
        read_only_fields = fields

    def to_representation(self, obj):
        data = super().to_representation(obj)
        personal = read_personal(obj.user)
        data.update({key: personal.get(key) for key in self.PERSONAL_KEYS})
        return data

    def get_course(self, obj):
        return obj.course.code if obj.course_id else ''

    def get_course_ref(self, obj):
        return obj.course_id

    def get_course_details(self, obj):
        if not obj.course_id:
            return None
        course = obj.course
        return {
            'id': course.pk,
            'program_id': course.program_id,
            'program_code': course.program.code,
            'code': course.code,
            'name': course.name,
        }

    def _program(self, obj):
        return obj.course.program if obj.course_id else None

    def get_program_code(self, obj):
        program = self._program(obj)
        return program.code if program else ''

    def get_program_name(self, obj):
        program = self._program(obj)
        return program.name if program else ''

    def get_display_academic_program(self, obj):
        code = self.get_program_code(obj)
        course = self.get_course(obj)
        return f'{code} • {course}' if code and course else (course or code)

    def get_is_face_enrolled(self, obj):
        return obj.is_face_enrolled

    def get_face_enrolled_at(self, obj):
        bio = obj.biometric_or_none
        return bio.enrolled_at if bio else None

    def get_face_image(self, obj):
        """Short-lived signed link, only for users allowed to see the photo; else None."""
        from attendance_fr.face_photos import face_photo_link
        request = self.context.get('request')
        return face_photo_link(obj, user=getattr(request, 'user', None) if request is not None else None)


class CurrentUserProfileSerializer(UserSerializer):
    """A user with their role-specific record (instructor_profile / student_profile)."""
    instructor_profile = serializers.SerializerMethodField()
    student_profile = serializers.SerializerMethodField()
    face_enrollment_required = serializers.SerializerMethodField()

    class Meta(UserSerializer.Meta):
        fields = UserSerializer.Meta.fields + ['instructor_profile', 'student_profile', 'face_enrollment_required']
        read_only_fields = fields

    def get_face_enrollment_required(self, obj):
        """True when this student must enroll their face before using the app."""
        from attendance_fr.api.services.auth import face_enrollment_required
        return face_enrollment_required(obj)

    def get_instructor_profile(self, obj):
        instructor = getattr(obj, 'instructor', None) if hasattr(obj, 'instructor') else None
        return InstructorSerializer(instructor, context=self.context).data if instructor else None

    def get_student_profile(self, obj):
        student = getattr(obj, 'student', None) if hasattr(obj, 'student') else None
        return StudentSerializer(student, context=self.context).data if student else None
