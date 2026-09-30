"""
Authentication & self-service profile serializers.
"""
from rest_framework import serializers

from accounts.serializers import CurrentUserProfileSerializer

__all__ = ['CurrentUserProfileSerializer', 'UserProfileUpdateSerializer']


class UserProfileUpdateSerializer(serializers.Serializer):
    """Fields a signed-in user may change on their own profile."""
    first_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    last_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    email = serializers.EmailField(required=False, allow_blank=True)
    phone = serializers.CharField(required=False, allow_blank=True, max_length=30)

    # Instructor-maintained professional/contact details. HR identity fields stay read-only.
    specialization = serializers.CharField(required=False, allow_blank=True, max_length=150)
    title = serializers.CharField(required=False, allow_blank=True, max_length=50)
    contact_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
    office_location = serializers.CharField(required=False, allow_blank=True, max_length=150)
    consultation_hours = serializers.CharField(required=False, allow_blank=True)
    education_background = serializers.CharField(required=False, allow_blank=True)
    certifications = serializers.CharField(required=False, allow_blank=True)

    # Personal and contact details. Academic identity stays read-only.
    middle_name = serializers.CharField(required=False, allow_blank=True, max_length=100)
    gender = serializers.CharField(required=False, allow_blank=True, max_length=10)
    birth_date = serializers.DateField(required=False, allow_null=True)
    birth_place = serializers.CharField(required=False, allow_blank=True, max_length=150)
    civil_status = serializers.CharField(required=False, allow_blank=True, max_length=30)
    blood_type = serializers.CharField(required=False, allow_blank=True, max_length=10)
    height = serializers.CharField(required=False, allow_blank=True, max_length=20)
    religion = serializers.CharField(required=False, allow_blank=True, max_length=100)
    citizenship = serializers.CharField(required=False, allow_blank=True, max_length=50)
    languages_spoken = serializers.CharField(required=False, allow_blank=True, max_length=255)
    current_address = serializers.CharField(required=False, allow_blank=True, max_length=255)
    current_region = serializers.CharField(required=False, allow_blank=True, max_length=100)
    current_province = serializers.CharField(required=False, allow_blank=True, max_length=100)
    current_municipality = serializers.CharField(required=False, allow_blank=True, max_length=100)
    permanent_address = serializers.CharField(required=False, allow_blank=True, max_length=255)
    permanent_region = serializers.CharField(required=False, allow_blank=True, max_length=100)
    permanent_province = serializers.CharField(required=False, allow_blank=True, max_length=100)
    permanent_municipality = serializers.CharField(required=False, allow_blank=True, max_length=100)
    telephone = serializers.CharField(required=False, allow_blank=True, max_length=30)
    mobile_number = serializers.CharField(required=False, allow_blank=True, max_length=30)
