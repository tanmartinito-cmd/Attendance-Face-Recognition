"""Existing accounts: login username becomes the Faculty ID (teachers) / Student ID (students)."""
from django.db import migrations


def forwards(apps, schema_editor):
    User = apps.get_model('accounts', 'CustomUser')
    Teacher = apps.get_model('accounts', 'Teacher')
    Student = apps.get_model('accounts', 'Student')

    pairs = [(t.user_id, t.employee_id) for t in Teacher.objects.all()]
    pairs += [(s.user_id, s.student_id) for s in Student.objects.all()]
    for user_id, profile_id in pairs:
        profile_id = (profile_id or '').strip()
        if not profile_id:
            continue
        user = User.objects.filter(pk=user_id).first()
        if user is None or user.role not in ('teacher', 'student') or user.username == profile_id:
            continue
        if User.objects.filter(username__iexact=profile_id).exclude(pk=user_id).exists():
            continue  # clash: keep old username (they can still log in with the ID)
        user.username = profile_id
        user.save(update_fields=['username'])


class Migration(migrations.Migration):
    dependencies = [('accounts', '0012_private_face_storage')]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
