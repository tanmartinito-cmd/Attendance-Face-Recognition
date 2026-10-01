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
from rest_framework_simplejwt.serializers import TokenObtainSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from attendance_fr.api.serializers.auth import (
    CurrentUserProfileSerializer,
    UserProfileUpdateSerializer,
)
from attendance_fr.api.services.auth import AuthService, LoginLockout, TokenRevocation
from attendance_fr.api.services.two_factor import TwoFactorError, TwoFactorService
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

        serializer = self.get_serializer(data=request.data)
        try:
            serializer.is_valid(raise_exception=True)
        except AuthenticationFailed as exc:
            # Authentication failed (wrong password or account not found)
            return _register_login_failure(username, ip, exc=exc)
        except TokenError as exc:
            raise InvalidToken(exc.args[0]) from exc

        user = serializer.user
        if TwoFactorService.is_enabled(user):
            # Password is right, but the account uses two-step sign-in: no tokens yet.
            # The lockout counters are only reset once the code is right too.
            return Response({
                'two_factor_required': True,
                'challenge': TwoFactorService.make_challenge(user),
                'detail': 'Enter the 6-digit code from your authenticator app.',
            }, status=status.HTTP_200_OK)

        LoginLockout.reset(username, ip)
        return _token_response(request, serializer.validated_data)


def _register_login_failure(username, ip, detail=None, exc=None):
    account_locked_for = LoginLockout.register_account_failure(username)
    locked_for = LoginLockout.register_failure(username, ip)
    if account_locked_for:
        return _lockout_response(account_locked_for, account=True)
    if locked_for:
        return _lockout_response(locked_for)
    if detail:
        return Response({'detail': detail, 'code': 'invalid_code'}, status=status.HTTP_401_UNAUTHORIZED)
    raise exc or AuthenticationFailed()


def _token_response(request, tokens):
    """200 with the token pair; browser logins get the refresh token as an httpOnly cookie."""
    data = dict(tokens)
    response = Response(data, status=status.HTTP_200_OK)
    if wants_cookie_mode(request) and 'refresh' in data:
        set_refresh_cookie(response, response.data.pop('refresh'))
    return response


def _issue_tokens(user):
    from django.contrib.auth.models import update_last_login
    from rest_framework_simplejwt.settings import api_settings as jwt_settings
    refresh = RefreshToken.for_user(user)
    if jwt_settings.UPDATE_LAST_LOGIN:
        update_last_login(None, user)
    return {'refresh': str(refresh), 'access': str(refresh.access_token)}


class TwoStepTokenObtainSerializer(TokenObtainSerializer):
    """Checks the password; issues tokens only when the account has no two-step sign-in."""
    token_class = RefreshToken

    def validate(self, attrs):
        super().validate(attrs)  # authenticates -> self.user, or raises AuthenticationFailed
        if TwoFactorService.is_enabled(self.user):
            return {}
        return _issue_tokens(self.user)


ThrottledTokenObtainPairView.serializer_class = TwoStepTokenObtainSerializer


