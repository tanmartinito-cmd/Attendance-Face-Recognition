"""
Public self-registration (students and faculty) with administrator approval, plus the
required first face enrollment for students.

    register  -> inactive user + AccountRegistration(status=pending)
    approve   -> user becomes active; admin later assigns sections/subjects as usual
    reject    -> stays inactive; the reason is shown at sign-in; registering again with the
                 same ID replaces the rejected attempt
    sign-in   -> pending / rejected users get a clear message instead of "wrong password"
    face gate -> a signed-in student without a face enrollment can only use the endpoints
                 needed to enroll it (attendance_fr/authentication.py enforces this)

Bot protection: Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set, plus a per-IP rate limit.
"""
import logging
import re

import requests
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.utils import timezone

from accounts.models import AccountRegistration, Role, User
from attendance_fr.api.services.users import UserService
from core.models import Course, Instructor, Program, Student, StudentBiometric

logger = logging.getLogger(__name__)

TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
ID_PATTERN = re.compile(r'^[A-Za-z0-9][A-Za-z0-9-]{2,19}$')
EMAIL_PATTERN = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


class RegistrationError(ValueError):
    """User-facing problem with a registration: (field, message)."""

    def __init__(self, field, message):
        super().__init__(message)
        self.field = field


# ── Bot check ─────────────────────────────────────────────────────────────────

def turnstile_enabled():
    return bool(getattr(settings, 'TURNSTILE_SECRET_KEY', ''))


def verify_turnstile(token, remote_ip=None):
    """True when Turnstile is off, or Cloudflare confirms the token. Fails closed on errors."""
    if not turnstile_enabled():
        return True
    if not token:
        return False
    payload = {'secret': settings.TURNSTILE_SECRET_KEY, 'response': str(token)[:2048]}
    if remote_ip:
        payload['remoteip'] = remote_ip
    try:
        response = requests.post(TURNSTILE_VERIFY_URL, data=payload, timeout=8)
        data = response.json()
    except (requests.RequestException, ValueError) as exc:
        logger.warning('Turnstile verification failed: %s', exc)
        return False
    if not data.get('success'):
        logger.info('Turnstile rejected a registration: %s', data.get('error-codes'))
        return False
    action = data.get('action')
    return action in (None, '', 'register')


# ── Registration ──────────────────────────────────────────────────────────────

