"""
Auth & User Profile Views
Handles JWT login/refresh (throttled + lockout), GET /api/auth/me/ and PATCH /api/auth/me/.
"""
import math

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import permissions, status
from rest_framework.exceptions import AuthenticationFailed
from rest_framework.throttling import SimpleRateThrottle
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from attendance_fr.api.serializers.auth import (
    CurrentUserProfileSerializer,
    UserProfileUpdateSerializer,
)
from attendance_fr.api.services.auth import AuthService, LoginLockout, TokenRevocation
from attendance_fr.api.services.auth_proxy import (
    clear_refresh_cookie,
    from_trusted_proxy,
    origin_allowed,
    proxy_required,
    read_refresh_cookie,
    set_refresh_cookie,
    trusted_client_ip,
    wants_cookie_mode,
)


class _PerIPRateThrottle(SimpleRateThrottle):
    """Rate limit by client IP, whether or not the request carries credentials."""

    def get_ident(self, request):
        # Through our Cloudflare proxy every request comes from a Cloudflare IP; the real
        # user IP is forwarded in X-Client-IP and trusted only with the proxy secret.
        return trusted_client_ip(request) or super().get_ident(request)

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


def _proxy_denied(request):
    """When the proxy is required, token endpoints only answer requests that came through it."""
    if proxy_required() and not from_trusted_proxy(request):
        return Response({'detail': 'Sign in through the AttendFR web app.'}, status=status.HTTP_403_FORBIDDEN)
    return None


def _origin_denied():
    return Response({'detail': 'Request origin not allowed.'}, status=status.HTTP_403_FORBIDDEN)


class LoginRateThrottle(_PerIPRateThrottle):
    scope = 'login'


class TokenRefreshRateThrottle(_PerIPRateThrottle):
    scope = 'token_refresh'


def _lockout_response(seconds, account=False):
    minutes = max(1, math.ceil(seconds / 60))
    if account:
        hours = max(1, math.ceil(seconds / 3600))
        detail = (f'This account is locked after too many failed login attempts. '
                  f'Try again in {hours} hour(s) or ask an administrator to unlock it.')
    else:
        detail = f'Too many failed login attempts. Please try again in {minutes} minute(s).'
    return Response(
        {
            'detail': detail,
            'locked': True,
            'retry_after': seconds,
        },
        status=status.HTTP_429_TOO_MANY_REQUESTS,
        headers={'Retry-After': str(seconds)},
    )


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """POST /api/token/ - JWT login with per-IP rate limit and username+IP lockout."""
    throttle_classes = [LoginRateThrottle]

    def post(self, request, *args, **kwargs):
        denied = _proxy_denied(request)
        if denied:
            return denied
        username = str(request.data.get('username', '') or '')
        ip = LoginRateThrottle().get_ident(request)

        # Account-wide lock (too many failures from anywhere) is checked first.
        account_remaining = LoginLockout.account_seconds_remaining(username)
        if account_remaining:
            return _lockout_response(account_remaining, account=True)
        remaining = LoginLockout.seconds_remaining(username, ip)
        if remaining:
            return _lockout_response(remaining)

        try:
            response = super().post(request, *args, **kwargs)
        except AuthenticationFailed:
            account_locked_for = LoginLockout.register_account_failure(username)
            locked_for = LoginLockout.register_failure(username, ip)
            if account_locked_for:
                return _lockout_response(account_locked_for, account=True)
            if locked_for:
                return _lockout_response(locked_for)
            raise

        if response.status_code == status.HTTP_200_OK:
            LoginLockout.reset(username, ip)
            # Browser login: the refresh token goes into an httpOnly cookie, never the body.
            if wants_cookie_mode(request) and 'refresh' in response.data:
                refresh = response.data.pop('refresh')
                set_refresh_cookie(response, refresh)
        return response


