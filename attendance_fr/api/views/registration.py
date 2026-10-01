"""
Public self-registration and the administrator's approval queue.

    GET  /api/register/options/                 programs, courses, Turnstile site key (public)
    POST /api/register/                         create a pending account (public, bot-checked)
    GET  /api/registrations/?status=pending     admin: list + counts
    POST /api/registrations/<user_id>/approve/  admin
    POST /api/registrations/<user_id>/reject/   admin {reason}
"""
from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from attendance_fr.api.services.registration import RegistrationError, RegistrationService, verify_turnstile
from attendance_fr.api.views.auth import _PerIPRateThrottle
from attendance_fr.permissions import IsAdminRole


class RegisterRateThrottle(_PerIPRateThrottle):
    scope = 'register'


class RegisterOptionsAPIView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def get(self, request):
        return Response(RegistrationService.options())


class RegisterAPIView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [RegisterRateThrottle]

    def post(self, request):
        data = request.data if hasattr(request.data, 'get') else {}
        ip = RegisterRateThrottle().get_ident(request)
        if not verify_turnstile(data.get('turnstile_token'), ip):
            return Response({'error': 'Please complete the "Verify you are human" check and try again.',
                             'field': 'turnstile'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            RegistrationService.register(data)
        except RegistrationError as exc:
            return Response({'error': str(exc), 'field': exc.field}, status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'success': True,
            'detail': 'Registration submitted. You can sign in once an administrator approves it.',
        }, status=status.HTTP_201_CREATED)


class RegistrationListAPIView(APIView):
    permission_classes = [IsAdminRole]

    def get(self, request):
        wanted = request.query_params.get('status', 'pending')
        regs = RegistrationService.queryset(None if wanted == 'all' else wanted)[:200]
        return Response({
            'results': [RegistrationService.serialize(reg) for reg in regs],
            'counts': RegistrationService.counts(),
        })


class _RegistrationActionView(APIView):
    permission_classes = [IsAdminRole]

    def _respond(self, action):
        try:
            reg = action()
        except RegistrationError as exc:
            return Response({'error': str(exc), 'field': exc.field}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'registration': RegistrationService.serialize(reg), 'counts': RegistrationService.counts()})


class RegistrationApproveAPIView(_RegistrationActionView):
    def post(self, request, user_id):
        return self._respond(lambda: RegistrationService.approve(user_id, request.user))


class RegistrationRejectAPIView(_RegistrationActionView):
    def post(self, request, user_id):
        reason = request.data.get('reason') if hasattr(request.data, 'get') else ''
        return self._respond(lambda: RegistrationService.reject(user_id, request.user, reason))