class TwoFactorLoginView(APIView):
    """
    POST /api/token/2fa/ {challenge, code} - second sign-in step (code or backup code).
    Same proxy, rate limit and lockout rules as the password step.
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        denied = _proxy_denied(request)
        if denied:
            return denied
        data = request.data if hasattr(request.data, 'get') else {}
        user = TwoFactorService.read_challenge(data.get('challenge'))
        if user is None:
            return Response({'detail': 'This sign-in expired. Please enter your password again.',
                             'code': 'challenge_expired'}, status=status.HTTP_401_UNAUTHORIZED)
        username = user.username
        ip = LoginRateThrottle().get_ident(request)
        remaining = LoginLockout.account_seconds_remaining(username) or LoginLockout.seconds_remaining(username, ip)
        if remaining:
            return _lockout_response(remaining)

        if not TwoFactorService.verify(user, data.get('code')):
            return _register_login_failure(username, ip, detail='That code is not correct. Try the newest code.')

        LoginLockout.reset(username, ip)
        return _token_response(request, _issue_tokens(user))


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

        from rest_framework_simplejwt.settings import api_settings as jwt_settings
        if TokenRevocation.issued_before_cutoff(refresh.get(jwt_settings.USER_ID_CLAIM), refresh.get('iat')):
            raise InvalidToken({'detail': 'Your password was changed. Please sign in again.',
                                'code': 'token_revoked'})
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


class PasswordChangeRateThrottle(SimpleRateThrottle):
    """Per signed-in user: limits guessing the current password with a stolen session."""
    scope = 'password_change'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': request.user.pk}


class ChangePasswordAPIView(APIView):
    """
    POST /api/auth/password/ {current_password, new_password, confirm_password}
    Changes the signed-in user's own password (strict policy) and signs out every device,
    including this one: the user signs in again with the new password.
    """
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [PasswordChangeRateThrottle]

    def post(self, request):
        data = request.data if hasattr(request.data, 'get') else {}
        try:
            AuthService.change_password(
                request.user,
                str(data.get('current_password') or ''),
                str(data.get('new_password') or ''),
                str(data.get('confirm_password') or ''),
            )
        except ValueError as exc:
            field, message = exc.args if len(exc.args) == 2 else ('new_password', str(exc))
            return Response({'error': message, 'field': field}, status=status.HTTP_400_BAD_REQUEST)
        response = Response({
            'success': True,
            'detail': 'Password changed. Please sign in again with your new password.',
        })
        clear_refresh_cookie(response)
        return response


class TwoFactorRateThrottle(PasswordChangeRateThrottle):
    scope = 'two_factor'


class _TwoFactorBase(APIView):
    permission_classes = [permissions.IsAuthenticated]
    throttle_classes = [TwoFactorRateThrottle]

    @staticmethod
    def _error(exc):
        return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def _body(request):
        return request.data if hasattr(request.data, 'get') else {}


class TwoFactorStatusAPIView(_TwoFactorBase):
    """GET /api/auth/2fa/ - is two-step sign-in on, and how many backup codes are left."""
    throttle_classes = []

    def get(self, request):
        return Response(TwoFactorService.status(request.user))


class TwoFactorSetupAPIView(_TwoFactorBase):
    """POST /api/auth/2fa/setup/ - new secret + QR code (not active until confirmed)."""

    def post(self, request):
        try:
            data = TwoFactorService.start_setup(request.user)
        except TwoFactorError as exc:
            return self._error(exc)
        response = Response(data)
        response['Cache-Control'] = 'no-store'
        return response


class TwoFactorEnableAPIView(_TwoFactorBase):
    """POST /api/auth/2fa/enable/ {code} - confirm the app works; returns 10 backup codes once."""

    def post(self, request):
        try:
            codes = TwoFactorService.enable(request.user, self._body(request).get('code'))
        except TwoFactorError as exc:
            return self._error(exc)
        response = Response({**TwoFactorService.status(request.user), 'backup_codes': codes})
        response['Cache-Control'] = 'no-store'
        return response


class TwoFactorDisableAPIView(_TwoFactorBase):
    """POST /api/auth/2fa/disable/ {password, code} - turn off (needs both)."""

    def post(self, request):
        body = self._body(request)
        try:
            TwoFactorService.disable(request.user, str(body.get('password') or ''), body.get('code'))
        except TwoFactorError as exc:
            return self._error(exc)
        return Response(TwoFactorService.status(request.user))


class TwoFactorBackupCodesAPIView(_TwoFactorBase):
    """POST /api/auth/2fa/backup-codes/ {code} - replace backup codes (old ones stop working)."""

    def post(self, request):
        try:
            codes = TwoFactorService.regenerate_backup_codes(request.user, self._body(request).get('code'))
        except TwoFactorError as exc:
            return self._error(exc)
        response = Response({**TwoFactorService.status(request.user), 'backup_codes': codes})
        response['Cache-Control'] = 'no-store'
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
