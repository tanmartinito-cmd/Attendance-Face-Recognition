"""
Test data builders.

They hide the normalized structure (User + UserProfile, Instructor/Student records,
course -> section template -> class section in a term, schedule meeting days) so a test
can say "a section BSIT-1A taught by X" in one line.
"""
import json
from datetime import time

from accounts.models import User
from accounts.profile_data import write_personal
from core.models import (
    AcademicTerm, ClassSchedule, ClassSection, Course, Enrollment, Instructor, Program, SectionTemplate,
    Student, StudentBiometric, Subject,
)

DEFAULT_PASSWORD = 'StrongPassword123!'


def _role(role):
    return 'instructor' if role == 'teacher' else role


def create_user(username, role='student', password=DEFAULT_PASSWORD, first_name='', last_name='', email='',
                phone='', is_active=True, **personal):
    user = User.objects.create_user(
        username=username, password=password, first_name=first_name, last_name=last_name,
        email=email, role=_role(role), is_active=is_active,
    )
    if phone:
        personal.setdefault('mobile_number', phone)
    if personal:
        write_personal(user, personal)
    return user


def create_instructor(user=None, faculty_id=None, **fields):
    faculty_id = faculty_id or fields.pop('employee_id', None)
    if user is None:
        user = create_user(faculty_id or f'FAC-{Instructor.objects.count() + 1:04d}', role='instructor')
    return Instructor.objects.create(user=user, faculty_id=faculty_id or user.username, **fields)


def default_program():
    program, _ = Program.objects.get_or_create(code='TEST', defaults={'name': 'Test Program'})
    return program


def course_for(program=None, code=None):
    """A course under `program` (created when missing)."""
    program = program or default_program()
    if code:
        course, _ = Course.objects.get_or_create(program=program, code=code, defaults={'name': code})
        return course
    course = program.courses.order_by('pk').first()
    return course or Course.objects.create(program=program, code=f'{program.code}-C', name=f'{program.code} Course')


def create_student(user=None, student_id=None, course=None, course_ref=None, year_level=1,
                   face_encoding=None, face_image=None, **personal):
    if user is None:
        user = create_user(student_id or f'S{Student.objects.count() + 1:05d}', role='student')
    if isinstance(course, str):
        course = Course.objects.filter(code__iexact=course).first()  # a bare label assigns no course
    course = course_ref or course
    student = Student.objects.create(user=user, student_id=student_id or user.username, course=course, year_level=year_level)
    if personal:
        write_personal(user, personal)
    if face_encoding:
        set_face(student, face_encoding, face_image)
    return student


def set_face(student, encoding, image=None):
    """Give a student an enrolled face (encoding: list or JSON string)."""
    data = encoding if isinstance(encoding, str) else json.dumps(list(encoding))
    bio, _ = StudentBiometric.objects.update_or_create(student=student, defaults={'face_encoding': data})
    if image:
        bio.face_image = image
        bio.save()
    student.biometric = bio
    return bio


def term(school_year='2025-2026', semester='1st'):
    t, _ = AcademicTerm.objects.get_or_create(school_year=school_year, semester=semester)
    return t


def create_template(name, program=None, course=None, course_ref=None, year_level=1, **fields):
    course = course_ref or (course if isinstance(course, Course) else None) or course_for(program, course if isinstance(course, str) and course else None)
    fields.pop('program', None)
    return SectionTemplate.objects.create(course=course, name=name, year_level=year_level, **fields)


def create_section(name='SEC-1A', program=None, course_ref=None, program_section=None, template=None,
                   year_level=1, teacher=None, instructor=None, school_year='2025-2026', semester='1st',
                   subject=None, is_active=True, course=None):
    """A class section. `subject` (old-style "primary subject") is placed into the section."""
    template = template or program_section
    if template is None:
        c = course_ref or (course if isinstance(course, Course) else None)
        if c is None:
            c = course_for(program, course if isinstance(course, str) and course else None)
        template = SectionTemplate.objects.filter(course=c, name=name).first() or \
            SectionTemplate.objects.create(course=c, name=name, year_level=year_level)
    section = ClassSection.objects.create(
        template=template, term=term(school_year, semester), instructor=instructor or teacher, is_active=is_active,
    )
    if subject is not None:
        place_subject(subject, section)
    return section


def place_subject(subject, section):
    """Put a subject into a section (a copy if it already belongs to another section)."""
    if subject.section_id and subject.section_id != section.pk:
        return Subject.objects.create(
            section=section, course=section.course, instructor=subject.instructor, code=subject.code,
            name=subject.name, units=subject.units, description=subject.description,
        )
    subject.section = section
    subject.course = section.course
    subject.save()
    return subject


def create_subject(code='SUBJ101', name='Subject', section=None, teacher=None, instructor=None,
                   program=None, course_ref=None, course=None, **fields):
    course = course_ref or course or (section.course if section else (course_for(program) if program else None))
    return Subject.objects.create(
        code=code, name=name, section=section, instructor=instructor or teacher, course=course, **fields,
    )


def create_schedule(section, day_of_week='Mon', start_time=time(8, 0), end_time=time(9, 0), room='Room 1',
                    subject=None, day_2=None, days=None, **fields):
    if subject is not None and subject.section_id != section.pk:
        subject = section.subjects.filter(code=subject.code).first() or place_subject(subject, section)
    schedule = ClassSchedule(section=section, subject=subject, start_time=start_time, end_time=end_time, room=room, **fields)
    schedule.set_days(days or [day_of_week] + ([day_2] if day_2 else []))
    schedule.save()
    return schedule


def build_schedule(section, day_of_week='Mon', start_time=time(8, 0), end_time=time(9, 0), room='Room 1',
                   subject=None, day_2=None, **fields):
    """An unsaved schedule with its meeting days staged (for validation tests)."""
    schedule = ClassSchedule(section=section, subject=subject, start_time=start_time, end_time=end_time, room=room, **fields)
    schedule.set_days([day_of_week] + ([day_2] if day_2 else []))
    return schedule


def enroll(student, section, subject=None):
    return Enrollment.objects.create(student=student, section=section, subject=subject)