class SingleUseTokenRefreshSerializer(TokenRefreshSerializer):
    """
    Refresh tokens are single-use: the presented token is revoked atomically before a
    new pair is issued, so a stolen or replayed refresh token stops working, and a
    token revoked at logout can never mint new access tokens.
    """

    def validate(self, attrs):
        try:
            refresh = RefreshToken(attrs['refresh'])
        except TokenError as exc:
            raise InvalidToken(exc.args[0]) from exc

        if not TokenRevocation.revoke(refresh):
            raise InvalidToken({'detail': 'Refresh token has already been used or revoked.',
                                'code': 'token_revoked'})
        return super().validate(attrs)


class ThrottledTokenRefreshView(TokenRefreshView):
    """
    POST /api/token/refresh/ - per-IP rate limited, single-use refresh tokens.
    Browser: no body; the refresh token comes from the httpOnly cookie and the rotated one
    goes back into the cookie (a token read from the cookie is NEVER returned in the body,
    so a script can't use this endpoint to extract it). API clients may still send
    {"refresh": "..."} and get both tokens in the body.
    """
    throttle_classes = [TokenRefreshRateThrottle]
    serializer_class = SingleUseTokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        denied = _proxy_denied(request)
        if denied:
            return denied
        body_token = request.data.get('refresh') if hasattr(request.data, 'get') else None
        cookie_token = read_refresh_cookie(request)
        from_cookie = not body_token and bool(cookie_token)
        if from_cookie and not origin_allowed(request):
            return _origin_denied()
        if not body_token and not cookie_token:
            return Response({'detail': 'No active session.', 'code': 'no_session'},
                            status=status.HTTP_401_UNAUTHORIZED)

        serializer = self.get_serializer(data={'refresh': body_token or cookie_token})
        try:
            serializer.is_valid(raise_exception=True)
        except (TokenError, InvalidToken) as exc:
            if not from_cookie:
                raise InvalidToken(exc.args[0]) from exc
            response = Response({'detail': 'Session expired. Please sign in again.', 'code': 'token_not_valid'},
                                status=status.HTTP_401_UNAUTHORIZED)
            clear_refresh_cookie(response)  # dead cookie: drop it
            return response

        data = dict(serializer.validated_data)
        if from_cookie or wants_cookie_mode(request):
            new_refresh = data.pop('refresh', None)
            response = Response(data, status=status.HTTP_200_OK)
            if new_refresh:
                set_refresh_cookie(response, new_refresh)
            return response
        return Response(data, status=status.HTTP_200_OK)


class LogoutAPIView(APIView):
    """
    POST /api/auth/logout/ {refresh} - revoke the refresh token and the current access token.
    Works even when the access token has already expired (no authentication required);
    only tokens with a valid signature can be revoked. Always answers 200 (idempotent).
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [TokenRefreshRateThrottle]

    def post(self, request):
        denied = _proxy_denied(request)
        if denied:
            return denied
        revoked = 0
        raw_refresh = request.data.get('refresh') if hasattr(request.data, 'get') else None
        if not raw_refresh and origin_allowed(request):
            raw_refresh = read_refresh_cookie(request)  # browser session (cookie)
        if raw_refresh:
            try:
                TokenRevocation.revoke(RefreshToken(raw_refresh))
                revoked += 1
            except TokenError:
                pass

        header = request.META.get('HTTP_AUTHORIZATION', '')
        if header.startswith('Bearer '):
            try:
                TokenRevocation.revoke(AccessToken(header.split(' ', 1)[1].strip()))
                revoked += 1
            except TokenError:
                pass

        TokenRevocation.purge_expired()
        response = Response({'success': True, 'revoked': revoked})
        clear_refresh_cookie(response)
        return response


class CurrentUserAPIView(APIView):
    """GET /api/auth/me/ - Get profile. PATCH /api/auth/me/ - Update own profile."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        return Response(CurrentUserProfileSerializer(request.user).data)

    def patch(self, request):
        serializer = UserProfileUpdateSerializer(data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = AuthService.update_profile(request.user, serializer.validated_data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CurrentUserProfileSerializer(user).data)
