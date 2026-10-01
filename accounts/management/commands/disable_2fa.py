"""
Turn off two-step sign-in for one account (lost phone AND lost backup codes).

    python manage.py disable_2fa <username | Student ID | Faculty ID | email>

Verify the person's identity before running this. They can turn it on again from Profile.
"""
from django.core.management.base import BaseCommand, CommandError

from accounts.backends import FlexibleLoginBackend
from attendance_fr.api.services.two_factor import TwoFactorService


class Command(BaseCommand):
    help = 'Turn off two-step sign-in for a user (account recovery).'

    def add_arguments(self, parser):
        parser.add_argument('identifier', help='Username, Student ID, Faculty ID, or email')

    def handle(self, *args, **options):
        user = FlexibleLoginBackend.find_user(options['identifier'])
        if user is None:
            raise CommandError(f'No single account matches "{options["identifier"]}".')
        if not TwoFactorService.get(user):
            self.stdout.write(f'{user.username} does not use two-step sign-in. Nothing to do.')
            return
        TwoFactorService.force_disable(user)
        self.stdout.write(self.style.SUCCESS(f'Two-step sign-in turned off for {user.username}.'))
