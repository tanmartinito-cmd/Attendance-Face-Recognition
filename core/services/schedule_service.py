"""
Timetable rules for a college: one person, or one room, cannot be in two places at once.

    room conflict        a room hosts one class at a time
    instructor conflict  an instructor teaches one class at a time
    student conflict     a student attends one class at a time: across sections (irregular
                         students taking a subject in another course/department), and between
                         irregular subject enrollments

A block section MAY run two subjects in parallel (different room, different instructor); its
block students are not counted against each other for that.

Two meetings clash only when they are in the same academic term, share a meeting day, their
times overlap (back-to-back is fine), and their effective date windows overlap. Inactive
schedules, subjects and sections are ignored (they cannot take attendance).
"""
from django.core.exceptions import ValidationError
from django.db.models import Q


class SchedulingConflict(ValidationError):
    """A timetable rule was broken. `conflicts` holds machine-readable details for the API."""

    def __init__(self, conflicts, code='schedule_conflict', extra=None):
        self.conflicts = list(conflicts)
        self.conflict_code = code
        self.extra = dict(extra or {})
        super().__init__([c['message'] for c in self.conflicts], code=code)


# ── Formatting ────────────────────────────────────────────────────────────────
def normalize_room(room):
    """'  Room   101 ' -> 'room 101' (rooms compare case- and spacing-insensitively)."""
    return ' '.join((room or '').split()).lower()


def normalize_code(code):
    """'it  101 ' -> 'it 101' (subject codes compare case- and spacing-insensitively)."""
    return ' '.join((code or '').split()).lower()


def clean_room(room):
    """Tidy spacing for storage: '  Room   101 ' -> 'Room 101'."""
    return ' '.join((room or '').split())


def fmt_time(t):
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'PM' if t.hour >= 12 else 'AM'}"


def _person(instructor):
    if instructor is None:
        return 'The instructor'
    user = instructor.user
    return user.get_full_name() or user.username


def _student_name(student):
    return student.user.get_full_name() or student.user.username


def _names(students, limit=3):
    names = [_student_name(s) for s in students[:limit]]
    more = len(students) - limit
    text = ', '.join(names)
    return f'{text} and {more} more' if more > 0 else text


def meeting_label(schedule, days=None):
    """'IT201 (BSIT-2A) on Mon/Wed 8:00 AM–9:30 AM in Room 226'."""
    subject = schedule.subject if schedule.subject_id else None
    code = subject.code if subject else 'a class'
    days = days if days is not None else ScheduleService.days_of(schedule)
    return (
        f"{code} ({schedule.section.name}) on {'/'.join(days)} "
        f"{fmt_time(schedule.start_time)}–{fmt_time(schedule.end_time)} in {schedule.room}"
    )


def _dates_overlap(a, b):
    a_from, a_to, b_from, b_to = a.effective_from, a.effective_to, b.effective_from, b.effective_to
    return (a_from is None or b_to is None or a_from <= b_to) and (b_from is None or a_to is None or b_from <= a_to)


def _covered_q(section_id, subject_id):
    """Enrollments that attend a meeting (same rule as the attendance roster)."""
    q = Q(section_id=section_id)
    if subject_id:
        q &= Q(subject__isnull=True) | Q(subject_id=subject_id)
    return q


def _covers(enrollment_rows, section_id, subject_id):
    """Student ids among (student_id, section_id, subject_id) rows that attend the meeting."""
    return {
        sid for sid, sec, subj in enrollment_rows
        if sec == section_id and (not subject_id or subj is None or subj == subject_id)
    }


