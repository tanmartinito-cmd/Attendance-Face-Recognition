"""JWT authentication that honours server-side revocation (logout, password change)."""
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken


class RevocationAwareJWTAuthentication(JWTAuthentication):
    """
    Standard simplejwt auth, but rejects tokens revoked at logout and tokens issued before
    the user's last password change ("sign out everywhere").

    It also enforces the required first face enrollment: a student without a face can only
    reach the endpoints needed to enroll it (the screen cannot be skipped by calling the
    API directly).
    """

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is not None:
            from attendance_fr.api.services.registration import face_gate_blocks
            if face_gate_blocks(result[0], request.path):
                raise PermissionDenied({
                    'detail': 'Enroll your face first to use AttendFR.',
                    'code': 'face_enrollment_required',
                })
        return result

    def get_validated_token(self, raw_token):
        token = super().get_validated_token(raw_token)
        from attendance_fr.api.services.auth import TokenRevocation
        if TokenRevocation.is_revoked(token.get('jti')):
            raise InvalidToken({'detail': 'Token has been revoked.', 'code': 'token_revoked'})
        return token

    def get_user(self, validated_token):
        user = super().get_user(validated_token)
        from attendance_fr.api.services.auth import TokenRevocation
        if TokenRevocation.issued_before_cutoff(user.pk, validated_token.get('iat')):
            raise InvalidToken({'detail': 'Your password was changed. Please sign in again.',
                                'code': 'token_revoked'})
        return user
