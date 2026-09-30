"""
`manage.py migrate` with deploy tasks around it (see accounts/deploy.py).

Overrides Django's built-in migrate command (app commands take precedence over core ones), so
Render runs these even when its build command is just `python manage.py migrate`.
"""
from django.core.management.commands.migrate import Command as DjangoMigrateCommand

from accounts import deploy


class Command(DjangoMigrateCommand):
    def add_arguments(self, parser):
        super().add_arguments(parser)
        parser.add_argument(
            '--skip-deploy-tasks', action='store_true',
            help='Plain Django migrate: no legacy-schema reset, cache table, or admin seed.',
        )

    def handle(self, *args, **options):
        database = options['database']
        active = not options.get('skip_deploy_tasks') and deploy.tasks_enabled(database)
        if active:
            deploy.reset_legacy_schema_if_needed(database, self.stdout)
        super().handle(*args, **options)
        if active:
            deploy.after_migrate(database, self.stdout)