class ScheduleService:
    RELATED = (
        'section__template', 'section__instructor__user', 'subject__instructor__user',
    )

    # ── Basic checks ──────────────────────────────────────────────────────────
    @staticmethod
    def validate_schedule_times(start_time, end_time):
        if not start_time or not end_time:
            raise ValidationError('Both start time and end time are required.')
        if start_time >= end_time:
            raise ValidationError('End time must be after start time.')

    @staticmethod
    def days_of(schedule):
        from core.models import DAY_ORDER
        return sorted(schedule.meeting_days, key=lambda d: DAY_ORDER.get(d, 99))

    @staticmethod
    def overlap_days(a, b, a_days=None, b_days=None):
        """Shared meeting days when two meetings clash in time and date window, else []."""
        a_days = a_days if a_days is not None else ScheduleService.days_of(a)
        b_days = b_days if b_days is not None else ScheduleService.days_of(b)
        shared = [d for d in a_days if d in b_days]
        if not shared:
            return []
        if not (a.start_time < b.end_time and a.end_time > b.start_time):
            return []
        return shared if _dates_overlap(a, b) else []

    @staticmethod
    def is_live(schedule, active_subject_ids=(), active_section_ids=()):
        """True when the meeting can take attendance (schedule, section and subject active)."""
        if schedule.is_active is False:
            return False
        if schedule.section.is_active is False and schedule.section_id not in active_section_ids:
            return False
        if schedule.subject_id and schedule.subject.is_active is False and schedule.subject_id not in active_subject_ids:
            return False
        return True

    @staticmethod
    def effective_instructor_id(schedule, overrides=None):
        """Who teaches the meeting: the subject's instructor, else the section's (with pending edits)."""
        overrides = overrides or {}
        by_subject = overrides.get('subject', {})
        by_section = overrides.get('section', {})
        if schedule.subject_id:
            iid = by_subject[schedule.subject_id] if schedule.subject_id in by_subject else schedule.subject.instructor_id
            if iid:
                return iid
        return by_section[schedule.section_id] if schedule.section_id in by_section else schedule.section.instructor_id

    @staticmethod
    def overlapping_candidates(schedule, days, term_id, active_subject_ids=(), active_section_ids=()):
        """Other live schedules of the same term that share a day and a time window."""
        from core.models import ClassSchedule

        qs = ClassSchedule.objects.filter(
            is_active=True, section__term_id=term_id,
            days__day__in=days, start_time__lt=schedule.end_time, end_time__gt=schedule.start_time,
        ).filter(
            Q(section__is_active=True) | Q(section_id__in=list(active_section_ids))
        ).filter(
            Q(subject__isnull=True) | Q(subject__is_active=True) | Q(subject_id__in=list(active_subject_ids))
        )
        if schedule.effective_to:
            qs = qs.filter(Q(effective_from__isnull=True) | Q(effective_from__lte=schedule.effective_to))
        if schedule.effective_from:
            qs = qs.filter(Q(effective_to__isnull=True) | Q(effective_to__gte=schedule.effective_from))
        if schedule.pk:
            qs = qs.exclude(pk=schedule.pk)
        return list(qs.distinct().select_related(*ScheduleService.RELATED).prefetch_related('days'))

    # ── Conflicts of one meeting ──────────────────────────────────────────────
    @staticmethod
    def check_conflicts(schedule, overrides=None):
        """Room / instructor / student conflicts of `schedule` (unsaved days respected).

        `overrides` describes edits not saved yet:
            {'subject': {subject_id: instructor_id}, 'section': {section_id: instructor_id},
             'active_subject_ids': {ids being re-activated}, 'active_section_ids': {ids being re-activated}}
        Returns a list of dicts: {type, message, schedule_id, section, subject, days, ...}.
        """
        from core.models import Enrollment, Instructor, Student

        ScheduleService.validate_schedule_times(schedule.start_time, schedule.end_time)
        overrides = overrides or {}
        active_subject_ids = set(overrides.get('active_subject_ids', ()))
        active_section_ids = set(overrides.get('active_section_ids', ()))
        days = ScheduleService.days_of(schedule)
        if not days or not schedule.section_id or not ScheduleService.is_live(schedule, active_subject_ids, active_section_ids):
            return []

        candidates = ScheduleService.overlapping_candidates(
            schedule, days, schedule.section.term_id, active_subject_ids, active_section_ids,
        )
        clashes = []
        for other in candidates:
            shared = ScheduleService.overlap_days(schedule, other, days)
            if shared:
                clashes.append((other, shared))
        if not clashes:
            return []

        conflicts = []
        room = normalize_room(schedule.room)
        my_instructor_id = ScheduleService.effective_instructor_id(schedule, overrides)
        instructor = Instructor.objects.select_related('user').filter(pk=my_instructor_id).first() if my_instructor_id else None

        # Students attending this meeting, and their enrollments in the clashing sections.
        my_students = set(
            Enrollment.objects.filter(_covered_q(schedule.section_id, schedule.subject_id))
            .values_list('student_id', flat=True)
        )
        rows = []
        block_here = set()
        if my_students:
            rows = list(
                Enrollment.objects.filter(
                    student_id__in=my_students, section_id__in={o.section_id for o, _ in clashes},
                ).values_list('student_id', 'section_id', 'subject_id')
            )
            block_here = {sid for sid, sec, subj in rows if sec == schedule.section_id and subj is None}

        for other, shared in clashes:
            base = {
                'schedule_id': other.pk, 'section_id': other.section_id, 'section': other.section.name,
                'subject': other.subject.code if other.subject_id else None, 'days': shared,
                'start_time': other.start_time.strftime('%H:%M'), 'end_time': other.end_time.strftime('%H:%M'),
                'room': other.room,
            }
            label = meeting_label(other, shared)
            if room and normalize_room(other.room) == room:
                conflicts.append({**base, 'type': 'room', 'message': f'Room conflict: {clean_room(schedule.room)} is already used by {label}.'})
            other_instructor_id = ScheduleService.effective_instructor_id(other, overrides)
            if my_instructor_id and other_instructor_id == my_instructor_id:
                conflicts.append({**base, 'type': 'instructor', 'message': f'Instructor conflict: {_person(instructor)} already teaches {label}.'})
            if my_students:
                both = my_students & _covers(rows, other.section_id, other.subject_id)
                if other.section_id == schedule.section_id:
                    # Parallel subjects of one block section are allowed for its block students.
                    both -= block_here
                if both:
                    students = list(
                        Student.objects.select_related('user__profile').filter(pk__in=both)
                        .order_by('user__profile__last_name', 'user__profile__first_name')
                    )
                    verb = 'has' if len(students) == 1 else 'have'
                    conflicts.append({
                        **base, 'type': 'student', 'student_ids': sorted(both),
                        'message': f'Student conflict: {_names(students)} already {verb} {label}.',
                    })
        return conflicts

    @staticmethod
    def validate_schedule(schedule, overrides=None):
        conflicts = ScheduleService.check_conflicts(schedule, overrides)
        if conflicts:
            raise SchedulingConflict(conflicts)

    @staticmethod
    def validate_schedules(schedules, overrides=None):
        """Re-check saved meetings after an edit elsewhere (instructor change, re-activation...)."""
        conflicts, seen = [], set()
        for schedule in schedules:
            for c in ScheduleService.check_conflicts(schedule, overrides):
                key = (c['type'], frozenset((schedule.pk, c['schedule_id'])))
                if key in seen:
                    continue
                seen.add(key)
                # Say which of the edited meetings is affected.
                message = c['message'].rstrip('.')
                c = {**c, 'message': f"{message}, which overlaps {meeting_label(schedule, c['days'])}."}
                conflicts.append(c)
        if conflicts:
            raise SchedulingConflict(conflicts)

    # ── Student enrollment ────────────────────────────────────────────────────
    @staticmethod
    def _student_schedules(student, term_id, exclude_pks=()):
        """Live meetings the student already attends in a term."""
        from core.models import ClassSchedule, Enrollment

        q = Q()
        for sec, subj in Enrollment.objects.filter(student=student).values_list('section_id', 'subject_id'):
            q |= Q(section_id=sec, subject_id=subj) if subj else Q(section_id=sec)
        if not q:
            return []
        qs = ClassSchedule.objects.filter(q).filter(
            is_active=True, section__is_active=True, section__term_id=term_id,
        ).filter(Q(subject__isnull=True) | Q(subject__is_active=True)).exclude(pk__in=list(exclude_pks))
        return list(qs.distinct().select_related(*ScheduleService.RELATED).prefetch_related('days'))

    @staticmethod
    def _meetings_for_enrollment(section, subject=None):
        qs = section.schedules.filter(is_active=True)
        if subject is not None:
            qs = qs.filter(subject=subject)
        qs = qs.filter(Q(subject__isnull=True) | Q(subject__is_active=True))
        return list(qs.select_related(*ScheduleService.RELATED).prefetch_related('days'))

    @staticmethod
    def enrollment_conflicts(student, section, subject=None):
        """Overlaps between the meetings of a new enrollment and the student's current timetable."""
        if section.is_active is False:
            return []
        new = ScheduleService._meetings_for_enrollment(section, subject)
        if not new:
            return []
        existing = ScheduleService._student_schedules(student, section.term_id, exclude_pks={s.pk for s in new})
        conflicts = []
        for meeting in new:
            for other in existing:
                if subject is None and other.section_id == section.pk:
                    continue  # parallel subjects of a block section (allowed)
                shared = ScheduleService.overlap_days(meeting, other)
                if shared:
                    conflicts.append({
                        'type': 'student', 'schedule_id': other.pk, 'section_id': other.section_id,
                        'section': other.section.name, 'subject': other.subject.code if other.subject_id else None,
                        'days': shared, 'start_time': other.start_time.strftime('%H:%M'),
                        'end_time': other.end_time.strftime('%H:%M'), 'room': other.room,
                        'message': (
                            f'Schedule conflict: {_student_name(student)} already has {meeting_label(other, shared)}, '
                            f'which overlaps {meeting_label(meeting, shared)}.'
                        ),
                    })
        return conflicts

    @staticmethod
    def alternative_offerings(student, section, subject):
        """Other sections (any course / department) offering the same subject code at times that fit."""
        from core.models import Subject

        existing = ScheduleService._student_schedules(student, section.term_id)
        existing = [s for s in existing if not (s.section_id == section.pk and (s.subject_id in (None, subject.pk)))]
        options = Subject.objects.filter(
            code__iexact=subject.code, is_active=True, section__is_active=True, section__term_id=section.term_id,
        ).exclude(section_id=section.pk).select_related('section__template__course')
        results = []
        for option in options:
            meetings = ScheduleService._meetings_for_enrollment(option.section, option)
            if not meetings:
                continue
            if any(ScheduleService.overlap_days(m, e) for m in meetings for e in existing):
                continue
            results.append({
                'section_id': option.section_id, 'section': option.section.name,
                'course': option.section.template.course.code, 'subject_id': option.pk, 'subject': option.code,
                'schedule': ', '.join(
                    f"{'/'.join(ScheduleService.days_of(m))} {fmt_time(m.start_time)}–{fmt_time(m.end_time)}" for m in meetings
                ),
            })
        return results

    # ── One subject once per term ────────────────────────────────────────────
    @staticmethod
    def subjects_taken(student_ids, term_id, exclude_section_id=None):
        """{student_id: {normalized code: Subject}} for the active subjects students take in a term.
        A block enrollment covers every subject of its section; an irregular one only its subject."""
        from collections import defaultdict
        from core.models import Enrollment, Subject

        rows = Enrollment.objects.filter(student_id__in=list(student_ids), section__term_id=term_id)
        if exclude_section_id:
            rows = rows.exclude(section_id=exclude_section_id)
        rows = list(rows.values_list('student_id', 'section_id', 'subject_id'))
        block_sections = {sec for _, sec, subj in rows if subj is None}
        by_section = defaultdict(list)
        for s in Subject.objects.filter(section_id__in=block_sections, is_active=True).select_related('section__template'):
            by_section[s.section_id].append(s)
        irregular = {
            s.pk: s for s in Subject.objects.filter(
                pk__in={subj for _, _, subj in rows if subj}, is_active=True,
            ).select_related('section__template')
        }
        taken = defaultdict(dict)
        for sid, sec, subj in rows:
            subjects = by_section.get(sec, []) if subj is None else ([irregular[subj]] if subj in irregular else [])
            for s in subjects:
                taken[sid].setdefault(normalize_code(s.code), s)
        return taken

    @staticmethod
    def duplicate_subject_conflicts(student, section, subject=None):
        """Subjects of a new enrollment the student already takes in another section this term."""
        new_subjects = [subject] if subject is not None else list(section.subjects.filter(is_active=True))
        taken = ScheduleService.subjects_taken([student.pk], section.term_id).get(student.pk, {})
        conflicts = []
        for new in new_subjects:
            existing = taken.get(normalize_code(new.code))
            if existing is None or existing.pk == new.pk:
                continue  # not taken yet, or the same subject of this same section
            conflicts.append({
                'type': 'duplicate_subject', 'subject': new.code, 'subject_id': new.pk,
                'existing_subject_id': existing.pk, 'section_id': existing.section_id,
                'section': existing.section.name,
                'message': (
                    f'{_student_name(student)} already takes {existing.code} in {existing.section.name} this term. '
                    'A student can take each subject only once per term.'
                ),
            })
        return conflicts

    @staticmethod
    def validate_enrollment(student, section, subject=None):
        duplicates = ScheduleService.duplicate_subject_conflicts(student, section, subject)
        if duplicates:
            codes = ', '.join(dict.fromkeys(d['subject'] for d in duplicates))
            tip = (
                f'To take {codes} in {section.name} instead, remove it from the other section first '
                '(a block student there must be switched to per-subject enrollment).'
            )
            duplicates[-1] = {**duplicates[-1], 'message': f"{duplicates[-1]['message']} {tip}"}
            raise SchedulingConflict(duplicates, code='duplicate_subject')
        conflicts = ScheduleService.enrollment_conflicts(student, section, subject)
        if not conflicts:
            return
        extra = {}
        if subject is not None:
            alternatives = ScheduleService.alternative_offerings(student, section, subject)
            extra['alternatives'] = alternatives
            if alternatives:
                hint = '; '.join(f"{a['section']} ({a['course']}): {a['schedule']}" for a in alternatives[:5])
                tip = f'Sections offering {subject.code} that fit this timetable: {hint}.'
            else:
                tip = f'No other section offering {subject.code} fits this timetable this term.'
        else:
            tip = ('Enroll the student per subject (irregular) and take the conflicting subject '
                   'in another section offering it at a different time.')
        conflicts[0] = {**conflicts[0], 'message': f"{conflicts[0]['message']} {tip}"}
        raise SchedulingConflict(conflicts, code='student_schedule_conflict', extra=extra)

    # ── Concurrency ───────────────────────────────────────────────────────────
    @staticmethod
    def lock_term(term_id):
        """Serialize timetable writes in a term (call inside transaction.atomic)."""
        from core.models import AcademicTerm
        if term_id:
            list(AcademicTerm.objects.select_for_update().filter(pk=term_id).values_list('pk', flat=True))
