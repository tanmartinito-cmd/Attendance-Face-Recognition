"""
Attendance sessions (start / close / reopen / manual marks) and student attendance reports.
"""
import calendar as cal_module

from django.db import transaction
from django.utils import timezone

from accounts.profile_data import photo_url
from core.models import AttendanceRecord, AttendanceSession, ClassSection, Enrollment, SessionReopenLog
from core.services.attendance_service import AttendanceService as MarkingService


def _fmt_time_12h(t):
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


def _name(instructor, default='Unassigned'):
    if instructor and instructor.user_id:
        return instructor.user.get_full_name() or instructor.user.username
    return default


WEEKDAY_CODES = {0: 'Mon', 1: 'Tue', 2: 'Wed', 3: 'Thu', 4: 'Fri', 5: 'Sat', 6: 'Sun'}


class AttendanceService:

    @staticmethod
    def verify_instructor_assignment(instructor, schedule):
        """True when the instructor teaches this class meeting."""
        section = schedule.section
        has_subject_instructor = section.subjects.filter(instructor__isnull=False).exists()
        return (
            (schedule.subject_id is not None and schedule.subject.instructor_id == instructor.pk)
            or (schedule.subject_id is None and section.subjects.filter(instructor=instructor).exists())
            or (not has_subject_instructor and section.instructor_id == instructor.pk)
        )

    @staticmethod
    def validate_schedule_time_window(schedule):
        """Error message when now is outside the class meeting, else None."""
        today = timezone.localdate()
        now_time = timezone.localtime(timezone.now()).time()
        if WEEKDAY_CODES.get(today.weekday(), '') not in schedule.meeting_days:
            return f'Attendance cannot be started today. This class only meets on {schedule.full_days_display}.'
        if now_time < schedule.start_time:
            return (
                "It's too early to start attendance. "
                f'Your class schedule begins at {_fmt_time_12h(schedule.start_time)}. '
                'Please wait until the class starts.'
            )
        if now_time > schedule.end_time:
            return (
                f'Attendance cannot be started. Your class schedule already ended at {_fmt_time_12h(schedule.end_time)}. '
                'The window for taking attendance has passed.'
            )
        return None

    @staticmethod
    def validate_session_time_window(session):
        return AttendanceService.validate_schedule_time_window(session.schedule)

    @staticmethod
    def inactive_offering_error(schedule):
        """Message when any part of the class is temporarily deactivated, else None."""
        section = schedule.section
        template = section.template
        for obj, label in (
            (schedule.subject if schedule.subject_id else None, 'subject'),
            (section, 'class section'),
            (template, 'section catalog entry'),
            (template.course, 'course'),
            (template.course.program, 'program'),
        ):
            if obj is not None and obj.is_active is False:
                return f'Attendance is unavailable because this {label} is temporarily deactivated.'
        return None

    @staticmethod
    @transaction.atomic
    def start_session(schedule, instructor=None):
        """Create today's session with every rostered student marked absent."""
        session = AttendanceSession.objects.create(
            schedule=schedule, date=timezone.localdate(), started_by=instructor, status='open',
        )
        student_ids = Enrollment.objects.filter(MarkingService.roster_filter(schedule)).values_list('student_id', flat=True)
        AttendanceRecord.objects.bulk_create([
            AttendanceRecord(session=session, student_id=sid, status='absent') for sid in dict.fromkeys(student_ids)
        ])
        return session

    @staticmethod
    def close_session(session):
        session.status = 'closed'
        session.closed_at = timezone.now()
        session.save(update_fields=['status', 'closed_at'])
        return session

    @staticmethod
    @transaction.atomic
    def reopen_session(session, instructor, reason):
        """Reopen a closed session and keep an audit log entry."""
        session.status = 'open'
        session.closed_at = None
        session.save(update_fields=['status', 'closed_at'])
        log = SessionReopenLog.objects.create(session=session, reopened_by=instructor, reason=reason)
        return session, log

    @staticmethod
    def mark_manual(session, student, status_val):
        record, _ = AttendanceRecord.objects.get_or_create(session=session, student=student, defaults={'status': status_val})
        record.status = status_val
        if status_val in ('present', 'late'):
            record.recognized_at = timezone.now()
        record.save()
        return record

    @classmethod
    def get_student_overview(cls, student):
        return AttendanceReportService.get_student_overview(student)

    @classmethod
    def get_student_section_calendar(cls, student, section, target_year, target_month):
        return AttendanceReportService.get_student_section_calendar(student, section, target_year, target_month)


# ── Reports ───────────────────────────────────────────────────────────────────

