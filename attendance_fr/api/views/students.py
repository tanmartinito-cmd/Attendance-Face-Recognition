"""
Student & User Management Views
Handles CRUD for users, students, and next ID generation.
"""
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

from accounts.models import User
from attendance_fr.permissions import IsAdminRole
from attendance_fr.api.serializers.students import (
    StudentSerializer,
    UserCreateInputSerializer,
    UserUpdateInputSerializer,
)
from attendance_fr.api.serializers.auth import CurrentUserProfileSerializer
from attendance_fr.api.services.students import (
    StudentService,
    UserService,
    get_next_student_id,
)


class NextStudentIdAPIView(APIView):
    """GET /api/students/next-id/ - Returns next auto-incremented FSUU Student ID."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        return Response({'next_student_id': get_next_student_id(), 'prefix': '23100000'})


class UserListCreateAPIView(APIView):
    """GET /api/users/ - List users. POST /api/users/ - Create user (Admin only)."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        from django.db.models import Q
        role = request.query_params.get('role')
        search = request.query_params.get('search')

        qs = User.objects.select_related('profile', 'instructor', 'student__course__program', 'student__biometric').prefetch_related(
            'addresses', 'languages',
        ).order_by('profile__last_name', 'profile__first_name')
        # Self-registrations that are not approved live in the Registrations page only.
        qs = qs.exclude(registration__status__in=['pending', 'rejected'])

        if role:
            qs = qs.filter(role=role)
        if search:
            qs = qs.filter(
                Q(username__icontains=search) |
                Q(profile__first_name__icontains=search) |
                Q(profile__last_name__icontains=search) |
                Q(email__icontains=search) |
                Q(instructor__faculty_id__icontains=search) |
                Q(student__student_id__icontains=search)
            )

        return Response(CurrentUserProfileSerializer(qs[:100], many=True).data)

    def post(self, request):
        if request.user.role != 'admin':
            return Response({'error': 'Admin permissions required'}, status=status.HTTP_403_FORBIDDEN)

        serializer = UserCreateInputSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = UserService.create_user(request.data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CurrentUserProfileSerializer(user).data, status=status.HTTP_201_CREATED)


class UserDetailAPIView(APIView):
    """GET/PATCH/DELETE /api/users/<id>/ - Manage single user (Admin only)."""
    permission_classes = [IsAdminRole]

    def _get_user(self, pk):
        try:
            return User.objects.select_related('profile', 'instructor', 'student__course__program', 'student__biometric').get(pk=pk)
        except User.DoesNotExist:
            return None

    def get(self, request, pk):
        user = self._get_user(pk)
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        return Response(CurrentUserProfileSerializer(user).data)

    def put(self, request, pk):
        return self.patch(request, pk)

    def patch(self, request, pk):
        user = self._get_user(pk)
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = UserUpdateInputSerializer(data=request.data, partial=True)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = UserService.update_user(user, request.data)
        except ValueError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(CurrentUserProfileSerializer(user).data)

    def delete(self, request, pk):
        user = self._get_user(pk)
        if not user:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        if request.user.pk == user.pk:
            return Response(
                {'error': 'You cannot delete your own account.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class StudentListAPIView(APIView):
    """GET /api/students/ - List all registered students with face enrollment status."""
    permission_classes = [IsAdminRole]

    def get(self, request):
        search = request.query_params.get('search')
        qs = StudentService.get_students_queryset(search=search)
        return Response(StudentSerializer(qs[:100], many=True).data)
