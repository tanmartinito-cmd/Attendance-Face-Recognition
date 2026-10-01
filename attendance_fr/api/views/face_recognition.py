"""
Face Recognition Views
Handles face recognition during attendance and face enrollment.
"""
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.throttling import ScopedRateThrottle
from django.utils import timezone

from core.models import Student
from attendance_fr.face_photos import face_photo_link
from face_app.utils import FR_AVAILABLE, InvalidImageError
from attendance_fr.api.services.attendance import AttendanceService
from attendance_fr.permissions import IsAdminRole, IsSessionManager, can_manage_session
from attendance_fr.api.services.face_recognition import (
    FaceEnrollConflict,
    FaceEnrollService,
    FaceRecognitionService,
)


class IsAdminOrStudentWithoutFace(IsAdminRole):
    message = 'Only an administrator, or a student enrolling their own face, may do this.'

    def has_permission(self, request, view):
        if super().has_permission(request, view):
            return True
        from attendance_fr.api.services.registration import face_enrollment_required
        return face_enrollment_required(request.user)


class FaceRecognizeAPIView(APIView):
    """POST /api/face/recognize/ - Process camera frame, recognize faces, mark attendance."""
    permission_classes = [IsSessionManager]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_recognize'

    def post(self, request):
        session_id = request.data.get('session_id')
        frame_b64 = request.data.get('frame')

        if not session_id or not frame_b64:
            return Response({'error': 'session_id and frame are required'}, status=status.HTTP_400_BAD_REQUEST)

        if not FR_AVAILABLE:
            return Response({'error': 'Face recognition engine unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        # Authorize BEFORE revealing anything about the session: a session that does not
        # exist and one the instructor does not manage get the same "not found" answer.
        session = FaceRecognitionService.get_session(session_id)
        if not session or not can_manage_session(request.user, session):
            return Response(
                {'success': False, 'error': f'Attendance session #{session_id} not found', 'session_closed': True},
                status=status.HTTP_404_NOT_FOUND,
            )

        if session.status != 'open':
            return Response(
                {'success': False, 'error': f'Attendance session #{session_id} is closed', 'session_closed': True},
                status=status.HTTP_409_CONFLICT,
            )

        error = AttendanceService.validate_session_time_window(session)
        if error:
            return Response(
                {'success': False, 'error': error, 'attendance_unavailable': True},
                status=status.HTTP_403_FORBIDDEN,
            )
        try:
            result = FaceRecognitionService.recognize_faces_for_session(session, frame_b64)
        except InvalidImageError as e:
            return Response({'success': False, 'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(result)


class FaceEnrollCheckAPIView(APIView):
    """
    POST /api/face/enroll/check/ - Check one live frame during enrollment (Admin only).
    Body: {"frame": "<base64>"}. Returns {"ok": true} or {"ok": false, "message": "Keep your eyes open."}.
    Nothing is saved; the final /api/face/enroll/ call re-validates all frames.
    Also open to a student who still has to enroll their own face (required first step).
    """
    permission_classes = [IsAdminOrStudentWithoutFace]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_enroll_check'

    def post(self, request):
        frame = request.data.get('frame')
        if not isinstance(frame, str) or not frame:
            return Response({'error': 'frame is required'}, status=status.HTTP_400_BAD_REQUEST)
        if not FR_AVAILABLE:
            return Response({'error': 'Face recognition engine unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)
        try:
            reason = FaceEnrollService.check_frame(frame)
        except ValueError as e:  # unreadable image
            return Response({'ok': False, 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({'ok': reason is None, 'message': reason or ''})


class FaceEnrollAPIView(APIView):
    """POST /api/face/enroll/ - Enroll student face vector from camera frame (Admin only)."""
    permission_classes = [IsAdminRole]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_enroll'

    def post(self, request):
        student_id = request.data.get('student_id')
        # 3-5 photos in "frames"; a single legacy "frame" is still accepted but will be
        # rejected by the minimum photo count unless FACE_ENROLL_MIN_SAMPLES is 1.
        frames = request.data.get('frames')
        if not frames and request.data.get('frame'):
            frames = [request.data.get('frame')]

        if not student_id or not frames:
            return Response({'error': 'student_id and frames are required'}, status=status.HTTP_400_BAD_REQUEST)
        if not isinstance(frames, list) or not all(isinstance(f, str) for f in frames):
            return Response({'error': 'frames must be a list of base64 images'}, status=status.HTTP_400_BAD_REQUEST)
        if not FR_AVAILABLE:
            return Response({'error': 'Face recognition engine unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        student = get_object_or_404(Student, pk=student_id)
        replace = request.data.get('replace') in (True, 'true', 'True', '1', 1)

        try:
            message = FaceEnrollService.enroll_student_face(student, frames, replace=replace)
        except FaceEnrollConflict as e:
            return Response({
                'success': False,
                'code': e.code,
                'message': str(e),
                'conflict_student': e.conflict_student,
            }, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response({
            'success': True,
            'message': message,
            'face_image': face_photo_link(student, user=request.user),
        })


class SelfFaceEnrollAPIView(APIView):
    """
    POST /api/face/enroll/self/ {"frames": [...]} - a student enrolls their OWN face, once.
    Same quality, liveness and duplicate checks as admin enrollment. Changing the face later
    is done by an administrator, so a student cannot swap faces by themselves.
    """
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'face_enroll'

    def post(self, request):
        user = request.user
        student = getattr(user, 'student', None) if user.role == 'student' else None
        if student is None:
            return Response({'success': False, 'message': 'Only students enroll their own face.'},
                            status=status.HTTP_403_FORBIDDEN)
        if student.is_face_enrolled:
            return Response({'success': False, 'code': 'already_enrolled',
                             'message': 'Your face is already enrolled. Ask an administrator to change it.'},
                            status=status.HTTP_409_CONFLICT)
        frames = request.data.get('frames')
        if not isinstance(frames, list) or not frames or not all(isinstance(f, str) for f in frames):
            return Response({'success': False, 'message': 'frames must be a list of base64 images'},
                            status=status.HTTP_400_BAD_REQUEST)
        if not FR_AVAILABLE:
            return Response({'error': 'Face recognition engine unavailable'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        try:
            message = FaceEnrollService.enroll_student_face(student, frames, replace=False)
        except FaceEnrollConflict as e:
            # Never reveal another student's name or ID to a student.
            text = ('This face is already enrolled to another account. Please contact the administrator.'
                    if e.code == 'duplicate_face' else 'Your face could not be enrolled. Please contact the administrator.')
            return Response({'success': False, 'code': e.code, 'message': text}, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({'success': False, 'message': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        from attendance_fr.api.services.registration import forget_face_status
        forget_face_status(user.pk)
        return Response({'success': True, 'message': message, 'face_image': face_photo_link(student, user=user)})
