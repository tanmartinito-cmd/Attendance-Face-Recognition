"""
Sign-in credentials and personal information (every role).
Role-specific data (Instructor, Student, StudentBiometric) lives in core.models.

    users              who can sign in (credentials only)
    user_profiles      who they are (personal information, 1:1 with users)
    user_addresses     current / permanent address (1:many)
    user_languages     languages spoken (1:many)
    revoked_tokens     signed-out JWTs
"""
from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone

from accounts.validators import validate_image_upload


class Role(models.TextChoices):
    ADMIN = 'admin', 'Admin'
    INSTRUCTOR = 'instructor', 'Instructor'
    STUDENT = 'student', 'Student'


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, username, password, profile=None, **fields):
        if not username:
            raise ValueError('A username is required.')
        fields['email'] = self.normalize_email(fields.get('email', ''))
        user = self.model(username=username, **fields)
        user.set_password(password)
        user.save(using=self._db)
        UserProfile.objects.update_or_create(user=user, defaults=profile or {})
        return user

    def create_user(self, username, password=None, first_name='', last_name='', **fields):
        fields.setdefault('is_staff', False)
        fields.setdefault('is_superuser', False)
        return self._create_user(username, password, {'first_name': first_name, 'last_name': last_name}, **fields)

    def create_superuser(self, username, password=None, first_name='', last_name='', **fields):
        fields.update(is_staff=True, is_superuser=True, role=Role.ADMIN)
        return self._create_user(username, password, {'first_name': first_name, 'last_name': last_name}, **fields)


class User(AbstractBaseUser, PermissionsMixin):
    """Sign-in credentials. Names and personal details live in UserProfile."""
    username = models.CharField(max_length=150, unique=True)
    email = models.EmailField(blank=True)
    role = models.CharField(max_length=10, choices=Role.choices, default=Role.STUDENT)
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False, help_text='Can open the Django admin site.')
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = 'username'
    EMAIL_FIELD = 'email'
    REQUIRED_FIELDS = ['email']

    class Meta:
        db_table = 'users'
        verbose_name = 'User'
        verbose_name_plural = 'Users'
        indexes = [models.Index(fields=['role'], name='user_role_idx')]

    def __str__(self):
        return f"{self.get_full_name() or self.username} ({self.get_role_display()})"

    # Names come from the profile; these keep the familiar Django API working.
    @property
    def _profile(self):
        try:
            return self.profile
        except UserProfile.DoesNotExist:
            return None

    @property
    def first_name(self):
        return getattr(self._profile, 'first_name', '') or ''

    @property
    def last_name(self):
        return getattr(self._profile, 'last_name', '') or ''

    def get_full_name(self):
        return f'{self.first_name} {self.last_name}'.strip()

    def get_short_name(self):
        return self.first_name or self.username

    @property
    def is_admin_role(self):
        return self.role == Role.ADMIN

    @property
    def is_instructor_role(self):
        return self.role == Role.INSTRUCTOR

    @property
    def is_student_role(self):
        return self.role == Role.STUDENT


class UserProfile(models.Model):
    """Personal information shared by every role."""
    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True, related_name='profile')
    first_name = models.CharField(max_length=100, blank=True)
    middle_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    gender = models.CharField(max_length=10, blank=True)
    birth_date = models.DateField(null=True, blank=True)
    birth_place = models.CharField(max_length=150, blank=True)
    civil_status = models.CharField(max_length=30, blank=True)
    citizenship = models.CharField(max_length=50, blank=True)
    religion = models.CharField(max_length=100, blank=True)
    blood_type = models.CharField(max_length=10, blank=True)
    height = models.CharField(max_length=20, blank=True)
    mobile_number = models.CharField(max_length=30, blank=True)
    telephone = models.CharField(max_length=30, blank=True)
    photo = models.ImageField(upload_to='profiles/', null=True, blank=True, validators=[validate_image_upload])

    class Meta:
        db_table = 'user_profiles'
        verbose_name = 'User Profile'
        indexes = [models.Index(fields=['last_name', 'first_name'], name='profile_name_idx')]

    def __str__(self):
        return f'{self.first_name} {self.last_name}'.strip() or str(self.user_id)


class UserAddress(models.Model):
    class Kind(models.TextChoices):
        CURRENT = 'current', 'Current'
        PERMANENT = 'permanent', 'Permanent'

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='addresses')
    kind = models.CharField(max_length=10, choices=Kind.choices)
    street = models.CharField(max_length=255, blank=True)
    region = models.CharField(max_length=100, blank=True)
    province = models.CharField(max_length=100, blank=True)
    municipality = models.CharField(max_length=100, blank=True)

    class Meta:
        db_table = 'user_addresses'
        verbose_name = 'User Address'
        verbose_name_plural = 'User Addresses'
        constraints = [models.UniqueConstraint(fields=['user', 'kind'], name='unique_address_kind_per_user')]

    def __str__(self):
        return f'{self.get_kind_display()}: {self.street}'


class UserLanguage(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='languages')
    name = models.CharField(max_length=50)

    class Meta:
        db_table = 'user_languages'
        verbose_name = 'User Language'
        ordering = ['id']
        constraints = [models.UniqueConstraint(fields=['user', 'name'], name='unique_language_per_user')]

    def __str__(self):
        return self.name


class RevokedToken(models.Model):
    """JWT ids that must no longer be accepted (logout, used refresh tokens)."""
    jti = models.CharField(max_length=255, unique=True)
    token_type = models.CharField(max_length=10)  # 'access' | 'refresh'
    expires_at = models.DateTimeField(db_index=True)
    revoked_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'revoked_tokens'

    def __str__(self):
        return f'{self.token_type}:{self.jti}'


class UserTwoFactor(models.Model):
    """
    Optional two-step sign-in with an authenticator app (TOTP, RFC 6238), any role.
    The shared secret is encrypted at rest (see attendance_fr/api/services/two_factor.py).
    A row with confirmed_at=None is a setup that was started but not finished.
    """
    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True, related_name='two_factor')
    secret_encrypted = models.TextField()
    confirmed_at = models.DateTimeField(null=True, blank=True)
    last_used_step = models.BigIntegerField(default=0, help_text='Last accepted 30-second step; stops code reuse.')
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'user_two_factor'
        verbose_name = 'Two-step sign-in'

    @property
    def enabled(self):
        return self.confirmed_at is not None

    def __str__(self):
        return f'2FA for {self.user_id} ({"on" if self.enabled else "setup"})'


class UserBackupCode(models.Model):
    """One-time recovery codes for two-step sign-in (only a hash is stored)."""
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='backup_codes')
    code_hash = models.CharField(max_length=128)
    used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = 'user_backup_codes'
        verbose_name = 'Backup code'


class AccountRegistration(models.Model):
    """
    A self-registered account (public Register page). The user row is created inactive and
    can only sign in once an administrator approves it. Accounts created by an administrator
    have no row here and are treated as approved.
    """
    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        APPROVED = 'approved', 'Approved'
        REJECTED = 'rejected', 'Rejected'

    user = models.OneToOneField(User, on_delete=models.CASCADE, primary_key=True, related_name='registration')
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.PENDING, db_index=True)
    submitted_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)
    reviewed_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    rejection_reason = models.CharField(max_length=300, blank=True)
    face_consent_at = models.DateTimeField(null=True, blank=True, help_text='Student agreed to face-data use.')

    class Meta:
        db_table = 'account_registrations'
        verbose_name = 'Account registration'
        ordering = ['-submitted_at']

    def __str__(self):
        return f'{self.user_id}: {self.status}'
