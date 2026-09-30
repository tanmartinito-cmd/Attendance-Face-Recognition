"""
Seed a fresh database.

    python seed.py              # admin + a small demo class (instructor, student, schedule)
    python seed.py --admin-only # admin account only

Passwords: SEED_ADMIN_PASSWORD / SEED_DEMO_PASSWORD, or a random one is generated and printed.
Safe to re-run: existing records are kept.
"""
import os
import secrets
import sys
from datetime import time

import django

if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_fr.settings')
django.setup()

from accounts.models import Role, User  # noqa: E402
from attendance_fr.api.services.users import UserService  # noqa: E402
from core.models import (  # noqa: E402
    AcademicTerm, ClassSchedule, ClassSection, Course, Enrollment, Program, SectionTemplate, Subject,
)


def _password(env_name):
    value = os.getenv(env_name)
    if value:
        return value, False
    return f'Af-{secrets.token_urlsafe(9)}9a', True


def seed_admin():
    if User.objects.filter(username='admin').exists():
        print('[INFO] Admin already exists.')
        return
    password, generated = _password('SEED_ADMIN_PASSWORD')
    User.objects.create_superuser(
        username='admin', password=password, email='admin@attendfr.edu',
        first_name='System', last_name='Administrator',
    )
    print(f"[OK] Admin created: username=admin{f', password={password}' if generated else ''}")


def seed_demo():
    password, generated = _password('SEED_DEMO_PASSWORD')
    program, _ = Program.objects.get_or_create(
        code='CITEC', defaults={'name': 'College of Information Technology, Entertainment and Computing'},
    )
    course, _ = Course.objects.get_or_create(program=program, code='BSIT', defaults={'name': 'BS Information Technology'})
    term, _ = AcademicTerm.objects.get_or_create(school_year='2025-2026', semester=AcademicTerm.Semester.FIRST)
    template, _ = SectionTemplate.objects.get_or_create(course=course, name='BSIT-1A', defaults={'year_level': 1})

    instructor_user = User.objects.filter(instructor__faculty_id='FAC-0001').first() or UserService.create_user({
        'role': Role.INSTRUCTOR, 'faculty_id': 'FAC-0001', 'password': password,
        'first_name': 'Juan', 'last_name': 'Dela Cruz', 'email': 'instructor@attendfr.edu', 'department': 'CITEC',
    })
    student_user = User.objects.filter(student__student_id='23100000450').first() or UserService.create_user({
        'role': Role.STUDENT, 'student_id': '23100000450', 'password': password,
        'first_name': 'Maria', 'last_name': 'Santos', 'course_ref': course.pk, 'year_level': 1,
    })

    section, _ = ClassSection.objects.get_or_create(template=template, term=term, defaults={'instructor': instructor_user.instructor})
    subject, _ = Subject.objects.get_or_create(
        section=section, code='IT101',
        defaults={'name': 'Introduction to Computing', 'course': course, 'instructor': instructor_user.instructor},
    )
    if not section.schedules.exists():
        schedule = ClassSchedule(section=section, subject=subject, start_time=time(8, 0), end_time=time(9, 30), room='Room 101')
        schedule.set_days(['Mon', 'Wed'])
        schedule.save()
    Enrollment.objects.get_or_create(student=student_user.student, section=section, subject=None)

    note = f', password={password}' if generated else ''
    print(f'[OK] Demo class ready: instructor FAC-0001, student 23100000450{note}')


if __name__ == '__main__':
    print('[INFO] Seeding database...')
    seed_admin()
    if not ('--admin-only' in sys.argv or os.getenv('SEED_ADMIN_ONLY', '').lower() in ('true', '1')):
        seed_demo()
    print('[DONE]')
