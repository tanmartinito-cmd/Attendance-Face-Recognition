"""Set student login usernames to their student ID (remove legacy s_ prefix)."""
from django.core.management.base import BaseCommand
from django.db import transaction

from accounts.models import User
from core.models import Student
from accounts.username_utils import username_from_student_id


class Command(BaseCommand):
    help = 'Align student usernames with student IDs (no s_ prefix).'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print changes without saving.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        updated = 0
        for student in Student.objects.select_related('user').order_by('pk'):
            user = student.user
            if user.role != 'student':
                continue
            desired = username_from_student_id(student.student_id, exclude_user_id=user.pk)
            if user.username == desired:
                continue
            if User.objects.filter(username=desired).exclude(pk=user.pk).exists():
                self.stdout.write(self.style.WARNING(
                    f'Skip {user.username}: desired username {desired} is already taken.'
                ))
                continue
            self.stdout.write(f'{user.username} -> {desired}')
            if not dry_run:
                with transaction.atomic():
                    user.username = desired
                    user.save(update_fields=['username'])
            updated += 1
        self.stdout.write(self.style.SUCCESS(f'Done. {"Would update" if dry_run else "Updated"} {updated} student(s).'))
