"""
User & Student Service
Handles business logic for user creation, updates, and student ID generation.
Extracted from api_views.py (UserListCreateAPIView, UserDetailAPIView, NextStudentIdAPIView).
"""
import re
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import transaction

from accounts.models import CustomUser, Teacher, Student


# ── Validation Helpers ──────────────────────────────────────────────────────

def validate_ph_phone(phone):
    """Validates 11-digit Philippine mobile format (09XXXXXXXXX)."""
    if not phone:
        return None
    phone_clean = re.sub(r'\D', '', str(phone).strip())
    if not re.match(r'^09\d{9}$', phone_clean):
        return 'Phone number must be an 11-digit Philippine mobile number starting with 09 (e.g. 09123456789).'
    return None


def validate_password_strength(password, user=None):
    """
    Validates a password against the single project policy.
    Returns a friendly error string, or None when the password is acceptable.
    Checks the 5 character rules first (clear checklist message), then runs
    Django's AUTH_PASSWORD_VALIDATORS (common passwords, similarity to the user, etc.).
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


# ── Student ID Generator ─────────────────────────────────────────────────────

def get_next_student_id():
    """
    Finds the highest existing student_id matching '23100000' + digits.
    Returns the next sequential ID, e.g. '23100000450'.
    """
    prefix = "23100000"
    existing_ids = Student.objects.filter(student_id__startswith=prefix).values_list('student_id', flat=True)
    max_suffix = 449  # Baseline according to current database state
    for sid in existing_ids:
        suffix_str = str(sid)[len(prefix):]
        if suffix_str.isdigit():
            val = int(suffix_str)
            if val > max_suffix:
                max_suffix = val
    return f"{prefix}{max_suffix + 1}"


def get_next_faculty_id():
    """Next free Faculty ID in the FAC-0001 series."""
    highest = 0
    for fid in Teacher.objects.filter(employee_id__istartswith='FAC-').values_list('employee_id', flat=True):
        tail = str(fid)[4:]
        if tail.isdigit():
            highest = max(highest, int(tail))
    candidate = highest + 1
    while Teacher.objects.filter(employee_id__iexact=f'FAC-{candidate:04d}').exists() or \
            CustomUser.objects.filter(username__iexact=f'FAC-{candidate:04d}').exists():
        candidate += 1
    return f'FAC-{candidate:04d}'


def sync_username_with_id(user):
    """Keep username == Faculty ID / Student ID after the ID is edited. Raises ValueError on clash."""
    profile_id = None
    if user.role == 'teacher' and getattr(user, 'teacher_profile', None):
        profile_id = user.teacher_profile.employee_id
    elif user.role == 'student' and getattr(user, 'student_profile', None):
        profile_id = user.student_profile.student_id
    profile_id = str(profile_id or '').strip()
    if not profile_id or user.username == profile_id:
        return
    if CustomUser.objects.filter(username__iexact=profile_id).exclude(pk=user.pk).exists():
        raise ValueError(f'"{profile_id}" is already used as another account\'s username.')
    user.username = profile_id
    user.save(update_fields=['username'])


# ── User Service ─────────────────────────────────────────────────────────────

class UserService:

    @staticmethod
    def create_user(data):
        """
        Creates a user (admin/teacher/student) with appropriate profile.
        Returns the created CustomUser.
        Raises ValueError on validation failures.
        """
        role = data.get('role', 'teacher')
        student_id = ''

        if role == 'student':
            raw_sid = data.get('student_id', '')
            if not raw_sid or str(raw_sid).strip() == '' or str(raw_sid).strip().lower() == 'auto':
                student_id = get_next_student_id()
            else:
                student_id = str(raw_sid).strip()

        # Login username IS the ID: Faculty ID for teachers, Student ID for students.
        # Only admins pick a free-form username.
        employee_id = ''
        if role == 'teacher':
            employee_id = str(data.get('employee_id') or '').strip() or get_next_faculty_id()
            if Teacher.objects.filter(employee_id__iexact=employee_id).exists():
                raise ValueError(f'Faculty ID "{employee_id}" already exists.')
            username = employee_id
        elif role == 'student':
            username = student_id
            if Student.objects.filter(student_id__iexact=student_id).exists():
                raise ValueError(f'Student ID "{student_id}" already exists.')
        else:
            username = str(data.get('username') or '').strip()
        password = data.get('password') or ''
        first_name = data.get('first_name', '')
        last_name = data.get('last_name', '')
        email = data.get('email', '') or (f"{student_id.lower()}@student.urios.edu.ph" if role == 'student' else '')
        phone = data.get('phone', '') or data.get('mobile_number', '')

        if not username or not password:
            raise ValueError('Username and password are required.')

        # Unsaved stand-in so the similarity check can compare against name/username/email.
        pwd_err = validate_password_strength(password, user=CustomUser(
            username=username, first_name=first_name, last_name=last_name, email=email,
        ))
        if pwd_err:
            raise ValueError(pwd_err)

        phone_val = str(phone).strip()
        if phone_val:
            phone_err = validate_ph_phone(phone_val)
            if phone_err:
                raise ValueError(phone_err)
            phone = re.sub(r'\D', '', phone_val)
        else:
            phone = ''

        if CustomUser.objects.filter(username=username).exists():
            raise ValueError(f'Username "{username}" already exists.')

        is_active = data.get('is_active', True)
        if isinstance(is_active, str):
            is_active = is_active.lower() in ('true', '1', 'active')
        else:
            is_active = bool(is_active)

        with transaction.atomic():
            user = CustomUser.objects.create_user(
                username=username,
                password=password,
                first_name=first_name,
                last_name=last_name,
                email=email,
                role=role,
                phone=phone,
            )
            if not is_active:
                user.is_active = False
                user.save(update_fields=['is_active'])

            if role == 'teacher':
                Teacher.objects.create(
                    user=user,
                    employee_id=employee_id,
                    department=data.get('department', ''),
                    specialization=data.get('specialization', ''),
                    title=data.get('title', ''),
                    date_hired=data.get('date_hired') or None,
                    employment_status=data.get('employment_status', 'Regular'),
                    position=data.get('position', ''),
                    contact_number=data.get('contact_number', ''),
                    office_location=data.get('office_location', ''),
                    consultation_hours=data.get('consultation_hours', ''),
                    education_background=data.get('education_background', ''),
                    certifications=data.get('certifications', ''),
                )
            elif role == 'student':
                Student.objects.create(
                    user=user,
                    student_id=student_id or f'STU-{user.id:04d}',
                    year_level=int(data.get('year_level', 1)),
                    course=data.get('course', ''),
                    course_ref_id=data.get('course_ref') or None,
                    middle_name=data.get('middle_name', ''),
                    gender=data.get('gender', 'Male'),
                    birth_date=data.get('birth_date') or None,
                    birth_place=data.get('birth_place', ''),
                    civil_status=data.get('civil_status', 'Single'),
                    blood_type=data.get('blood_type', ''),
                    height=data.get('height', ''),
                    religion=data.get('religion', 'Roman Catholic'),
                    citizenship=data.get('citizenship', 'Filipino'),
                    languages_spoken=data.get('languages_spoken', 'English, Filipino, Cebuano'),
                    current_address=data.get('current_address', ''),
                    current_region=data.get('current_region', 'REGION XIII (Caraga)'),
                    current_province=data.get('current_province', 'Agusan del Norte'),
                    current_municipality=data.get('current_municipality', 'Butuan City'),
                    permanent_address=data.get('permanent_address', ''),
                    permanent_region=data.get('permanent_region', 'REGION XIII (Caraga)'),
                    permanent_province=data.get('permanent_province', 'Agusan del Norte'),
                    permanent_municipality=data.get('permanent_municipality', 'Butuan City'),
                    telephone=data.get('telephone', ''),
                    mobile_number=data.get('mobile_number', '') or phone,
                )

        return user

    @staticmethod
    def update_user(user, data):
        """
        Updates user base fields and their associated profile (teacher/student).
        Returns the updated user.
        Raises ValueError on validation failures.
        """
        if 'first_name' in data:
            user.first_name = data['first_name']
        if 'last_name' in data:
            user.last_name = data['last_name']
        if 'email' in data:
            user.email = data['email']

        if 'phone' in data:
            phone_val = str(data['phone']).strip()
            if phone_val:
                phone_err = validate_ph_phone(phone_val)
                if phone_err:
                    raise ValueError(phone_err)
                user.phone = re.sub(r'\D', '', phone_val)
            else:
                user.phone = ''

        if 'is_active' in data:
            raw_active = data['is_active']
            if isinstance(raw_active, str):
                user.is_active = raw_active.lower() in ('true', '1', 'active')
            else:
                user.is_active = bool(raw_active)

        if data.get('password'):
            pwd_err = validate_password_strength(data['password'], user=user)
            if pwd_err:
                raise ValueError(pwd_err)
            user.set_password(data['password'])

        user.save()

        if hasattr(user, 'teacher_profile') and user.teacher_profile:
            tp = user.teacher_profile
            teacher_fields = [
                'department', 'specialization', 'employee_id', 'title', 
                'date_hired', 'employment_status', 'position', 'contact_number',
                'office_location', 'consultation_hours', 'education_background', 'certifications'
            ]
            for field in teacher_fields:
                if field in data:
                    val = data[field]
                    if field == 'date_hired' and not val:
                        val = None
                    setattr(tp, field, val)
            tp.save()

        if hasattr(user, 'student_profile') and user.student_profile:
            sp = user.student_profile
            fsuu_fields = [
                'course', 'course_ref', 'year_level', 'student_id', 'middle_name', 'gender',
                'birth_date', 'birth_place', 'civil_status', 'blood_type', 'height',
                'religion', 'citizenship', 'languages_spoken',
                'current_address', 'current_region', 'current_province', 'current_municipality',
                'permanent_address', 'permanent_region', 'permanent_province', 'permanent_municipality',
                'telephone', 'mobile_number',
            ]
            for field in fsuu_fields:
                if field in data:
                    val = data[field]
                    if field == 'year_level':
                        val = int(val)
                    elif field == 'birth_date':
                        # Handle empty string or None for birth_date
                        if not val or val == '':
                            val = None
                    setattr(sp, field, val)
            if sp.course_ref_id:
                sp.course = sp.course_ref.code
            sp.save()  # This will trigger _sync_biometric() to update StudentBiometric table

        # Editing a Faculty ID / Student ID also changes the login username.
        sync_username_with_id(user)
        return user

    @staticmethod
    def update_current_user_profile(user, data):
        """Updates the explicit, role-appropriate self-service profile fields."""
        for field in ('first_name', 'last_name', 'email'):
            if field in data:
                setattr(user, field, data[field])

        if 'phone' in data:
            phone_val = str(data['phone']).strip()
            if phone_val:
                phone_err = validate_ph_phone(phone_val)
                if phone_err:
                    raise ValueError(phone_err)
                user.phone = re.sub(r'\D', '', phone_val)
            else:
                user.phone = ''
        user.save()

        if user.role == 'teacher' and hasattr(user, 'teacher_profile'):
            profile = user.teacher_profile
            for field in ('specialization', 'title', 'contact_number', 'office_location', 'consultation_hours', 'education_background', 'certifications'):
                if field in data:
                    setattr(profile, field, data[field])
            profile.save()

        if user.role == 'student' and hasattr(user, 'student_profile'):
            profile = user.student_profile
            for field in ('middle_name', 'gender', 'birth_date', 'birth_place', 'civil_status', 'blood_type', 'height', 'religion', 'citizenship', 'languages_spoken', 'current_address', 'current_region', 'current_province', 'current_municipality', 'permanent_address', 'permanent_region', 'permanent_province', 'permanent_municipality', 'telephone', 'mobile_number'):
                if field in data:
                    setattr(profile, field, data[field])
            profile.save()

        return user
