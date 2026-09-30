"""
Classes & academic structure serializers (programs, section templates, subjects, class
sections, schedules, enrollments). Course serialization lives in courses.py.
"""
from rest_framework import serializers

from core.serializers import (
    EnrollmentSerializer,
    ProgramSectionSerializer,
    ProgramSerializer,
    ScheduleSerializer,
    SectionSerializer,
    StudentSectionSerializer,
    SubjectSerializer,
)

__all__ = [
    'EnrollmentSerializer', 'ProgramSectionSerializer', 'ProgramSerializer', 'ScheduleSerializer',
    'SectionEnrollmentCreateSerializer', 'SectionSerializer', 'StudentSectionSerializer', 'SubjectSerializer',
]


class SectionEnrollmentCreateSerializer(serializers.Serializer):
    """Validates student enrollment into a class section."""
    student_id = serializers.IntegerField(required=False)
    student = serializers.IntegerField(required=False)
    subject_id = serializers.IntegerField(required=False, allow_null=True)
    subject = serializers.IntegerField(required=False, allow_null=True)

    def validate(self, attrs):
        sid = attrs.get('student_id') or attrs.get('student')
        if not sid:
            raise serializers.ValidationError({'student_id': 'Student is required.'})
        attrs['student_id'] = sid
        attrs['subject_id'] = attrs.get('subject_id') or attrs.get('subject') or None
        return attrs
