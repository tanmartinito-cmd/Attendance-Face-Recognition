"""
Optional two-step sign-in with an authenticator app (Google / Microsoft Authenticator, ...).

    setup    -> new secret (encrypted at rest) + QR code; not active yet
    enable   -> user proves the app works with one code; 10 backup codes are shown once
    sign-in  -> password, then a 6-digit code (or a backup code) within 5 minutes
    disable  -> needs the password AND a current code (or a backup code)

Codes follow TOTP (RFC 6238): 6 digits, 30-second steps, ±1 step allowed for clock drift.
A code can be used only once (last_used_step). Backup codes are stored as HMAC hashes.
"""
import base64
import hashlib
import hmac
import secrets

import pyotp
import segno
from cryptography.fernet import Fernet, InvalidToken as FernetInvalidToken
from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from accounts.models import UserBackupCode, UserTwoFactor

ISSUER = 'AttendFR'
BACKUP_CODE_COUNT = 10
BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'  # no 0/o, 1/l/i
CHALLENGE_SALT = 'attendfr.two-factor-login'
CHALLENGE_MAX_AGE = 300  # seconds to type the code after the password


class TwoFactorError(ValueError):
    """User-facing problem (wrong code, nothing to confirm...)."""


# ── Secret encryption ─────────────────────────────────────────────────────────

def _fernet():
    """Key: TWO_FACTOR_KEY if set (recommended), else derived from SECRET_KEY."""
    raw = getattr(settings, 'TWO_FACTOR_KEY', '') or settings.SECRET_KEY
    key = base64.urlsafe_b64encode(hashlib.sha256(f'attendfr-2fa|{raw}'.encode()).digest())
    return Fernet(key)


def _encrypt(secret):
    return _fernet().encrypt(secret.encode()).decode()


def _decrypt(token):
    try:
        return _fernet().decrypt(token.encode()).decode()
    except FernetInvalidToken:
        return None


# ── Backup codes ──────────────────────────────────────────────────────────────

def _normalize_backup(code):
    return ''.join(ch for ch in str(code or '').lower() if ch.isalnum())


def _hash_backup(code):
    return hmac.new(settings.SECRET_KEY.encode(), f'backup|{_normalize_backup(code)}'.encode(),
                    hashlib.sha256).hexdigest()


def _new_backup_codes(user):
    """Replace all backup codes. Returns the plain codes (shown to the user once)."""
    codes = []
    for _ in range(BACKUP_CODE_COUNT):
        raw = ''.join(secrets.choice(BACKUP_ALPHABET) for _ in range(10))
        codes.append(f'{raw[:5]}-{raw[5:]}')
    UserBackupCode.objects.filter(user=user).delete()
    UserBackupCode.objects.bulk_create([UserBackupCode(user=user, code_hash=_hash_backup(c)) for c in codes])
    return codes


# ── Service ───────────────────────────────────────────────────────────────────

