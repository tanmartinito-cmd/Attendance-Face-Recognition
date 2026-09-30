"""
Schedule conflict detection: a room, or an instructor, cannot be in two classes at once.
"""
from django.core.exceptions import ValidationError


class ScheduleService:
    @staticmethod
    def validate_schedule_times(start_time, end_time):
        if not start_time or not end_time:
            raise ValidationError('Both start time and end time are required.')
        if start_time >= end_time:
            raise ValidationError('End time must be after start time.')

    @staticmethod
    def check_conflicts(schedule, exclude_pk=None):
        """Room and instructor conflicts for `schedule` (unsaved days are respected). Returns messages."""
        from core.models import ClassSchedule

        ScheduleService.validate_schedule_times(schedule.start_time, schedule.end_time)
        days = schedule.meeting_days
        if not days:
            return []

        qs = ClassSchedule.objects.filter(
            days__day__in=days,
            start_time__lt=schedule.end_time,
            end_time__gt=schedule.start_time,
        ).distinct()
        own_pk = exclude_pk or schedule.pk
        if own_pk:
            qs = qs.exclude(pk=own_pk)
        overlapping = qs.select_related(
            'section__template', 'section__instructor__user__profile', 'subject__instructor__user__profile',
        ).prefetch_related('days')

        current_instructor = schedule.instructor if schedule.section_id else None
        conflicts = []
        for existing in overlapping:
            shared = [d for d in days if d in existing.meeting_days]
            if not shared:
                continue
            day_label = ', '.join(shared)
            window = f"from {existing.start_time.strftime('%H:%M')} to {existing.end_time.strftime('%H:%M')}"
            if existing.room and schedule.room and existing.room.strip().lower() == schedule.room.strip().lower():
                conflicts.append(
                    f"Room conflict: '{schedule.room}' is already booked on {day_label} {window} "
                    f"by section '{existing.section.name}'."
                )
            other_instructor = existing.instructor
            if current_instructor and other_instructor and current_instructor.pk == other_instructor.pk:
                conflicts.append(
                    f'Instructor conflict: {current_instructor} is already teaching on {day_label} {window} '
                    f"for section '{existing.section.name}'."
                )
        return conflicts