class RegistrationService:

    @staticmethod
    def options():
        """Active programs and courses for the public form (codes and names only)."""
        programs = list(Program.objects.filter(is_active=True).order_by('code').values('id', 'code', 'name'))
        courses = list(
            Course.objects.filter(is_active=True, program__is_active=True)
            .order_by('program__code', 'code').values('id', 'code', 'name', 'program_id')
        )
        for course in courses:
            course['program'] = course.pop('program_id')
        return {
            'programs': programs,
            'courses': courses,
            'turnstile_site_key': getattr(settings, 'TURNSTILE_SITE_KEY', '') if turnstile_enabled() else '',
        }

    @staticmethod
    def _clean(data, key, max_length=100):
        return str(data.get(key) or '').strip()[:max_length]

    @classmethod
    def register(cls, data):
        """Create an inactive account waiting for approval. Raises RegistrationError."""
        role = cls._clean(data, 'role', 20)
        if role not in (Role.STUDENT, Role.INSTRUCTOR):
            raise RegistrationError('role', 'Choose Student or Faculty.')

        first_name = cls._clean(data, 'first_name')
        last_name = cls._clean(data, 'last_name')
        email = cls._clean(data, 'email', 254).lower()
        password = str(data.get('password') or '')
        if not first_name:
            raise RegistrationError('first_name', 'Enter your first name.')
        if not last_name:
            raise RegistrationError('last_name', 'Enter your last name.')
        if not EMAIL_PATTERN.match(email):
            raise RegistrationError('email', 'Enter a valid email address.')
        if password != str(data.get('confirm_password') or ''):
            raise RegistrationError('confirm_password', 'Passwords do not match.')

        payload = {
            'role': role, 'first_name': first_name, 'last_name': last_name, 'email': email,
            'password': password, 'is_active': False,
            'middle_name': cls._clean(data, 'middle_name'),
            # Additional profile fields
            'gender': cls._clean(data, 'gender', 10),
            'birth_date': data.get('birth_date'),
            'birth_place': cls._clean(data, 'birth_place', 100),
            'civil_status': cls._clean(data, 'civil_status', 20),
            'religion': cls._clean(data, 'religion', 50),
            'citizenship': cls._clean(data, 'citizenship', 50),
            'languages_spoken': cls._clean(data, 'languages_spoken', 200),
            'current_address': cls._clean(data, 'current_address', 200),
            'current_region': cls._clean(data, 'current_region', 100),
            'current_province': cls._clean(data, 'current_province', 100),
            'current_municipality': cls._clean(data, 'current_municipality', 100),
            'permanent_address': cls._clean(data, 'permanent_address', 200),
            'permanent_region': cls._clean(data, 'permanent_region', 100),
            'permanent_province': cls._clean(data, 'permanent_province', 100),
            'permanent_municipality': cls._clean(data, 'permanent_municipality', 100),
            'mobile_number': cls._clean(data, 'mobile_number', 20),
            'telephone': cls._clean(data, 'telephone', 20),
            'phone': cls._clean(data, 'phone', 20),
        }

        if role == Role.STUDENT:
            identifier = cls._clean(data, 'student_id', 20)
            if not ID_PATTERN.match(identifier):
                raise RegistrationError('student_id', 'Enter your Student ID (letters, numbers and dashes).')
            if not data.get('face_consent'):
                raise RegistrationError('face_consent', 'Please agree to the use of your face for attendance.')
            course = Course.objects.filter(
                pk=data.get('course_ref') or 0, is_active=True, program__is_active=True,
            ).select_related('program').first()
            if course is None:
                raise RegistrationError('course_ref', 'Choose your program and course.')
            program_id = data.get('program')
            if program_id and str(course.program_id) != str(program_id):
                raise RegistrationError('course_ref', 'That course does not belong to the selected program.')
            try:
                year_level = int(data.get('year_level') or 0)
            except (TypeError, ValueError):
                year_level = 0
            if year_level not in (1, 2, 3, 4, 5):
                raise RegistrationError('year_level', 'Choose your year level.')
            payload.update(student_id=identifier, course_ref=course.pk, year_level=year_level,
                          course=data.get('course', ''))
            id_field, taken = 'student_id', Student.objects.filter(student_id__iexact=identifier).first()
        else:
            identifier = cls._clean(data, 'faculty_id', 20)
            if not ID_PATTERN.match(identifier):
                raise RegistrationError('faculty_id', 'Enter your Faculty ID (letters, numbers and dashes).')
            payload.update(faculty_id=identifier, department=cls._clean(data, 'department', 100))
            id_field, taken = 'faculty_id', Instructor.objects.filter(faculty_id__iexact=identifier).first()

        with transaction.atomic():
            # A previously rejected attempt with the same ID is replaced; anything else is taken.
            if taken is not None:
                registration = AccountRegistration.objects.filter(user_id=taken.user_id).first()
                if registration and registration.status == AccountRegistration.Status.REJECTED:
                    taken.user.delete()
                else:
                    label = 'Student ID' if id_field == 'student_id' else 'Faculty ID'
                    raise RegistrationError(id_field, f'This {label} already has an account or a pending registration.')
            if User.objects.filter(email__iexact=email).exists():
                raise RegistrationError('email', 'This email is already used by another account.')
            try:
                user = UserService.create_user(payload)
            except ValueError as exc:
                field = 'password' if 'assword' in str(exc) else id_field
                raise RegistrationError(field, str(exc)) from exc
            AccountRegistration.objects.create(
                user=user,
                face_consent_at=timezone.now() if role == Role.STUDENT else None,
            )
        return user

    # ── Admin review ─────────────────────────────────────────────────────────

    @staticmethod
    def queryset(status=None):
        qs = AccountRegistration.objects.select_related(
            'user__profile', 'user__student__course__program', 'user__instructor', 'reviewed_by__profile',
        )
        if status in AccountRegistration.Status.values:
            qs = qs.filter(status=status)
        return qs.order_by('-submitted_at')

    @staticmethod
    def counts():
        rows = AccountRegistration.objects.values_list('status', flat=True)
        result = {s: 0 for s in AccountRegistration.Status.values}
        for value in rows:
            result[value] = result.get(value, 0) + 1
        return result

    @staticmethod
    def serialize(reg):
        user = reg.user
        student = getattr(user, 'student', None) if user.role == Role.STUDENT else None
        instructor = getattr(user, 'instructor', None) if user.role == Role.INSTRUCTOR else None
        course = student.course if student and student.course_id else None
        reviewer = reg.reviewed_by
        return {
            'user_id': user.pk,
            'role': user.role,
            'username': user.username,
            'first_name': user.first_name,
            'last_name': user.last_name,
            'email': user.email,
            'student_id': student.student_id if student else None,
            'faculty_id': instructor.faculty_id if instructor else None,
            'department': instructor.department if instructor else None,
            'year_level': student.year_level if student else None,
            'course': {'id': course.pk, 'code': course.code, 'name': course.name} if course else None,
            'program': (
                {'id': course.program.pk, 'code': course.program.code, 'name': course.program.name}
                if course else None
            ),
            'status': reg.status,
            'submitted_at': reg.submitted_at,
            'reviewed_at': reg.reviewed_at,
            'reviewed_by': (reviewer.get_full_name() or reviewer.username) if reviewer else None,
            'rejection_reason': reg.rejection_reason,
        }

    @staticmethod
    def _get_pending(user_id):
        reg = AccountRegistration.objects.select_related('user').filter(user_id=user_id).first()
        if reg is None:
            raise RegistrationError('user', 'Registration not found.')
        if reg.status != AccountRegistration.Status.PENDING:
            raise RegistrationError('status', f'This registration was already {reg.status}.')
        return reg

    @classmethod
    def approve(cls, user_id, admin):
        reg = cls._get_pending(user_id)
        with transaction.atomic():
            reg.user.is_active = True
            reg.user.save(update_fields=['is_active'])
            reg.status = AccountRegistration.Status.APPROVED
            reg.reviewed_at = timezone.now()
            reg.reviewed_by = admin
            reg.rejection_reason = ''
            reg.save(update_fields=['status', 'reviewed_at', 'reviewed_by', 'rejection_reason'])
        return reg

    @classmethod
    def reject(cls, user_id, admin, reason):
        reason = str(reason or '').strip()
        if len(reason) < 3:
            raise RegistrationError('reason', 'Write a short reason the person will see (at least 3 characters).')
        reg = cls._get_pending(user_id)
        reg.status = AccountRegistration.Status.REJECTED
        reg.reviewed_at = timezone.now()
        reg.reviewed_by = admin
        reg.rejection_reason = reason[:300]
        reg.save(update_fields=['status', 'reviewed_at', 'reviewed_by', 'rejection_reason'])
        return reg

    # ── Sign-in message ──────────────────────────────────────────────────────

    @staticmethod
    def sign_in_block(identifier, password):
        """
        For a correct password on a pending / rejected registration, the message to show
        (instead of "wrong password"). None in every other case, so nothing is revealed
        to someone who does not know the password.
        """
        from accounts.backends import FlexibleLoginBackend
        user = FlexibleLoginBackend.find_user(identifier)
        if user is None or user.is_active:
            return None
        reg = AccountRegistration.objects.filter(user_id=user.pk).first()
        if reg is None or reg.status == AccountRegistration.Status.APPROVED:
            return None
        if not user.check_password(password or ''):
            return None
        if reg.status == AccountRegistration.Status.PENDING:
            return {
                'code': 'registration_pending',
                'detail': 'Your registration is waiting for administrator approval. Please try again later.',
            }
        return {
            'code': 'registration_rejected',
            'detail': f'Your registration was not approved: {reg.rejection_reason} '
                      'You can register again with the correct details.',
        }


