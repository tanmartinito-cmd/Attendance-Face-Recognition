"""
One-time wipe of a database that still has the OLD (pre clean-schema) migrations.

The clean-schema refactor replaced every accounts/core migration with a fresh 0001_initial.
A database built from the old migrations already has "accounts.0001_initial" and
"core.0001_initial" recorded, so `migrate` would skip the new schema entirely. This command
detects that case and drops every table so `migrate` can rebuild from scratch.

    python manage.py reset_legacy_schema          # report only
    python manage.py reset_legacy_schema --apply  # drop all tables (ALL DATA IS LOST)

`migrate` also runs this automatically in production (see accounts/deploy.py). Once the old
migration records are gone (after the first reset, or on a database created from the new
migrations) it does nothing.
"""
from django.core.management.base import BaseCommand
from django.db import connection

# Migrations that only existed in the old schema. Their presence in django_migrations means
# the database was built from the old migrations.
LEGACY_MIGRATIONS = {
    'accounts': {
        '0002_customuser_user_role_idx_customuser_user_name_idx_and_more',
        '0003_student_birth_date_student_birth_place_and_more',
        '0004_student_course_ref_alter_student_course',
        '0005_rename_tables_db_table',
        '0006_add_student_biometric',
        '0007_backfill_student_biometrics',
        '0008_expand_teacher_profile',
        '0009_rename_emp_to_fac_ids',
        '0010_image_upload_validators',
        '0011_revoked_tokens',
        '0012_private_face_storage',
        '0013_usernames_match_ids',
    },
    'core': {
        '0002_program_section_year_level_subject_section_and_more',
        '0003_schedule_effective_dates',
        '0004_schedule_add_day2',
        '0005_programsection_section_program_section',
        '0006_alter_attendancesession_unique_together',
        '0007_alter_attendancesession_started_by',
        '0008_alter_studentsection_unique_together_and_more',
        '0009_alter_programsection_options_programsection_course_and_more',
        '0010_alter_programsection_course_alter_section_course_and_more',
        '0011_backfill_course_references',
        '0012_subject_course_ref',
        '0013_backfill_subject_courses',
        '0014_academic_filter_indexes',
        '0015_rename_tables_db_table',
        '0016_add_schedule_day',
        '0017_backfill_schedule_days',
        '0018_attendancesessionreopenaudit',
        '0019_academic_is_active',
    },
}


def legacy_migration_rows(conn=connection):
    """(app, name) rows in django_migrations that only exist in the old schema."""
    if 'django_migrations' not in conn.introspection.table_names():
        return []
    with conn.cursor() as cursor:
        cursor.execute(
            'SELECT app, name FROM django_migrations WHERE app IN (%s, %s)',
            ['accounts', 'core'],
        )
        rows = cursor.fetchall()
    return [(app, name) for app, name in rows if name in LEGACY_MIGRATIONS.get(app, ())]


def drop_all_tables(conn=connection, stdout=None):
    """Drop every table in the database. Returns the number of tables dropped."""
    tables = conn.introspection.table_names()
    qn = conn.ops.quote_name
    with conn.constraint_checks_disabled():
        with conn.cursor() as cursor:
            if conn.vendor == 'mysql':
                cursor.execute('SET FOREIGN_KEY_CHECKS = 0')
            try:
                for table in tables:
                    cursor.execute(f'DROP TABLE IF EXISTS {qn(table)}')
                    if stdout:
                        stdout.write(f'  dropped {table}')
            finally:
                if conn.vendor == 'mysql':
                    cursor.execute('SET FOREIGN_KEY_CHECKS = 1')
    return len(tables)


class Command(BaseCommand):
    help = 'Drop all tables if the database still uses the old (pre clean-schema) migrations.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--apply', action='store_true',
            help='Actually drop the tables. Without this flag the command only reports.',
        )

    def handle(self, *args, **options):
        legacy = legacy_migration_rows()
        if not legacy:
            self.stdout.write('Database already uses the clean schema (or is empty). Nothing to reset.')
            return

        tables = connection.introspection.table_names()
        self.stdout.write(self.style.WARNING(
            f'Old schema detected ({len(legacy)} legacy migration records). '
            f'{len(tables)} table(s) will be dropped.'
        ))
        if not options['apply']:
            self.stdout.write('Report only. Re-run with --apply to drop the tables.')
            return

        dropped = drop_all_tables(connection, self.stdout)
        self.stdout.write(self.style.SUCCESS(
            f'Dropped {dropped} table(s). Run `migrate` to build the clean schema.'
        ))
