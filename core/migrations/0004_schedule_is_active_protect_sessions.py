from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    """Schedules can be deactivated; attendance sessions are protected from schedule deletion."""

    dependencies = [
        ('core', '0003_session_start_mode'),
    ]

    operations = [
        migrations.AddField(
            model_name='classschedule',
            name='is_active',
            field=models.BooleanField(
                default=True,
                help_text='Inactive schedules keep their attendance history but cannot take new attendance.',
            ),
        ),
        migrations.AlterField(
            model_name='attendancesession',
            name='schedule',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name='sessions', to='core.classschedule',
            ),
        ),
    ]
