"""GET /api/media/face/<student_pk>/?t=<signed token> - serve a private face photo."""
from django.http import Http404, HttpResponse
from django.shortcuts import get_object_or_404
from rest_framework import permissions
from rest_framework.views import APIView

from core.models import Student
from attendance_fr.api.views.auth import _PerIPRateThrottle
from attendance_fr.face_photos import face_photo_file, read_face_photo_bytes, verify_face_photo_token


class FacePhotoRateThrottle(_PerIPRateThrottle):
    scope = 'face_photo'


class FacePhotoAPIView(APIView):
    """
    No JWT needed (an <img> cannot send one): the signed, expiring token in the URL is the
    authorization, and it is only issued to users allowed to see this photo.
    Invalid, expired, or foreign tokens all get the same 404.
    """
    authentication_classes = []
    permission_classes = [permissions.AllowAny]
    throttle_classes = [FacePhotoRateThrottle]

    def get(self, request, student_pk):
        student = get_object_or_404(Student, pk=student_pk)
        if not face_photo_file(student) or not verify_face_photo_token(student, request.query_params.get('t')):
            raise Http404
        data = read_face_photo_bytes(student)
        if data is None:
            raise Http404
        response = HttpResponse(data, content_type='image/jpeg')
        # Biometric data: never keep it in shared/browser caches (lab computers).
        response['Cache-Control'] = 'private, no-store, max-age=0'
        response['Pragma'] = 'no-cache'
        response['Referrer-Policy'] = 'no-referrer'
        response['X-Content-Type-Options'] = 'nosniff'
        return response
