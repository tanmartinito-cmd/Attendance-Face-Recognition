"""
Report timetable conflicts already stored in the database (read-only, changes nothing).

    python manage.py find_schedule_conflicts
    python manage.py find_schedule_conflicts --term "2025-2026" --semester 1st

Lists room, instructor and student double-bookings so they can be fixed by hand (move a
schedule, change the instructor, or deactivate the schedule).
"""
from django.core.management.base import BaseCommand

from core.models import ClassSchedule
from core.services.schedule_service import ScheduleService, meeting_label


class Command(BaseCommand):
    help = 'List existing room / instructor / student schedule conflicts (read-only).'

    def add_arguments(self, parser):
        parser.add_argument('--term', help='School year to check, e.g. 2025-2026')
        parser.add_argument('--semester', help='Semester to check: 1st, 2nd or summer')

    def handle(self, *args, **options):
        qs = ClassSchedule.objects.filter(is_active=True, section__is_active=True).select_related(
            *ScheduleService.RELATED, 'section__term',
        ).prefetch_related('days').order_by('section__term_id', 'pk')
        if options.get('term'):
            qs = qs.filter(section__term__school_year=options['term'])
        if options.get('semester'):
            qs = qs.filter(section__term__semester=options['semester'])

        seen, found = set(), 0
        for schedule in qs:
            for c in ScheduleService.check_conflicts(schedule):
                key = (c['type'], frozenset((schedule.pk, c['schedule_id'])))
                if key in seen:
                    continue
                seen.add(key)
                found += 1
                self.stdout.write(
                    f"[{c['type'].upper()}] {schedule.section.term} | schedule #{schedule.pk} "
                    f"{meeting_label(schedule)} <-> schedule #{c['schedule_id']}\n    {c['message']}"
                )
        if found:
            self.stdout.write(self.style.WARNING(f'{found} conflict(s) found.'))
        else:
            self.stdout.write(self.style.SUCCESS('No schedule conflicts found.'))
