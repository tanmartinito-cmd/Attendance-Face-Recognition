"""
Authentication Service
Handles user profile updates, password validations, session context,
and login brute-force lockout.
"""
from django.conf import settings
from django.core.cache import cache
from django.utils import timezone

from attendance_fr.api.services.users import UserService


class AuthService:

    @staticmethod
    def update_profile(user, data):
        """
        Updates the authenticated user's own profile.
        Delegates to UserService.update_current_user_profile.
        """
        return UserService.update_current_user_profile(user, data)

    @staticmethod
    def change_password(user, current_password, new_password, confirm_password):
        """
        Change the signed-in user's own password, then sign out every device.
        Raises ValueError(field, message) when the request is not acceptable.
        """
        from attendance_fr.api.services.users import validate_password_strength

        if not current_password or not user.check_password(current_password):
            raise ValueError('current_password', 'Current password is incorrect.')
        if not new_password:
            raise ValueError('new_password', 'Enter a new password.')
        if new_password != (confirm_password or ''):
            raise ValueError('confirm_password', 'New passwords do not match.')
        if new_password == current_password:
            raise ValueError('new_password', 'New password must be different from your current password.')
        error = validate_password_strength(new_password, user=user)
        if error:
            raise ValueError('new_password', error)

        user.set_password(new_password)  # also ends Django admin sessions on other devices
        user.save(update_fields=['password'])
        TokenRevocation.revoke_all_for_user(user)
        return user


class LoginLockout:
    """
    Temporary lockout after repeated failed logins. Two layers:

    1. username + client IP (short): LOGIN_MAX_FAILED_ATTEMPTS -> LOGIN_LOCKOUT_MINUTES.
       One person guessing cannot lock an instructor out from every device.
    2. per ACCOUNT across all IPs (long): LOGIN_ACCOUNT_MAX_FAILURES within
       LOGIN_ACCOUNT_WINDOW_HOURS locks the account until the window ends or an admin runs
       `python manage.py unlock_login <username>`. Stops slow guessing spread over many IPs
       (NIST SP 800-63B). A successful login resets it.

    Counters live in the shared "security" cache (database), so all gunicorn workers agree.
    Unknown usernames are counted and locked exactly like real ones, so responses never
    reveal whether an account exists.
    """

    FAIL_PREFIX = 'login_fail_'
    LOCK_PREFIX = 'login_lock_'
    ACCOUNT_FAIL_PREFIX = 'login_acct_fail_'
    ACCOUNT_LOCK_PREFIX = 'login_acct_lock_'

    @staticmethod
    def _store():
        from django.core.cache import caches
        return caches['security'] if 'security' in settings.CACHES else cache

    @staticmethod
    def _hash(value):
        from hashlib import sha256
        return sha256(value.encode('utf-8')).hexdigest()

    @classmethod
    def _ident(cls, username, ip):
        return cls._hash(f"{str(username or '').strip().lower()}|{ip or 'unknown'}")

    @classmethod
    def _account_ident(cls, username):
        """The same account whether they type the username, Student/Faculty ID, or email."""
        from accounts.backends import FlexibleLoginBackend
        user = FlexibleLoginBackend.find_user(username)
        key = f'user:{user.pk}' if user else f"name:{str(username or '').strip().lower()}"
        return cls._hash(key)

    @staticmethod
    def _account_max():
        return max(1, int(getattr(settings, 'LOGIN_ACCOUNT_MAX_FAILURES', 100)))

    @staticmethod
    def _account_window_seconds():
        return max(1, int(getattr(settings, 'LOGIN_ACCOUNT_WINDOW_HOURS', 24))) * 3600

    @classmethod
    def _incr(cls, key, timeout):
        store = cls._store()
        store.add(key, 0, timeout=timeout)  # window starts at the first failure
        try:
            return store.incr(key)
        except ValueError:
            store.set(key, 1, timeout=timeout)
            return 1

    @classmethod
    def account_seconds_remaining(cls, username):
        """Seconds until this ACCOUNT may try again from anywhere (0 = not locked)."""
        locked_until = cls._store().get(cls.ACCOUNT_LOCK_PREFIX + cls._account_ident(username))
        if not locked_until:
            return 0
        return max(0, int(locked_until - timezone.now().timestamp()))

    @classmethod
    def register_account_failure(cls, username):
        """Counts a failure against the account. Returns lock seconds once the cap is hit, else 0."""
        ident = cls._account_ident(username)
        window = cls._account_window_seconds()
        failures = cls._incr(cls.ACCOUNT_FAIL_PREFIX + ident, window)
        if failures >= cls._account_max():
            store = cls._store()
            store.set(cls.ACCOUNT_LOCK_PREFIX + ident, timezone.now().timestamp() + window, timeout=window)
            store.delete(cls.ACCOUNT_FAIL_PREFIX + ident)
            return window
        return 0

    @classmethod
    def unlock_account(cls, username):
        """Admin action: clear the account-wide lock and counter."""
        ident = cls._account_ident(username)
        cls._store().delete_many([cls.ACCOUNT_FAIL_PREFIX + ident, cls.ACCOUNT_LOCK_PREFIX + ident])

    @staticmethod
    def _max_attempts():
        return max(1, int(getattr(settings, 'LOGIN_MAX_FAILED_ATTEMPTS', 5)))

    @staticmethod
    def _lock_seconds():
        return max(1, int(getattr(settings, 'LOGIN_LOCKOUT_MINUTES', 15))) * 60

    @classmethod
    def seconds_remaining(cls, username, ip):
        """Seconds until this username+IP may try again (0 = not locked)."""
        locked_until = cls._store().get(cls.LOCK_PREFIX + cls._ident(username, ip))
        if not locked_until:
            return 0
        return max(0, int(locked_until - timezone.now().timestamp()))

    @classmethod
    def register_failure(cls, username, ip):
        """Counts a failed login; locks the pair once the limit is reached. Returns lock seconds (0 if not locked)."""
        ident = cls._ident(username, ip)
        fail_key = cls.FAIL_PREFIX + ident
        lock_seconds = cls._lock_seconds()
        failures = cls._incr(fail_key, lock_seconds)

        if failures >= cls._max_attempts():
            store = cls._store()
            store.set(cls.LOCK_PREFIX + ident, timezone.now().timestamp() + lock_seconds, timeout=lock_seconds)
            store.delete(fail_key)
            return lock_seconds
        return 0

    @classmethod
    def reset(cls, username, ip):
        """Successful login: clear this pair and the account-wide counter."""
        ident = cls._ident(username, ip)
        cls._store().delete_many([
            cls.FAIL_PREFIX + ident, cls.LOCK_PREFIX + ident,
            cls.ACCOUNT_FAIL_PREFIX + cls._account_ident(username),
        ])


