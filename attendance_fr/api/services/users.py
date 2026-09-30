"""
User & Student Service: creating/updating accounts (admin, instructor, student) and ID generation.

A user is split across tables: credentials (User), personal info (UserProfile + addresses +
languages) and the role record (Instructor / Student). The API still sends one flat payload.
"""
import re

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from accounts.models import Role, User, UserProfile
from accounts.profile_data import PERSONAL_KEYS, write_personal
from accounts.username_utils import sanitize_username
from core.models import Course, Instructor, Student


# ── Validation helpers ────────────────────────────────────────────────────────

def validate_ph_phone(phone):
    """Validates 11-digit Philippine mobile format (09XXXXXXXXX)."""
    if not phone:
        return None
    digits = re.sub(r'\D', '', str(phone).strip())
    if not re.match(r'^09\d{9}$', digits):
        return 'Phone number must be an 11-digit Philippine mobile number starting with 09 (e.g. 09123456789).'
    return None


def validate_password_strength(password, user=None):
    """
    The single project password policy. Returns a friendly error, or None when acceptable.
    Checks the 5 character rules first, then Django's AUTH_PASSWORD_VALIDATORS.
    """
    if not password:
        return 'Password cannot be empty.'
    p = str(password)
    missing = []
    if len(p) < 8:
        missing.append('at least 8 characters')
    if not re.search(r'\d', p):
        missing.append('at least 1 number')
    if not re.search(r'[a-z]', p):
        missing.append('at least 1 lowercase letter')
    if not re.search(r'[A-Z]', p):
        missing.append('at least 1 uppercase letter')
    if not re.search(r'[!@#$%^&*(),.?":{}|<>_~`\-+=\\\[\]]', p):
        missing.append('at least 1 special character')
    if missing:
        return f"Password must contain: {', '.join(missing)}."
    try:
        validate_password(p, user=user)
    except DjangoValidationError as exc:
        return ' '.join(exc.messages)
    return None


def _password_check_user(username, first_name, last_name, email):
    """Unsaved user (with profile) so the similarity validator can compare names, username and email."""
    user = User(username=username, email=email)
    user.profile = UserProfile(first_name=first_name, last_name=last_name)
    return user


def _clean_phone(value):
    value = str(value or '').strip()
    if not value:
        return ''
    error = validate_ph_phone(value)
    if error:
        raise ValueError(error)
    return re.sub(r'\D', '', value)


def _as_bool(value):
    if isinstance(value, str):
        return value.lower() in ('true', '1', 'active')
    return bool(value)


def _course_id(value):
    """Course id from the form (id, {'id': ..} or empty). Raises ValueError for unknown ids."""
    if isinstance(value, dict):
        value = value.get('id')
    if value in (None, '', 'null'):
        return None
    try:
        course_id = int(value)
    except (TypeError, ValueError):
        raise ValueError('Please select a valid course from the list.')
    if not Course.objects.filter(pk=course_id).exists():
        raise ValueError('The selected course no longer exists. Please choose another.')
    return course_id


def _personal_payload(data):
    """Personal keys from the request, with `phone` / `contact_number` mapped to the mobile number."""
    personal = {k: data[k] for k in PERSONAL_KEYS if k in data}
    for alias in ('phone', 'contact_number'):
        if alias in data and 'mobile_number' not in data:
            personal['mobile_number'] = data[alias]
    if 'mobile_number' in personal:
        personal['mobile_number'] = _clean_phone(personal['mobile_number'])
    return personal


# ── ID generators ─────────────────────────────────────────────────────────────

STUDENT_ID_PREFIX = '23100000'


def get_next_student_id():
    """Next sequential Student ID, e.g. '23100000450'."""
    highest = 449  # baseline of the school's numbering
    for sid in Student.objects.filter(student_id__startswith=STUDENT_ID_PREFIX).values_list('student_id', flat=True):
        tail = str(sid)[len(STUDENT_ID_PREFIX):]
        if tail.isdigit():
            highest = max(highest, int(tail))
    return f'{STUDENT_ID_PREFIX}{highest + 1}'


def get_next_faculty_id():
    """Next free Faculty ID in the FAC-0001 series."""
    highest = 0
    for fid in Instructor.objects.filter(faculty_id__istartswith='FAC-').values_list('faculty_id', flat=True):
        tail = str(fid)[4:]
        if tail.isdigit():
            highest = max(highest, int(tail))
    candidate = highest + 1
    while Instructor.objects.filter(faculty_id__iexact=f'FAC-{candidate:04d}').exists() or \
            User.objects.filter(username__iexact=f'FAC-{candidate:04d}').exists():
        candidate += 1
    return f'FAC-{candidate:04d}'


def sync_username_with_id(user):
    """Keep username == Faculty ID / Student ID after the ID is edited. Raises ValueError on clash."""
    profile_id = ''
    if user.role == Role.INSTRUCTOR and hasattr(user, 'instructor'):
        profile_id = user.instructor.faculty_id
    elif user.role == Role.STUDENT and hasattr(user, 'student'):
        profile_id = user.student.student_id
    profile_id = sanitize_username(profile_id)
    if not profile_id or user.username == profile_id:
        return
    if User.objects.filter(username__iexact=profile_id).exclude(pk=user.pk).exists():
        raise ValueError(f'"{profile_id}" is already used as another account\'s username.')
    user.username = profile_id
    user.save(update_fields=['username'])


INSTRUCTOR_FIELDS = [
    'faculty_id', 'department', 'specialization', 'title', 'date_hired', 'employment_status', 'position',
    'office_location', 'consultation_hours', 'education_background', 'certifications',
]
INSTRUCTOR_SELF_SERVICE_FIELDS = ['specialization', 'title', 'office_location', 'consultation_hours', 'education_background', 'certifications']

