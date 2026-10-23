"""
One error format for every API failure.

    {
      "error":  "Readable summary for the user",
      "detail": "Same summary (older clients read this key)",
      "code":   "validation_error" | "schedule_conflict" | "student_schedule_conflict" | "has_attendance" | ...,
      "fields": {"field": ["message", ...]},      # validation errors per field (may be empty)
      "conflicts": [{type, message, schedule_id, section, subject, days, ...}],   # timetable conflicts only
      ...original field keys are kept too, so existing clients keep working
    }

Status codes: 400 invalid input, 409 conflict with existing data (timetable clash, attendance
history, duplicate record), other DRF statuses unchanged.
"""
import logging

from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError
from django.db.models import ProtectedError, RestrictedError
from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler, set_rollback

from attendance_fr.api.services.classes import AttendanceHistoryProtected
from core.services.schedule_service import SchedulingConflict

logger = logging.getLogger(__name__)

NON_FIELD_KEYS = ('detail', 'non_field_errors', '__all__', 'error')
FIELD_LABELS = {
    'course_ref': 'Course', 'program_section': 'Section catalog entry', 'program': 'Program',
    'student_id': 'Student', 'student': 'Student', 'subject_id': 'Subject', 'subject': 'Subject',
    'section': 'Section', 'instructor': 'Instructor', 'day_of_week': 'Day 1', 'day_2': 'Day 2',
    'start_time': 'Start time', 'end_time': 'End time', 'room': 'Room', 'effective_from': 'Effective From',
    'effective_to': 'Effective To', 'school_year': 'School year', 'year_level': 'Year level', 'code': 'Code',
    'name': 'Name', 'units': 'Units', 'semester': 'Semester',
}


def _label(field):
    return FIELD_LABELS.get(field) or field.replace('_', ' ').capitalize()


def _messages(value):
    """Flatten DRF / Django error structures into a list of strings."""
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            out.extend(_messages(item))
        return out
    if isinstance(value, dict):
        out = []
        for item in value.values():
            out.extend(_messages(item))
        return out
    return [str(value)]


def _sentence(text):
    text = text.strip()
    return text if text.endswith(('.', '!', '?')) else f'{text}.'


def _summary(fields, general):
    parts = [_sentence(m) for m in general]
    for field, msgs in fields.items():
        for m in msgs:
            parts.append(_sentence(f'{_label(field)}: {m}'))
    return ' '.join(dict.fromkeys(parts)) or 'The request could not be completed.'


def _split(data):
    """(field errors dict, general messages list) from a DRF / Django error payload."""
    if isinstance(data, dict):
        fields, general = {}, []
        for key, value in data.items():
            msgs = _messages(value)
            if key in NON_FIELD_KEYS:
                general.extend(msgs)
            elif msgs:
                fields[key] = msgs
        return fields, general
    return {}, _messages(data)


def _validation_body(data, code='validation_error'):
    fields, general = _split(data)
    summary = _summary(fields, general)
    body = dict(data) if isinstance(data, dict) else {}
    body.pop('__all__', None)
    body.update({'error': summary, 'detail': summary, 'code': code, 'fields': fields})
    if general:
        body['non_field_errors'] = general
    return body


def api_exception_handler(exc, context):
    if isinstance(exc, SchedulingConflict):
        set_rollback()
        summary = ' '.join(_sentence(c['message']) for c in exc.conflicts)
        body = {
            'error': summary, 'detail': summary, 'code': exc.conflict_code,
            'conflicts': exc.conflicts, 'fields': {}, **exc.extra,
        }
        return Response(body, status=status.HTTP_409_CONFLICT)

    if isinstance(exc, DjangoValidationError):
        set_rollback()
        data = exc.message_dict if hasattr(exc, 'error_dict') else {'non_field_errors': exc.messages}
        return Response(_validation_body(data), status=status.HTTP_400_BAD_REQUEST)

    if isinstance(exc, AttendanceHistoryProtected):
        set_rollback()
        msg = str(exc)
        return Response(
            {'error': msg, 'detail': msg, 'code': 'has_attendance', 'session_count': exc.session_count, 'fields': {}},
            status=status.HTTP_409_CONFLICT,
        )

    if isinstance(exc, (ProtectedError, RestrictedError)):
        set_rollback()
        msg = 'This record is still used by other records and cannot be deleted. Deactivate it instead.'
        return Response({'error': msg, 'detail': msg, 'code': 'protected', 'fields': {}}, status=status.HTTP_409_CONFLICT)

    if isinstance(exc, IntegrityError):
        set_rollback()
        logger.warning('IntegrityError in API: %s', exc)
        msg = 'This change conflicts with an existing record (it may be a duplicate). Refresh the page and try again.'
        return Response({'error': msg, 'detail': msg, 'code': 'integrity_error', 'fields': {}}, status=status.HTTP_409_CONFLICT)

    response = drf_exception_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, DRFValidationError):
        response.data = _validation_body(response.data)
    elif isinstance(response.data, dict) and 'error' not in response.data and 'detail' in response.data:
        response.data['error'] = str(response.data['detail'])
    return response