class TokenRevocation:
    """
    Server-side JWT revocation (logout + single-use refresh tokens).
    Lookups are cached briefly; a revoke writes the cache immediately, so the
    worker that handled the logout rejects the token at once. Other workers see
    it within REVOCATION_NEGATIVE_CACHE_SECONDS (LocMemCache is per process).
    """
    CACHE_PREFIX = 'jwt_revoked_'
    REVOCATION_NEGATIVE_CACHE_SECONDS = 15

    @staticmethod
    def _expires_at(token):
        from datetime import datetime, timezone as dt_timezone
        exp = token.get('exp')
        if exp:
            return datetime.fromtimestamp(int(exp), tz=dt_timezone.utc)
        return timezone.now()

    @classmethod
    def revoke(cls, token):
        """
        Revoke a validated simplejwt token object.
        Returns True if this call revoked it, False if it was already revoked
        (used to make refresh tokens strictly single-use).
        """
        from django.db import IntegrityError, transaction
        from accounts.models import RevokedToken

        jti = token.get('jti')
        if not jti:
            return False
        try:
            with transaction.atomic():
                RevokedToken.objects.create(
                    jti=jti,
                    token_type=str(token.get('token_type', ''))[:10],
                    expires_at=cls._expires_at(token),
                )
            created = True
        except IntegrityError:
            created = False
        cache.set(cls.CACHE_PREFIX + jti, True, timeout=24 * 3600)
        return created

    @classmethod
    def is_revoked(cls, jti):
        if not jti:
            return False
        cached = cache.get(cls.CACHE_PREFIX + jti)
        if cached is not None:
            return cached
        from accounts.models import RevokedToken
        revoked = RevokedToken.objects.filter(jti=jti).exists()
        cache.set(
            cls.CACHE_PREFIX + jti, revoked,
            timeout=24 * 3600 if revoked else cls.REVOCATION_NEGATIVE_CACHE_SECONDS,
        )
        return revoked

    # ── Sign out every device of one user (password change) ──────────────────
    VALID_AFTER_PREFIX = 'jwt_valid_after_'

    @staticmethod
    def _security_store():
        from django.core.cache import caches
        return caches['security'] if 'security' in settings.CACHES else cache

    @classmethod
    def revoke_all_for_user(cls, user):
        """
        Every token issued to `user` before now stops working (access and refresh, all devices).
        Stored in the shared database cache for as long as a refresh token can live.
        """
        cutoff = int(timezone.now().timestamp())
        lifetime = int(settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME'].total_seconds()) + 3600
        key = cls.VALID_AFTER_PREFIX + str(user.pk)
        cls._security_store().set(key, cutoff, timeout=lifetime)
        cache.set(key, cutoff, timeout=lifetime)
        return cutoff

    @classmethod
    def issued_before_cutoff(cls, user_id, issued_at):
        """True if this token was issued before the user's last 'sign out everywhere'."""
        if user_id is None or issued_at is None:
            return False
        key = cls.VALID_AFTER_PREFIX + str(user_id)
        cutoff = cache.get(key)
        if cutoff is None:
            cutoff = cls._security_store().get(key) or 0
            cache.set(key, cutoff, timeout=cls.REVOCATION_NEGATIVE_CACHE_SECONDS)
        return bool(cutoff) and int(issued_at) < int(cutoff)

    @staticmethod
    def purge_expired():
        """Expired tokens are rejected by signature/expiry checks anyway; drop their rows."""
        from accounts.models import RevokedToken
        return RevokedToken.objects.filter(expires_at__lt=timezone.now()).delete()[0]