class TwoFactorService:

    @staticmethod
    def get(user):
        # Always read the table (not the cached user.two_factor), so a change made earlier in
        # the same request (enable / disable) is seen right away.
        if user is None or not getattr(user, 'pk', None):
            return None
        return UserTwoFactor.objects.filter(user_id=user.pk).first()

    @classmethod
    def is_enabled(cls, user):
        record = cls.get(user)
        return bool(record and record.enabled)

    @staticmethod
    def backup_codes_left(user):
        return UserBackupCode.objects.filter(user=user, used_at__isnull=True).count()

    @classmethod
    def status(cls, user):
        record = cls.get(user)
        enabled = bool(record and record.enabled)
        return {
            'enabled': enabled,
            'enabled_at': record.confirmed_at if enabled else None,
            'backup_codes_left': cls.backup_codes_left(user) if enabled else 0,
        }

    # setup / enable / disable ────────────────────────────────────────────────

    @classmethod
    def start_setup(cls, user):
        """New secret + QR code. Replaces an unfinished setup; refused when already on."""
        if cls.is_enabled(user):
            raise TwoFactorError('Two-step sign-in is already on. Turn it off first to set up a new phone.')
        secret = pyotp.random_base32()
        UserTwoFactor.objects.update_or_create(
            user=user, defaults={'secret_encrypted': _encrypt(secret), 'confirmed_at': None, 'last_used_step': 0},
        )
        label = user.email or user.username
        uri = pyotp.TOTP(secret).provisioning_uri(name=label, issuer_name=ISSUER)
        qr = segno.make(uri, error='m').svg_data_uri(scale=5, border=2)
        return {'secret': secret, 'otpauth_uri': uri, 'qr_svg': qr, 'account': label, 'issuer': ISSUER}

    @classmethod
    def enable(cls, user, code):
        record = cls.get(user)
        if not record or record.enabled:
            raise TwoFactorError('Start the setup again: scan a new QR code first.')
        if not cls._accept_totp(record, code):
            raise TwoFactorError('That code is not correct. Check the time on your phone and try the newest code.')
        with transaction.atomic():
            record.confirmed_at = timezone.now()
            record.save(update_fields=['confirmed_at'])
            codes = _new_backup_codes(user)
        return codes

    @classmethod
    def disable(cls, user, password, code):
        if not cls.is_enabled(user):
            raise TwoFactorError('Two-step sign-in is not on.')
        if not password or not user.check_password(password):
            raise TwoFactorError('Your password is incorrect.')
        if not cls.verify(user, code):
            raise TwoFactorError('That code is not correct.')
        cls.force_disable(user)

    @staticmethod
    def force_disable(user):
        """Admin recovery (manage.py disable_2fa): remove 2FA without a code."""
        with transaction.atomic():
            UserTwoFactor.objects.filter(user=user).delete()
            UserBackupCode.objects.filter(user=user).delete()

    @classmethod
    def regenerate_backup_codes(cls, user, code):
        if not cls.is_enabled(user):
            raise TwoFactorError('Two-step sign-in is not on.')
        if not cls._accept_totp(cls.get(user), code):
            raise TwoFactorError('Enter the current code from your authenticator app.')
        return _new_backup_codes(user)

    # verification ────────────────────────────────────────────────────────────

    @classmethod
    def verify(cls, user, code):
        """True for a valid, unused authenticator code or an unused backup code (consumed)."""
        record = cls.get(user)
        if not record or not record.enabled:
            return False
        compact = ''.join(str(code or '').split())
        if compact.isdigit() and len(compact) == 6:
            return cls._accept_totp(record, compact)
        return cls._accept_backup(user, code)

    @staticmethod
    def _accept_totp(record, code):
        code = ''.join(ch for ch in str(code or '') if ch.isdigit())
        if len(code) != 6:
            return False
        secret = _decrypt(record.secret_encrypted)
        if not secret:
            return False
        totp = pyotp.TOTP(secret)
        now = timezone.now()
        current_step = totp.timecode(now)
        for offset in (0, -1, 1):  # clock drift of one step either way
            step = current_step + offset
            if constant_time_compare(totp.generate_otp(step), code):
                if step <= record.last_used_step:
                    return False  # already used: a code works only once
                # Atomic: two requests with the same code cannot both succeed.
                updated = UserTwoFactor.objects.filter(
                    pk=record.pk, last_used_step__lt=step,
                ).update(last_used_step=step)
                if updated:
                    record.last_used_step = step
                return bool(updated)
        return False

    @staticmethod
    def _accept_backup(user, code):
        normalized = _normalize_backup(code)
        if len(normalized) != 10:
            return False
        updated = UserBackupCode.objects.filter(
            user=user, code_hash=_hash_backup(normalized), used_at__isnull=True,
        ).update(used_at=timezone.now())
        return bool(updated)

    # sign-in challenge ───────────────────────────────────────────────────────

    @staticmethod
    def _password_fingerprint(user):
        # Changes when the password changes, so an old challenge stops working.
        return salted_hmac('attendfr.2fa-fingerprint', user.password).hexdigest()[:16]

    @classmethod
    def make_challenge(cls, user):
        """Signed, short-lived proof that the password step passed (not a session)."""
        return signing.dumps({'u': user.pk, 'f': cls._password_fingerprint(user)}, salt=CHALLENGE_SALT)

    @classmethod
    def read_challenge(cls, challenge):
        """The user the challenge was issued to, or None if invalid / expired."""
        from accounts.models import User
        try:
            data = signing.loads(str(challenge or ''), salt=CHALLENGE_SALT, max_age=CHALLENGE_MAX_AGE)
        except signing.BadSignature:
            return None
        user = User.objects.filter(pk=data.get('u'), is_active=True).first()
        if not user or not constant_time_compare(data.get('f', ''), cls._password_fingerprint(user)):
            return None
        return user
