"""
Attendance Serializers
Handles serialization and input validation for attendance sessions, records, and marking.
"""
from rest_framework import serializers
from core.serializers import AttendanceRecordSerializer, AttendanceSessionSerializer, SessionReopenLogSerializer


class AttendanceSessionStartSerializer(serializers.Serializer):
    """
    Validates payload for starting or resuming an attendance session.
    start_mode is only needed when the instructor starts late (the API answers 409 late_start):
      'present' -> students scanned within the grace period after starting are Present
      'late'    -> every scan is Late; `reason` is required and saved on each late record
    """
    schedule_id = serializers.IntegerField(required=True)
    start_mode = serializers.ChoiceField(choices=['present', 'late'], required=False)
    reason = serializers.CharField(required=False, allow_blank=True, max_length=300, trim_whitespace=True, default='')

    def validate(self, attrs):
        if attrs.get('start_mode') == 'late' and len(attrs.get('reason', '')) < 3:
            raise serializers.ValidationError({'reason': 'Give a reason (at least 3 characters) for marking students late.'})
        return attrs


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
