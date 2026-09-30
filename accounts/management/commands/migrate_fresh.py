"""
Laravel-style `migrate:fresh [--seed]`: drop EVERY table, then run all migrations from scratch.

    python manage.py migrate_fresh                 # asks for confirmation
    python manage.py migrate_fresh --seed          # ... then create the admin account
    python manage.py migrate_fresh --seed --demo   # ... plus the demo class from seed.py
    python manage.py migrate_fresh --seed --force  # no prompt (scripts / CI)

ALL DATA IN THE DATABASE IS LOST. Admin password: SEED_ADMIN_PASSWORD, or a random one is
generated and printed.
"""
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import DEFAULT_DB_ALIAS, connections

from accounts import deploy
from accounts.management.commands.reset_legacy_schema import drop_all_tables


class Command(BaseCommand):
    help = 'Drop all tables and re-run all migrations (like Laravel migrate:fresh).'

    def add_arguments(self, parser):
        parser.add_argument('--seed', action='store_true', help='Create the admin account afterwards.')
        parser.add_argument('--demo', action='store_true', help='With --seed: also create the demo class.')
        parser.add_argument('--force', '--no-input', action='store_true', dest='force',
                            help='Do not ask for confirmation.')
        parser.add_argument('--database', default=DEFAULT_DB_ALIAS)

    def handle(self, *args, **options):
        database = options['database']
        connection = connections[database]
        name = connection.settings_dict.get('NAME')

        if not options['force']:
            answer = input(f'This drops ALL tables in "{name}" ({connection.vendor}). Type "yes" to continue: ')
            if answer.strip().lower() != 'yes':
                raise CommandError('Aborted.')

        self.stdout.write(self.style.WARNING(f'==> Dropping all tables in "{name}"...'))
        count = drop_all_tables(connection, self.stdout)
        self.stdout.write(f'==> Dropped {count} table(s).')

        self.stdout.write('==> Running migrations...')
        call_command('migrate', interactive=False, database=database, skip_deploy_tasks=True)
        call_command('createcachetable', database=database)

        if options['seed']:
            self.stdout.write('==> Seeding...')
            deploy.seed_admin(self.stdout)
            if options['demo']:
                from seed import seed_demo
                seed_demo()

        self.stdout.write(self.style.SUCCESS('Database is fresh.'))
