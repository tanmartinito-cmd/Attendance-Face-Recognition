"""
Attendance marking (present / late) and per-session summaries.
"""
from django.conf import settings
from django.db.models import Q
from django.utils import timezone

from core.models import AttendanceRecord, Enrollment


class AttendanceService:
    @staticmethod
    def get_late_threshold_minutes():
        return getattr(settings, 'LATE_THRESHOLD_MINUTES', 15)

    @staticmethod
    def calculate_attendance_status(session, scan_time=None):
        """
        Live scanning (scan_time None) marks 'present'. With a scan time, 'late' is measured
        from the scheduled class start (not from when the scanner was opened).
        """
        if scan_time is None:
            return 'present'
        threshold_seconds = AttendanceService.get_late_threshold_minutes() * 60
        start = timezone.make_aware(timezone.datetime.combine(session.date, session.schedule.start_time))
        return 'late' if (scan_time - start).total_seconds() > threshold_seconds else 'present'

    @staticmethod
    def mark_attendance(session, student, confidence=1.0, scan_time=None):
        """First recognition marks present/late; later scans keep the original mark."""
        if scan_time is None:
            scan_time = timezone.now()
        record, _created = AttendanceRecord.objects.get_or_create(
            session=session, student=student, defaults={'status': 'absent'},
        )
        if record.status == 'absent':
            record.status = AttendanceService.calculate_attendance_status(session, scan_time)
            record.recognized_at = scan_time
            record.confidence_score = round(confidence, 4)
            record.save()
            return record, True
        return record, False

    @staticmethod
    def roster_filter(schedule):
        """Enrollments that belong to a class meeting: the block, plus irregulars of its subject."""
        q = Q(section_id=schedule.section_id)
        if schedule.subject_id:
            q &= Q(subject__isnull=True) | Q(subject_id=schedule.subject_id)
        return q

    @staticmethod
    def get_session_summary(session):
        records = session.records.all()
        total_enrolled = Enrollment.objects.filter(section_id=session.schedule.section_id).count()
        present = records.filter(status='present').count()
        late = records.filter(status='late').count()
        excused = records.filter(status='excused').count()
        absent = max(0, total_enrolled - (present + late + excused))
        attended = present + late
        return {
            'total_enrolled': total_enrolled,
            'present': present,
            'late': late,
            'absent': absent,
            'excused': excused,
            'attendance_rate': round(attended / total_enrolled * 100, 1) if total_enrolled else 0.0,
        }
