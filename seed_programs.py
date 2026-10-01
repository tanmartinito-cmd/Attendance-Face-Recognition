"""
Seed production programs.
Run this ONCE after deploying to production to populate the database.

Usage:
    python seed_programs.py

This creates all university programs. Add courses later via admin panel.
Safe to re-run: existing records are kept (get_or_create).
"""
import os
import sys

import django

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'attendance_fr.settings')
django.setup()

from core.models import Program  # noqa: E402


def seed_programs():
    """Seed all university programs."""
    
    programs_data = [
        {'code': 'CITEC', 'name': 'College of Information, Technology, Entertainment, and Computing'},
        {'code': 'CCJE', 'name': 'College of Criminal Justice Education'},
        {'code': 'CTE', 'name': 'College of Teacher Education'},
        {'code': 'CoA', 'name': 'College of Accountancy'},
        {'code': 'CoN', 'name': 'College of Nursing'},
        {'code': 'CAS', 'name': 'College of Arts and Sciences'},
        {'code': 'CORE', 'name': 'College of Operations, Resources, and Entrepreneurship'},
        {'code': 'CEnTech', 'name': 'College of Engineering and Technology'},
        {'code': 'CIHT', 'name': 'College of Innovative Hospitality and Tourism'},
    ]
    
    print('[INFO] Seeding university programs...')
    
    created_count = 0
    existing_count = 0
    
    for prog_data in programs_data:
        program, created = Program.objects.get_or_create(
            code=prog_data['code'],
            defaults={'name': prog_data['name']},
        )
        
        if created:
            print(f'  ✓ Created: {program.code:10} - {program.name}')
            created_count += 1
        else:
            print(f'  → Exists:  {program.code:10} - {program.name}')
            existing_count += 1
    
    total = Program.objects.count()
    print(f'\n[DONE] Database now has {total} programs ({created_count} created, {existing_count} already existed).')
    print('[INFO] Add courses for each program via the admin panel.')


if __name__ == '__main__':
    seed_programs()
