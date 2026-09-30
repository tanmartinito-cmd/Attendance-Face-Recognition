"""
Programs, section templates (API: program-sections), subjects, class sections, enrollments and schedules.
Course management lives in courses.py.
"""
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.generics import ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.response import Response
from rest_framework.views import APIView

from attendance_fr.api.serializers.classes import (
    ProgramSectionSerializer,
    ProgramSerializer,
    ScheduleSerializer,
    SectionEnrollmentCreateSerializer,
    SectionSerializer,
    StudentSectionSerializer,
    SubjectSerializer,
)
from attendance_fr.api.services.classes import ClassService
from attendance_fr.api.services.response_cache import ResponseCache, request_scope
from attendance_fr.permissions import IsAdminOrReadOnly, IsAdminRole
from core.models import ClassSchedule, ClassSection, Enrollment, Program, SectionTemplate, Subject

SUBJECT_RELATED = ('course__program', 'instructor__user__profile', 'section__template')
SECTION_RELATED = ('template__course__program', 'term', 'instructor__user__profile')
SCHEDULE_RELATED = (
    'section__template__course__program', 'section__term', 'section__instructor__user__profile',
    'subject__course__program', 'subject__instructor__user__profile', 'subject__section__template',
)


def _param(request, *names):
    for name in names:
        value = request.query_params.get(name)
        if value:
            return value
    return None


# ── Programs ─────────────────────────────────────────────────────────────────

class ProgramListCreateAPIView(ListCreateAPIView):
    queryset = Program.objects.all().order_by('code')
    serializer_class = ProgramSerializer
    permission_classes = [IsAdminOrReadOnly]


class ProgramDetailAPIView(RetrieveUpdateDestroyAPIView):
    queryset = Program.objects.all()
    serializer_class = ProgramSerializer
    permission_classes = [IsAdminOrReadOnly]


# ── Section templates ─────────────────────────────────────────────────────────

class ProgramSectionListCreateAPIView(ListCreateAPIView):
    """GET/POST /api/program-sections/ - reusable section definitions."""
    serializer_class = ProgramSectionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = SectionTemplate.objects.select_related('course__program')
        request = self.request
        program_id = _param(request, 'program_id', 'program')
        course_id = _param(request, 'course_id')
        course_code = _param(request, 'course')
        year_level = _param(request, 'year_level')
        if program_id:
            qs = qs.filter(course__program_id=program_id)
        if course_id:
            qs = qs.filter(course_id=course_id)
        elif course_code:
            qs = qs.filter(course__code__iexact=course_code)
        if year_level:
            qs = qs.filter(year_level=year_level)
        return qs


class ProgramSectionDetailAPIView(RetrieveUpdateDestroyAPIView):
    queryset = SectionTemplate.objects.select_related('course__program')
    serializer_class = ProgramSectionSerializer
    permission_classes = [IsAdminOrReadOnly]


# ── Subjects ──────────────────────────────────────────────────────────────────

class SubjectListCreateAPIView(ListCreateAPIView):
    serializer_class = SubjectSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        request = self.request
        qs = Subject.objects.select_related(*SUBJECT_RELATED)
        program_id = _param(request, 'program_id', 'program')
        course_id = _param(request, 'course_id', 'course')
        section_id = _param(request, 'section_id', 'section')
        if program_id:
            qs = qs.filter(course__program_id=program_id)
        if course_id:
            qs = qs.filter(course_id=course_id)
        if section_id:
            qs = qs.filter(section_id=section_id)
        user = request.user
        if user.role == 'instructor':
            qs = qs.filter(instructor=getattr(user, 'instructor', None)) if hasattr(user, 'instructor') else qs.none()
        return qs.order_by('code')


class SubjectDetailAPIView(RetrieveUpdateDestroyAPIView):
    queryset = Subject.objects.select_related(*SUBJECT_RELATED)
    serializer_class = SubjectSerializer
    permission_classes = [IsAdminOrReadOnly]


# ── Class sections ────────────────────────────────────────────────────────────