class AttendanceReportService:

    STATUS_RANK = {'present': 4, 'late': 3, 'excused': 2, 'absent': 1}

    @classmethod
    def _deduplicate_by_date(cls, records):
        """One record per date, keeping the best status."""
        by_date = {}
        for r in records:
            d = r.session.date
            if d not in by_date or cls.STATUS_RANK.get(r.status, 0) > cls.STATUS_RANK.get(by_date[d].status, 0):
                by_date[d] = r
        return sorted(by_date.values(), key=lambda r: r.session.date, reverse=True)

    @staticmethod
    def _counts(records):
        counts = {s: sum(1 for r in records if r.status == s) for s in ('present', 'late', 'absent', 'excused')}
        total = len(records)
        attended = counts['present'] + counts['late']
        return counts, total, round(attended / total * 100, 1) if total else 0

    @staticmethod
    def _section_instructor(section):
        subject = section.effective_subject
        return (subject.instructor if subject and subject.instructor_id else None) or section.instructor

    @classmethod
    def get_student_overview(cls, student):
        sections = ClassSection.objects.filter(enrollments__student=student).select_related(
            'template', 'instructor__user__profile',
        ).prefetch_related('schedules__days', 'subjects__instructor__user__profile').distinct().order_by('template__name')

        cards = []
        totals = {'present': 0, 'late': 0, 'absent': 0, 'excused': 0, 'sessions': 0}
        for sec in sections:
            subject = sec.effective_subject
            records = cls._deduplicate_by_date(
                AttendanceRecord.objects.filter(student=student, session__schedule__section=sec)
                .select_related('session').order_by('-session__date')
            )
            counts, total, rate = cls._counts(records)
            for key in ('present', 'late', 'absent', 'excused'):
                totals[key] += counts[key]
            totals['sessions'] += total
            last = records[0] if records else None
            cards.append({
                'section_id': sec.id,
                'title': f"{sec.name} ({subject.name if subject else 'General Subject'})",
                'section_name': sec.name,
                'subject_name': subject.name if subject else 'General Subject',
                'subject_code': subject.code if subject else '—',
                'instructor_name': _name(sec.instructor),
                'schedule_display': sec.schedule_display,
                'total_sessions': total,
                'present_count': counts['present'],
                'late_count': counts['late'],
                'absent_count': counts['absent'],
                'excused_count': counts['excused'],
                'rate': rate,
                'last_date': last.session.date.strftime('%b %d, %Y') if last else None,
                'last_status': last.status if last else None,
            })

        attended = totals['present'] + totals['late']
        recent = []
        for r in AttendanceRecord.objects.filter(student=student).select_related(
            'session__schedule__section__template',
        ).order_by('-session__date', '-recognized_at')[:25]:
            sec = r.session.schedule.section
            subject = r.session.schedule.subject or sec.effective_subject
            recent.append({
                'id': r.id,
                'date': r.session.date.strftime('%b %d, %Y'),
                'subject_code': subject.code if subject else '—',
                'subject_name': subject.name if subject else 'General',
                'section_name': sec.name,
                'status': r.status,
                'status_display': r.get_status_display(),
                'time': r.recognized_at.strftime('%I:%M:%S %p') if r.recognized_at else '—',
            })

        bio = student.biometric_or_none
        return {
            'student': {
                'id': student.id,
                'full_name': student.user.get_full_name() or student.user.username,
                'username': student.user.username,
                'student_id': student.student_id,
                'course': student.course_code,
                'year_level': student.year_level,
                'is_face_enrolled': student.is_face_enrolled,
                'face_enrolled_at': bio.enrolled_at.isoformat() if bio else None,
                'profile_image': photo_url(student.user),
            },
            'overall_stats': {
                'rate': round(attended / totals['sessions'] * 100, 1) if totals['sessions'] else 0,
                'total_sessions': totals['sessions'],
                'present': totals['present'],
                'late': totals['late'],
                'absent': totals['absent'],
                'excused': totals['excused'],
            },
            'enrolled_cards': cards,
            'recent_records': recent,
        }

    @classmethod
    def get_student_section_calendar(cls, student, section, target_year, target_month):
        today = timezone.localdate()
        prev_year, prev_month = (target_year - 1, 12) if target_month == 1 else (target_year, target_month - 1)
        next_year, next_month = (target_year + 1, 1) if target_month == 12 else (target_year, target_month + 1)

        records = cls._deduplicate_by_date(
            AttendanceRecord.objects.filter(student=student, session__schedule__section=section)
            .select_related('session__schedule').order_by('-session__date', '-recognized_at')
        )
        counts, total, rate = cls._counts(records)

        by_date = {}
        for r in records:
            if r.session.date.year == target_year and r.session.date.month == target_month:
                by_date.setdefault(r.session.date, []).append(r)

        weeks = []
        for week in cal_module.Calendar(firstweekday=6).monthdatescalendar(target_year, target_month):
            days = []
            for d in week:
                day_records = by_date.get(d, [])
                days.append({
                    'date': d.isoformat(),
                    'day_num': d.day,
                    'is_current_month': d.month == target_month,
                    'is_today': d == today,
                    'has_attendance': bool(day_records),
                    'records': [{
                        'status': r.status,
                        'status_display': r.get_status_display(),
                        'time': r.recognized_at.strftime('%I:%M %p') if r.recognized_at else 'Class time',
                        'raw_time': r.recognized_at.strftime('%I:%M:%S %p') if r.recognized_at else '',
                    } for r in day_records],
                })
            weeks.append(days)

        logs = [{
            'id': r.id,
            'date': r.session.date.strftime('%b %d, %Y'),
            'day': r.session.date.strftime('%a'),
            'status': r.status,
            'status_display': r.get_status_display(),
            'time': r.recognized_at.strftime('%I:%M:%S %p') if r.recognized_at else 'Class time',
            'raw_date': r.session.date.isoformat(),
        } for r in records]

        subject = section.effective_subject
        return {
            'success': True,
            'student_name': student.user.get_full_name() or student.user.username,
            'student_id': student.student_id,
            'section_name': section.name,
            'subject_code': subject.code if subject else '—',
            'subject_name': subject.name if subject else 'General',
            'instructor_name': _name(cls._section_instructor(section)),
            'schedule_display': section.schedule_display,
            'month_label': f'{cal_module.month_name[target_month]} {target_year}',
            'target_year': target_year,
            'target_month': target_month,
            'prev_year': prev_year,
            'prev_month': prev_month,
            'next_year': next_year,
            'next_month': next_month,
            'stats': {'total': total, **counts, 'rate': rate},
            'calendar_weeks': weeks,
            'session_logs': logs,
            'records': logs,
        }