# ── Required face enrollment (students) ───────────────────────────────────────

FACE_GATE_ALLOWED_PREFIXES = (
    '/api/auth/',               # me, password, two-step sign-in
    '/api/token/',
    '/api/sync/versions/',
    '/api/face/enroll/check/',
    '/api/face/enroll/self/',
    '/api/health/',
)
_ENROLLED_KEY = 'face_enrolled_user_{}'


def student_has_face(user):
    key = _ENROLLED_KEY.format(user.pk)
    if cache.get(key):
        return True
    enrolled = StudentBiometric.objects.filter(student__user_id=user.pk).exclude(face_encoding='').exists()
    if enrolled:
        cache.set(key, True, timeout=120)
    return enrolled


def forget_face_status(user_id):
    cache.delete(_ENROLLED_KEY.format(user_id))


def face_enrollment_required(user):
    """True for a signed-in student who has not enrolled a face yet (when the gate is on)."""
    if not getattr(settings, 'FACE_ENROLLMENT_GATE', True):
        return False
    if not (user and user.is_authenticated and getattr(user, 'role', None) == Role.STUDENT):
        return False
    return not student_has_face(user)


def face_gate_blocks(user, path):
    if any(path.startswith(prefix) for prefix in FACE_GATE_ALLOWED_PREFIXES):
        return False
    return face_enrollment_required(user)