class SectionListCreateAPIView(ListCreateAPIView):
    serializer_class = SectionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def list(self, request, *args, **kwargs):
        data = ResponseCache.get_or_set(
            'academic', request_scope(request, endpoint='section-list'),
            lambda: self.get_serializer(self.filter_queryset(self.get_queryset()), many=True).data,
        )
        return Response(data)

    def get_queryset(self):
        request = self.request
        qs = ClassSection.objects.select_related(*SECTION_RELATED)
        program_id = _param(request, 'program_id', 'program')
        course_id = _param(request, 'course_id')
        course_code = _param(request, 'course')
        section_id = _param(request, 'section_id')
        subject_id = _param(request, 'subject_id')
        year_level = _param(request, 'year_level')
        if program_id:
            qs = qs.filter(template__course__program_id=program_id)
        if course_id:
            qs = qs.filter(template__course_id=course_id)
        elif course_code:
            qs = qs.filter(template__course__code__iexact=course_code)
        if section_id:
            qs = qs.filter(pk=section_id)
        if subject_id:
            qs = qs.filter(subjects__id=subject_id).distinct()
        if year_level:
            qs = qs.filter(template__year_level=year_level)

        subjects = Subject.objects.select_related(*SUBJECT_RELATED)
        if subject_id:
            subjects = subjects.filter(pk=subject_id)
        qs = qs.prefetch_related(Prefetch('subjects', queryset=subjects), 'schedules__days')
        return ClassService.filter_sections_for_user(qs, request.user).order_by('template__name')


class SectionDetailAPIView(RetrieveUpdateDestroyAPIView):
    serializer_class = SectionSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = ClassSection.objects.select_related(*SECTION_RELATED).prefetch_related('subjects', 'schedules__days')
        return ClassService.filter_sections_for_user(qs, self.request.user)


# ── Enrollments ───────────────────────────────────────────────────────────────

class SectionEnrollmentListCreateAPIView(APIView):
    """GET/POST /api/sections/<pk>/enrollments/"""
    permission_classes = [IsAdminOrReadOnly]

    def get(self, request, pk):
        section = get_object_or_404(ClassSection, pk=pk)
        if not ClassService.user_can_access_section(request.user, section):
            return Response({'error': 'You are not enrolled in or assigned to this section.'}, status=status.HTTP_403_FORBIDDEN)
        enrollments = Enrollment.objects.filter(section=section)
        subject_id = _param(request, 'subject_id', 'subject')
        if subject_id:
            enrollments = enrollments.filter(Q(subject__isnull=True) | Q(subject_id=subject_id))
        enrollments = enrollments.select_related(
            'student__user__profile', 'student__course__program', 'student__biometric', 'subject', 'section',
        ).prefetch_related('student__user__addresses', 'student__user__languages').order_by(
            'student__user__profile__last_name', 'student__user__profile__first_name',
        )
        return Response(StudentSectionSerializer(enrollments, many=True, context={'request': request}).data)

    def post(self, request, pk):
        if request.user.role != 'admin':
            return Response({'error': 'Only administrators can enroll students.'}, status=status.HTTP_403_FORBIDDEN)
        serializer = SectionEnrollmentCreateSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)
        enrollment, created = ClassService.enroll_student(
            pk, serializer.validated_data['student_id'], serializer.validated_data.get('subject_id'),
        )
        return Response(
            StudentSectionSerializer(enrollment, context={'request': request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class SectionEnrollmentDestroyAPIView(APIView):
    """DELETE /api/sections/<pk>/enrollments/<enrollment_pk>/"""
    permission_classes = [IsAdminRole]

    def delete(self, request, pk, enrollment_pk):
        ClassService.unenroll_student(pk, enrollment_pk)
        return Response({'success': True, 'message': 'Student removed from section.'}, status=status.HTTP_200_OK)


# ── Schedules ─────────────────────────────────────────────────────────────────

class ScheduleListCreateAPIView(ListCreateAPIView):
    serializer_class = ScheduleSerializer
    permission_classes = [IsAdminOrReadOnly]

    def list(self, request, *args, **kwargs):
        data = ResponseCache.get_or_set(
            'academic', request_scope(request, endpoint='schedule-list'),
            lambda: self.get_serializer(self.filter_queryset(self.get_queryset()), many=True).data,
        )
        return Response(data)

    def get_queryset(self):
        qs = ClassSchedule.objects.select_related(*SCHEDULE_RELATED).prefetch_related('days')
        section_id = _param(self.request, 'section_id')
        if section_id:
            qs = qs.filter(section_id=section_id)
        return ClassService.filter_schedules_for_user(qs, self.request.user).order_by('start_time', 'pk')

    def perform_create(self, serializer):
        ClassService.validate_and_save_schedule(serializer)


class ScheduleDetailAPIView(RetrieveUpdateDestroyAPIView):
    serializer_class = ScheduleSerializer
    permission_classes = [IsAdminOrReadOnly]

    def get_queryset(self):
        qs = ClassSchedule.objects.select_related(*SCHEDULE_RELATED).prefetch_related('days')
        return ClassService.filter_schedules_for_user(qs, self.request.user)

    def perform_update(self, serializer):
        ClassService.validate_and_save_schedule(serializer, is_update=True)
