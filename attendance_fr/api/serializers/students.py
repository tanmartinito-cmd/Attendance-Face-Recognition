"""
Student & User Serializers
Handles serialization and input payload validation for students, instructors, and users.
"""
from rest_framework import serializers
from accounts.serializers import InstructorSerializer, StudentSerializer, UserSerializer


class UserCreateInputSerializer(serializers.Serializer):
    """Validates payload for admin user creation."""
    role = serializers.ChoiceField(choices=['admin', 'instructor', 'student'], default='instructor')
    username = serializers.CharField(required=False, allow_blank=True, max_length=150)
    password = serializers.CharField(required=False, allow_blank=True, min_length=8)
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=30)
    mobile_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    is_active = serializers.BooleanField(required=False, default=True)

    # Instructor specific
    faculty_id = serializers.CharField(required=False, allow_blank=True, max_length=50)
    department = serializers.CharField(required=False, allow_blank=True, max_length=100)
    specialization = serializers.CharField(required=False, allow_blank=True, max_length=150)
    title = serializers.CharField(required=False, allow_blank=True, max_length=50)
    date_hired = serializers.DateField(required=False, allow_null=True)
    employment_status = serializers.CharField(required=False, allow_blank=True, max_length=50)
    position = serializers.CharField(required=False, allow_blank=True, max_length=100)
    contact_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    office_location = serializers.CharField(required=False, allow_blank=True, max_length=150)
    consultation_hours = serializers.CharField(required=False, allow_blank=True)
    education_background = serializers.CharField(required=False, allow_blank=True)
    certifications = serializers.CharField(required=False, allow_blank=True)

    # Student specific
    student_id = serializers.CharField(required=False, allow_blank=True, max_length=50)
    course = serializers.CharField(required=False, allow_blank=True, max_length=100)
    course_ref = serializers.IntegerField(required=False, allow_null=True)
    year_level = serializers.IntegerField(required=False, default=1)


class UserUpdateInputSerializer(serializers.Serializer):
    """Validates payload for admin user updates."""
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=30)
    role = serializers.ChoiceField(choices=['admin', 'instructor', 'student'], required=False)
    password = serializers.CharField(required=False, allow_blank=True, min_length=8)
    is_active = serializers.BooleanField(required=False)

    # Profile updates
    faculty_id = serializers.CharField(required=False, allow_blank=True, max_length=50)
    department = serializers.CharField(required=False, allow_blank=True, max_length=100)
    specialization = serializers.CharField(required=False, allow_blank=True, max_length=150)
    title = serializers.CharField(required=False, allow_blank=True, max_length=50)
    date_hired = serializers.DateField(required=False, allow_null=True)
    employment_status = serializers.CharField(required=False, allow_blank=True, max_length=50)
    position = serializers.CharField(required=False, allow_blank=True, max_length=100)
    contact_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    office_location = serializers.CharField(required=False, allow_blank=True, max_length=150)
    consultation_hours = serializers.CharField(required=False, allow_blank=True)
    education_background = serializers.CharField(required=False, allow_blank=True)
    certifications = serializers.CharField(required=False, allow_blank=True)
    student_id = serializers.CharField(required=False, allow_blank=True, max_length=50)
    course = serializers.CharField(required=False, allow_blank=True, max_length=100)
    course_ref = serializers.IntegerField(required=False, allow_null=True)
    year_level = serializers.IntegerField(required=False)
    
    # Additional student profile fields
    middle_name = serializers.CharField(required=False, allow_blank=True, max_length=150)
    birth_date = serializers.DateField(required=False, allow_null=True)
    birth_place = serializers.CharField(required=False, allow_blank=True, max_length=200)
    gender = serializers.CharField(required=False, allow_blank=True, max_length=20)
    civil_status = serializers.CharField(required=False, allow_blank=True, max_length=50)
    religion = serializers.CharField(required=False, allow_blank=True, max_length=100)
    citizenship = serializers.CharField(required=False, allow_blank=True, max_length=100)
    current_address = serializers.CharField(required=False, allow_blank=True, max_length=500)
    mobile_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    telephone = serializers.CharField(required=False, allow_blank=True, max_length=30)
    
    def validate_birth_date(self, value):
        """Convert empty string to None for birth_date field."""
        if value == '':
            return None
        return value
    
    def validate_date_hired(self, value):
        """Convert empty string to None for date_hired field."""
        if value == '':
            return None
        return value
