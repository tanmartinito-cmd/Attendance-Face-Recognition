"""
Deploy tasks that run automatically with every `manage.py migrate`
(accounts/management/commands/migrate.py overrides Django's migrate command).

Render's build command may only run `migrate` (not build.sh), so these hook into migrate itself:

    before: old schema still in the database?  -> drop every table (ALL DATA IS DROPPED)
    after:  create the "security" cache table (login lockout counters)
            no "admin" user yet?               -> create it

On a database still on the old schema this is a one-time `migrate:fresh --seed` (Laravel
style). After that every step is a no-op. For an on-demand wipe use
`python manage.py migrate_fresh --seed`.

Environment:
    SEED_ADMIN_PASSWORD   admin password (otherwise a random one is generated and printed)
    RESET_LEGACY_SCHEMA   "false" to never drop tables
    AUTO_DEPLOY_TASKS     "false" to disable all of this
"""
import os
import secrets
import sys

from django.core.management import call_command
from django.core.management.base import OutputWrapper
from django.db import DEFAULT_DB_ALIAS, connections


def _out(stdout):
    # OutputWrapper adds the trailing newline, same as a management command's self.stdout.
    return stdout if isinstance(stdout, OutputWrapper) else OutputWrapper(stdout or sys.stdout)


def _enabled(name):
    return os.getenv(name, 'true').strip().lower() not in ('false', '0', 'no')


def tasks_enabled(database=DEFAULT_DB_ALIAS):
    # Never during the test suite (it migrates a throwaway database) or for other databases.
    return database == DEFAULT_DB_ALIAS and 'test' not in sys.argv and _enabled('AUTO_DEPLOY_TASKS')


def reset_legacy_schema_if_needed(database=DEFAULT_DB_ALIAS, stdout=None):
    """Drop all tables if the database was built from the old (pre clean-schema) migrations."""
    if not _enabled('RESET_LEGACY_SCHEMA'):
        return False
    stdout = _out(stdout)
    from accounts.management.commands.reset_legacy_schema import (
        drop_all_tables, half_built_initial_schema, legacy_migration_rows,
    )

    connection = connections[database]
    if legacy_migration_rows(connection):
        stdout.write('==> Old database schema detected: dropping all tables so migrate rebuilds it...')
    elif half_built_initial_schema(connection):
        stdout.write('==> Unfinished first migrate detected: dropping all tables so migrate rebuilds it...')
    else:
        return False
    count = drop_all_tables(connection, stdout)
    stdout.write(f'==> Dropped {count} table(s).')
    return True


def seed_admin(stdout=None):
    """Create the 'admin' superuser if it does not exist yet."""
    from accounts.models import User

    stdout = _out(stdout)
    if User.objects.filter(username='admin').exists():
        stdout.write('[INFO] Admin already exists.')
        return
    password = os.getenv('SEED_ADMIN_PASSWORD') or f'Af-{secrets.token_urlsafe(9)}9a'
    User.objects.create_superuser(
        username='admin', password=password, email='admin@attendfr.edu',
        first_name='System', last_name='Administrator',
    )
    shown = '' if os.getenv('SEED_ADMIN_PASSWORD') else f', password={password}'
    stdout.write(f'[OK] Admin created: username=admin{shown}')


def after_migrate(database=DEFAULT_DB_ALIAS, stdout=None):
    stdout = _out(stdout)
    stdout.write('==> Creating cache table...')
    call_command('createcachetable', database=database)
    stdout.write('==> Seeding admin account...')
    seed_admin(stdout)
