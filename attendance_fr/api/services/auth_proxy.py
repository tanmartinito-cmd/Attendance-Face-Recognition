"""
Helpers for browser login through the Cloudflare Pages proxy.

- The refresh token lives in an httpOnly cookie (JavaScript can never read it).
- Requests from our proxy carry X-Proxy-Secret; only then is X-Client-IP (the real user
  IP from Cloudflare's CF-Connecting-IP) trusted for rate limits and lockouts.
- Cookie-authenticated calls (refresh / logout) must come from an allowed Origin (CSRF).
"""
import re
from hmac import compare_digest

from django.conf import settings

PROXY_SECRET_HEADER = 'HTTP_X_PROXY_SECRET'
CLIENT_IP_HEADER = 'HTTP_X_CLIENT_IP'
COOKIE_MODE_HEADER = 'HTTP_X_AUTH_MODE'  # "cookie": browser login, keep refresh out of the body


def from_trusted_proxy(request):
    secret = getattr(settings, 'AUTH_PROXY_SECRET', '')
    sent = request.META.get(PROXY_SECRET_HEADER, '')
    return bool(secret) and bool(sent) and compare_digest(sent, secret)


def proxy_required():
    return bool(getattr(settings, 'AUTH_PROXY_REQUIRED', False))


def trusted_client_ip(request):
    """The real user IP when the request came through our proxy, else None."""
    if not from_trusted_proxy(request):
        return None
    ip = request.META.get(CLIENT_IP_HEADER, '').strip()
    return ip or None


def wants_cookie_mode(request):
    return request.META.get(COOKIE_MODE_HEADER, '').lower() == 'cookie'


def origin_allowed(request):
    """CSRF guard for cookie-authenticated calls: the browser's Origin must be ours."""
    origin = request.META.get('HTTP_ORIGIN', '')
    if not origin:
        return False
    allowed = set(getattr(settings, 'CORS_ALLOWED_ORIGINS', [])) | set(getattr(settings, 'CSRF_TRUSTED_ORIGINS', []))
    if origin in allowed:
        return True
    return any(re.match(pattern, origin) for pattern in getattr(settings, 'CORS_ALLOWED_ORIGIN_REGEXES', []))


def read_refresh_cookie(request):
    return request.COOKIES.get(settings.REFRESH_COOKIE_NAME, '')


def set_refresh_cookie(response, refresh_token):
    lifetime = settings.SIMPLE_JWT['REFRESH_TOKEN_LIFETIME']
    response.set_cookie(
        settings.REFRESH_COOKIE_NAME,
        refresh_token,
        max_age=int(lifetime.total_seconds()),
        path=settings.REFRESH_COOKIE_PATH,
        secure=settings.REFRESH_COOKIE_SECURE,
        httponly=True,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )


def clear_refresh_cookie(response):
    response.delete_cookie(
        settings.REFRESH_COOKIE_NAME,
        path=settings.REFRESH_COOKIE_PATH,
        samesite=settings.REFRESH_COOKIE_SAMESITE,
    )
