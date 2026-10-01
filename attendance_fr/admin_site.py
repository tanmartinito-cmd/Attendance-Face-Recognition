"""
Django admin with the same brute-force protection as the app's sign-in (/api/token/).

Without this, /admin/login/ accepts unlimited password guesses: no lockout and no rate limit.
Now it shares the app's rules and counters:
  - LOGIN_MAX_FAILED_ATTEMPTS per username + IP -> locked for LOGIN_LOCKOUT_MINUTES
  - LOGIN_ACCOUNT_MAX_FAILURES per account across all IPs -> account locked (unlock_login)
  - the "login" rate limit per IP (THROTTLE_LOGIN)

Enabled in settings.INSTALLED_APPS via SecureAdminConfig (replaces 'django.contrib.admin').
"""
import math

from django.contrib import admin
from django.contrib.admin.apps import AdminConfig
from django.http import HttpResponse
from django.utils.html import escape


def _locked_response(seconds):
    seconds = max(1, int(math.ceil(seconds)))
    minutes = max(1, math.ceil(seconds / 60))
    message = f'Too many failed sign-in attempts. Please try again in {minutes} minute(s).'
    response = HttpResponse(
        f'<!doctype html><title>Sign-in locked</title><p>{escape(message)}</p>',
        status=429,
    )
    response['Retry-After'] = str(seconds)
    return response


class SecureAdminSite(admin.AdminSite):
    login_template = 'admin/two_factor_login.html'  # adds the two-step code field

    def login(self, request, extra_context=None):
        # Imported here: forms and API modules import models, which are not ready at app loading.
        from attendance_fr.admin_forms import TwoFactorAdminAuthenticationForm
        self.login_form = TwoFactorAdminAuthenticationForm
        if request.method != 'POST':
            return super().login(request, extra_context)

        from attendance_fr.api.services.auth import LoginLockout
        from attendance_fr.api.views.auth import LoginRateThrottle

        throttle = LoginRateThrottle()
        username = str(request.POST.get('username', '') or '')
        ip = throttle.get_ident(request)

        if not throttle.allow_request(request, None):
            return _locked_response(throttle.wait() or 60)
        remaining = LoginLockout.account_seconds_remaining(username) or LoginLockout.seconds_remaining(username, ip)
        if remaining:
            return _locked_response(remaining)

        response = super().login(request, extra_context)

        signed_in = response.status_code in (301, 302) and request.user.is_authenticated
        if signed_in:
            LoginLockout.reset(username, ip)
        else:
            # Wrong password, unknown user, or a non-staff account: all count as failures.
            LoginLockout.register_account_failure(username)
            LoginLockout.register_failure(username, ip)
        return response


class SecureAdminConfig(AdminConfig):
    default_site = 'attendance_fr.admin_site.SecureAdminSite'