# Defaults for a new student's personal details (school location / common values).
STUDENT_DEFAULTS = {
    'gender': 'Male', 'civil_status': 'Single', 'religion': 'Roman Catholic', 'citizenship': 'Filipino',
    'languages_spoken': 'English, Filipino, Cebuano',
    'current_region': 'REGION XIII (Caraga)', 'current_province': 'Agusan del Norte', 'current_municipality': 'Butuan City',
    'permanent_region': 'REGION XIII (Caraga)', 'permanent_province': 'Agusan del Norte', 'permanent_municipality': 'Butuan City',
}


# ── User service ──────────────────────────────────────────────────────────────

class UserService:

    @staticmethod
    def create_user(data):
        """Create a user with their profile and role record. Raises ValueError on invalid input."""
        role = data.get('role', Role.INSTRUCTOR)
        if role not in Role.values:
            raise ValueError('Role must be admin, instructor, or student.')

        # The login username IS the ID: Faculty ID for instructors, Student ID for students.
        student_id = faculty_id = ''
        if role == Role.STUDENT:
            raw = str(data.get('student_id') or '').strip()
            student_id = get_next_student_id() if not raw or raw.lower() == 'auto' else raw
            if Student.objects.filter(student_id__iexact=student_id).exists():
                raise ValueError(f'Student ID "{student_id}" already exists.')
            username = sanitize_username(student_id)
        elif role == Role.INSTRUCTOR:
            faculty_id = str(data.get('faculty_id') or '').strip() or get_next_faculty_id()
            if Instructor.objects.filter(faculty_id__iexact=faculty_id).exists():
                raise ValueError(f'Faculty ID "{faculty_id}" already exists.')
            username = faculty_id
        else:
            username = str(data.get('username') or '').strip()

        password = data.get('password') or ''
        first_name = str(data.get('first_name') or '').strip()
        last_name = str(data.get('last_name') or '').strip()
        email = data.get('email') or (f'{student_id.lower()}@student.urios.edu.ph' if role == Role.STUDENT else '')

        if not username or not password:
            raise ValueError('Username and password are required.')
        error = validate_password_strength(password, user=_password_check_user(username, first_name, last_name, email))
        if error:
            raise ValueError(error)
        if User.objects.filter(username__iexact=username).exists():
            raise ValueError(f'Username "{username}" already exists.')

        personal = _personal_payload(data)
        if role == Role.STUDENT:
            personal = {**STUDENT_DEFAULTS, **{k: v for k, v in personal.items() if v not in (None, '')}}
        course_id = _course_id(data.get('course_ref')) if role == Role.STUDENT else None

        with transaction.atomic():
            user = User.objects.create_user(
                username=username, password=password, first_name=first_name, last_name=last_name,
                email=email, role=role, is_active=_as_bool(data.get('is_active', True)),
            )
            write_personal(user, personal)
            if role == Role.INSTRUCTOR:
                values = {f: data.get(f) for f in INSTRUCTOR_FIELDS if f in data and f != 'faculty_id'}
                values['date_hired'] = values.get('date_hired') or None
                Instructor.objects.create(user=user, faculty_id=faculty_id, **values)
            elif role == Role.STUDENT:
                if course_id is None and data.get('course'):
                    match = Course.objects.filter(code__iexact=str(data['course']).strip()).first()
                    course_id = match.pk if match else None
                Student.objects.create(
                    user=user, student_id=student_id, course_id=course_id,
                    year_level=int(data.get('year_level') or 1),
                )
        return user

    @staticmethod
    def update_user(user, data):
        """Update a user, their profile and role record. Raises ValueError on invalid input."""
        fields = []
        if 'email' in data:
            user.email = data['email'] or ''
            fields.append('email')
        if 'is_active' in data:
            user.is_active = _as_bool(data['is_active'])
            fields.append('is_active')
        if data.get('password'):
            error = validate_password_strength(data['password'], user=user)
            if error:
                raise ValueError(error)
            user.set_password(data['password'])
            fields.append('password')

        with transaction.atomic():
            if fields:
                user.save(update_fields=fields)
            write_personal(user, _personal_payload(data))

            if hasattr(user, 'instructor'):
                instructor = user.instructor
                for field in INSTRUCTOR_FIELDS:
                    if field in data:
                        value = data[field]
                        if field == 'date_hired':
                            value = value or None
                        setattr(instructor, field, value)
                instructor.save()

            if hasattr(user, 'student'):
                student = user.student
                if 'student_id' in data and str(data['student_id']).strip():
                    student.student_id = str(data['student_id']).strip()
                if 'year_level' in data and data['year_level'] not in (None, ''):
                    student.year_level = int(data['year_level'])
                if 'course_ref' in data:
                    student.course_id = _course_id(data['course_ref'])
                student.save()

            # Editing a Faculty ID / Student ID also changes the login username.
            sync_username_with_id(user)
        return user

    @staticmethod
    def update_current_user_profile(user, data):
        """Self-service: personal details, email, and (instructors) professional details."""
        if 'email' in data:
            user.email = data['email'] or ''
            user.save(update_fields=['email'])
        write_personal(user, _personal_payload(data))
        if user.role == Role.INSTRUCTOR and hasattr(user, 'instructor'):
            instructor = user.instructor
            for field in INSTRUCTOR_SELF_SERVICE_FIELDS:
                if field in data:
                    setattr(instructor, field, data[field])
            instructor.save()
        return user
