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
    def scheduled_start(session):
        return timezone.make_aware(timezone.datetime.combine(session.date, session.schedule.start_time))

    @staticmethod
    def calculate_attendance_status(session, scan_time=None):
        """
        Present or late for a scan at `scan_time` (None = 'present').
        - Reopened session: the instructor closed it and reopened it for latecomers -> 'late'.
        - Started late, instructor chose "Late": every scan -> 'late'.
        - Started late, instructor chose "Present": the instructor caused the delay, so the
          LATE_THRESHOLD_MINUTES grace starts when attendance was started, not at the scheduled time.
        - On time: grace counted from the scheduled class start.
        """
        if scan_time is None:
            return 'present'
        if session.pk and session.reopen_history.exists():
            return 'late'
        mode = getattr(session, 'start_mode', 'on_time')
        if mode == 'late':
            return 'late'
        base = session.created_at if mode == 'present' and session.created_at else AttendanceService.scheduled_start(session)
        threshold_seconds = AttendanceService.get_late_threshold_minutes() * 60
        return 'late' if (scan_time - base).total_seconds() > threshold_seconds else 'present'

    @staticmethod
    def late_note(session):
        """Why a scan in this session is late (saved in the record's remarks), or ''."""
        if session.pk:
            reopen = session.reopen_history.order_by('-reopened_at').first()
            if reopen:
                return f'Reopened session: {reopen.reason}'[:200]
        if getattr(session, 'start_mode', '') == 'late' and session.late_reason:
            return f'Late start: {session.late_reason}'[:200]
        return ''

    @staticmethod
    def minutes_late_now(schedule, now=None):
        """Whole minutes the class has been running already (0 before / at the start)."""
        now = timezone.localtime(now or timezone.now())
        start = timezone.make_aware(timezone.datetime.combine(now.date(), schedule.start_time))
        return max(0, int((now - start).total_seconds() // 60))

    @staticmethod
    def mark_attendance(session, student, confidence=1.0, scan_time=None):
        """First recognition marks present/late; later scans keep the original mark."""
        if scan_time is None:
            scan_time = timezone.now()
        record, _created = AttendanceRecord.objects.get_or_create(
            session=session, student=student, defaults={'status': 'absent'},
        )
        if record.status != 'absent':
            return record, False
        new_status = AttendanceService.calculate_attendance_status(session, scan_time)
        remarks = AttendanceService.late_note(session) if new_status == 'late' else ''
        # Atomic "absent -> present/late": the database changes the row only if it is still
        # absent, so two scans (or two server workers) confirming the same student at the same
        # moment produce ONE mark, and the first time-in is never overwritten.
        updated = AttendanceRecord.objects.filter(pk=record.pk, status='absent').update(
            status=new_status, recognized_at=scan_time, confidence_score=round(confidence, 4),
            remarks=remarks,
        )
        record.refresh_from_db()
        if updated:
            # .update() skips post_save; send it so caches / live sync refresh as before.
            from django.db.models.signals import post_save
            post_save.send(sender=AttendanceRecord, instance=record, created=False,
                           update_fields={'status', 'recognized_at', 'confidence_score', 'remarks'},
                           raw=False, using=record._state.db)
        return record, bool(updated)

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
