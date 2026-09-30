"""
Courses Views
Handles the Course module: listing, creating, updating, and deleting degree
Courses that belong to an academic Program. Split out from classes.py so
Course management is its own module, independent of Sections/Subjects/Schedules.
"""
from rest_framework.response import Response
from rest_framework import status
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateDestroyAPIView

from core.models import Course
from attendance_fr.api.serializers.courses import CourseSerializer
from attendance_fr.permissions import IsAdminOrReadOnly


class CourseListCreateAPIView(ListCreateAPIView):
    """GET/POST /api/courses/ - List and create degree courses under Programs."""
    serializer_class = CourseSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = Course.objects.select_related('program').order_by('program__code', 'code')
        program_id = self.request.query_params.get('program_id') or self.request.query_params.get('program')
        if program_id:
            qs = qs.filter(program_id=program_id)
        return qs


class CourseDetailAPIView(RetrieveUpdateDestroyAPIView):
    """GET/PATCH/DELETE /api/courses/<pk>/ - Retrieve, update, or delete a single Course."""
    queryset = Course.objects.select_related('program')
    serializer_class = CourseSerializer
    permission_classes = [IsAdminOrReadOnly]

    def destroy(self, request, *args, **kwargs):
        course = self.get_object()
        if course.section_templates.exists() or course.subjects.exists() or course.students.exists():
            return Response(
                {'error': 'This Course cannot be deleted while it is assigned to Sections, Subjects, Students, or catalog records.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)
