"""
Attendance Serializers
Handles serialization and input validation for attendance sessions, records, and marking.
"""
from rest_framework import serializers
from core.serializers import AttendanceRecordSerializer, AttendanceSessionSerializer, SessionReopenLogSerializer


class AttendanceSessionStartSerializer(serializers.Serializer):
    """Validates payload for starting or resuming an attendance session."""
    schedule_id = serializers.IntegerField(required=True)


class AttendanceSessionReopenSerializer(serializers.Serializer):
    """Requires an accountable explanation before reopening a closed session."""
    reason = serializers.CharField(min_length=3, max_length=300, trim_whitespace=True)


AttendanceSessionReopenAuditSerializer = SessionReopenLogSerializer  # name used by the attendance views


class ManualAttendanceMarkSerializer(serializers.Serializer):
    """Validates payload for manually marking student attendance."""
    session_id = serializers.IntegerField(required=True)
    student_id = serializers.IntegerField(required=True)
    status = serializers.ChoiceField(choices=['present', 'late', 'absent', 'excused'], default='present')
    notes = serializers.CharField(required=False, allow_blank=True, default='')
