"""
Unlock an account that hit the account-wide failed-login cap.

    python manage.py unlock_login <username | Student ID | Faculty ID | email>

Works across all web workers because the counters live in the shared database cache.
"""
from django.core.management.base import BaseCommand, CommandError

from accounts.backends import FlexibleLoginBackend
from attendance_fr.api.services.auth import LoginLockout


class Command(BaseCommand):
    help = 'Clear the account-wide login lockout for a user.'

    def add_arguments(self, parser):
        parser.add_argument('identifier', help='Username, Student ID, Faculty ID, or email')

    def handle(self, *args, **options):
        identifier = options['identifier']
        user = FlexibleLoginBackend.find_user(identifier)
        if user is None:
            raise CommandError(f'No single account matches "{identifier}".')
        LoginLockout.unlock_account(identifier)
        self.stdout.write(self.style.SUCCESS(f'Unlocked login for {user.username}.'))
