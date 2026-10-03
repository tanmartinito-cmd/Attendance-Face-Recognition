"""
Face Service: Handles face encoding, cached section indexing,
vectorized multi-face matching, and bounding box coordinate calculation.
"""
import json
import logging
import time
import numpy as np
from django.core.cache import cache
from django.conf import settings
from core.models import Enrollment
from core.services.attendance_service import AttendanceService
from face_app.utils import (
    detect_and_encode_all_faces,
    batch_compare_faces,
    draw_face_boxes,
    check_face_liveness,
    assess_scan_quality,
    encode_scan_face,
    pick_primary_face,
    scan_face_position,
    _decode_image_to_rgb,
)

logger = logging.getLogger(__name__)


def _lap(timing, name, since):
    """Add the milliseconds since `since` to timing[name]; returns 'now' for the next lap."""
    now = time.perf_counter()
    timing[name] = timing.get(name, 0.0) + (now - since) * 1000.0
    return now


def _log_scan_timing(timing, results):
    """One log line per scanned frame: where the server time went (see FACE_TIMING_LOG)."""
    if not getattr(settings, 'FACE_TIMING_LOG', True):
        return
    first = results[0] if results else {}
    outcome = (
        'matched' if first.get('matched') else
        'verifying' if first.get('verifying') else
        'already_marked' if first.get('already_marked') else
        'liveness_failed' if first.get('liveness_failed') else
        'quality_failed' if first.get('quality_failed') else
        'wrong_section' if first.get('wrong_section') else
        'unknown'
    )
    total = sum(timing.values())
    parts = ' '.join(f'{name}={ms:.0f}' for name, ms in timing.items())
    logger.info('scan timing total=%.0fms (%s) outcome=%s', total, parts, outcome)


SECTION_CACHE_KEY_PREFIX = 'sec_face_embeddings_'
SECTION_CACHE_VERSION_PREFIX = 'sec_face_embeddings_version_'
CONSENSUS_CACHE_PREFIX = 'face_consensus_'
LIVENESS_OK_PREFIX = 'face_liveness_ok_'
CACHE_TIMEOUT = getattr(settings, 'FACE_CACHE_TIMEOUT', 60)
LIVENESS_CACHE_TIMEOUT = 90


class FaceService:
    @staticmethod
    def _version_key(section_id):
        return f"{SECTION_CACHE_VERSION_PREFIX}{section_id}"

    @staticmethod
    def _cache_version(key):
        return cache.get_or_set(key, 1, timeout=None)

    @staticmethod
    def _bump_version(key):
        cache.add(key, 1, timeout=None)
        try:
            return cache.incr(key)
        except ValueError:
            cache.set(key, 2, timeout=None)
            return 2

    @staticmethod
    def get_section_cache_key(section_id, subject_id=None):
        version = FaceService._cache_version(FaceService._version_key(section_id))
        subject_suffix = f"_sub_{subject_id}" if subject_id else ''
        return f"{SECTION_CACHE_KEY_PREFIX}{section_id}{subject_suffix}_v{version}"

    @staticmethod
    def invalidate_cache(section_id=None):
        """Invalidate only affected face indexes; never flush unrelated cache entries.
        (The school-wide index needs no call: all_face_codes() detects changes itself.)"""
        if section_id:
            cache.delete(FaceService.get_section_cache_key(section_id))
            FaceService._bump_version(FaceService._version_key(section_id))

    # Per-process copy of EVERY enrolled 128-D code (ids + float32 matrix, 512 bytes each).
    # Used for the enrollment duplicate check and the wrong-section check. Kept as a plain
    # object (not in the Django cache) so it is never pickled/unpickled on each request.
    _all_codes = {'signature': None, 'ids': None, 'matrix': None, 'checked_at': 0.0}

    @staticmethod
    def all_face_codes(max_age=0.0):
        """
        (student_ids int64 array, (N, 128) float32 matrix) of every enrolled dlib face.
        COUNT + MAX(updated_at) tells whether a face was added, re-enrolled or deleted; the
        matrix is rebuilt from the database only then.
        max_age: seconds a checked copy may be reused without asking the database again.
        The duplicate check uses 0 (always current); the scanner's wrong-section hint uses a
        few seconds, saving one query per stranger frame.
        """
        import time
        from django.db.models import Count, Max
        from core.models import StudentBiometric

        entry = FaceService._all_codes
        now = time.monotonic()
        if max_age and entry['signature'] is not None and now - entry['checked_at'] < max_age:
            return entry['ids'], entry['matrix']
        enrolled = StudentBiometric.objects.exclude(face_encoding='')
        signature = tuple(enrolled.aggregate(n=Count('pk'), last=Max('updated_at')).values())
        if entry['signature'] == signature:
            entry['checked_at'] = now
            return entry['ids'], entry['matrix']

        # Usually only a few faces changed (one enrollment): load just those rows.
        old = entry['signature']
        if old is not None and old[1] is not None and entry['ids'] is not None:
            changed = enrolled.filter(updated_at__gte=old[1]).values_list('student_id', 'face_encoding')
            ids, matrix = entry['ids'], entry['matrix']
            position = {int(sid): i for i, sid in enumerate(ids)}
            new_ids, new_rows = [], []
            for student_id, raw in changed:
                vector = FaceService._parse_code(raw)
                if vector is None:
                    continue
                if student_id in position:
                    matrix[position[student_id]] = vector                    # re-enrolled
                else:
                    new_ids.append(student_id)
                    new_rows.append(vector)
            if new_rows:
                ids = np.concatenate([ids, np.asarray(new_ids, dtype=np.int64)])
                matrix = np.vstack([matrix, np.stack(new_rows)])
            if len(ids) == signature[0]:   # nothing was deleted: the patched copy is exact
                entry.update(signature=signature, ids=ids, matrix=matrix, checked_at=now)
                return ids, matrix

        # First use, or a face was deleted: rebuild the whole copy from the database.
        entry.update(signature=None, ids=None, matrix=None)  # free the old copy first
        ids, rows = [], []
        for student_id, raw in enrolled.values_list('student_id', 'face_encoding').iterator(chunk_size=2000):
            vector = FaceService._parse_code(raw)
            if vector is None:
                continue
            ids.append(student_id)
            rows.append(vector)
        id_array = np.asarray(ids, dtype=np.int64)
        matrix = np.stack(rows) if rows else np.empty((0, 128), dtype=np.float32)
        del rows
        entry.update(signature=signature, ids=id_array, matrix=matrix, checked_at=now)
        return id_array, matrix

    @staticmethod
    def _parse_code(raw):
        """Stored JSON face code -> 128 float32 values (512 bytes), or None if not a dlib code."""
        try:
            vector = np.asarray(json.loads(raw), dtype=np.float32)
        except (json.JSONDecodeError, TypeError, ValueError):
            return None
        return vector if vector.shape == (128,) else None

    @staticmethod
    def describe_student(student_id):
        """Name, number and sections of ONE student (looked up only when they matched)."""
        from core.models import Student
        student = Student.objects.select_related('user__profile').get(pk=student_id)
        sections = [
            e.section.name for e in
            Enrollment.objects.filter(student_id=student_id).select_related('section__template')
        ]
        return {
            'id': student.pk,
            'student_number': student.student_id,
            'name': student.user.get_full_name() or student.user.username,
            'assigned_sections': ", ".join(sections) if sections else "No Section Assigned",
        }

    @staticmethod
    def get_section_student_encodings(section, subject=None):
        """
        Retrieves enrolled students with face encodings for a section and optional subject.
        Pre-indexes encodings into a vectorized NumPy matrix for sub-millisecond matching.
        Uses Django cache to avoid repeated DB lookups and JSON parsing per video frame.
        Supports FSUU irregular students: includes block section students (subject=null)
        plus irregular students enrolled specifically in this subject.
        """
        subj_id = subject.pk if (subject and hasattr(subject, 'pk')) else (subject if isinstance(subject, int) else None)
        cache_key = FaceService.get_section_cache_key(section.pk, subj_id)
        cached_data = cache.get(cache_key)
        if cached_data is not None:
            return cached_data

        from django.db.models import Q
        filter_q = Q(section=section)
        if subj_id:
            filter_q &= (Q(subject__isnull=True) | Q(subject_id=subj_id))

        enrollments = Enrollment.objects.filter(filter_q).select_related(
            'student__user__profile', 'student__biometric',
        ).filter(student__biometric__isnull=False).exclude(student__biometric__face_encoding='')

        students_list = []
        encodings_list = []
        seen_student_ids = set()

        for enrollment in enrollments:
            student = enrollment.student
            if student.pk in seen_student_ids:
                continue
            seen_student_ids.add(student.pk)
            try:
                encoding = json.loads(student.biometric.face_encoding)
                encodings_list.append(encoding)
                students_list.append({
                    'id': student.pk,
                    'student_number': student.student_id,
                    'name': student.user.get_full_name() or student.user.username,
                })
            except (json.JSONDecodeError, TypeError):
                continue

        matrix = np.array(encodings_list, dtype=np.float32) if encodings_list else np.empty((0, 128), dtype=np.float32)

        data = {
            'students': students_list,
            'encodings': encodings_list,
            'matrix': matrix,
        }
        cache.set(cache_key, data, timeout=CACHE_TIMEOUT)
        return data

    @staticmethod
    def _consensus_cache_key(session_id):
        return f"{CONSENSUS_CACHE_PREFIX}{session_id}"

    @staticmethod
    def _consensus_store():
        """
        The "same student, N frames in a row" streak must be shared by every server worker:
        frames of one student can reach different gunicorn workers, and a per-process cache
        would split the streak (slower marking). The 'security' cache is the database cache
        all workers share; plain memory is only the fallback.
        """
        from django.core.cache import caches
        return caches['security'] if 'security' in settings.CACHES else cache

    @staticmethod
    def _reset_consensus(session_id):
        FaceService._consensus_store().delete(FaceService._consensus_cache_key(session_id))

    @staticmethod
    def _consensus_frames_required(match_confidence=None):
        """Every match needs the same number of consecutive, distinct frames (no instant marks)."""
        return max(1, int(getattr(settings, 'FACE_CONSENSUS_FRAMES', 3)))

    @staticmethod
    def _update_consensus(session_id, student_id, face_encoding=None):
        """
        Track consecutive matching frames for one student.
        Returns (streak, is_replay). A frame whose face vector is (near-)identical to the
        previous one is a replayed/duplicated image: it does not advance the streak.
        """
        cache_key = FaceService._consensus_cache_key(session_id)
        store = FaceService._consensus_store()
        data = store.get(cache_key) or {'student_id': None, 'count': 0, 'last_encoding': None}
        is_replay = False

        if data.get('student_id') == student_id:
            last = data.get('last_encoding')
            if last is not None and face_encoding is not None and len(last) == len(face_encoding):
                epsilon = getattr(settings, 'FACE_REPLAY_EPSILON', 0.002)
                diff = float(np.linalg.norm(
                    np.asarray(last, dtype=np.float32) - np.asarray(face_encoding, dtype=np.float32)
                ))
                is_replay = diff < epsilon
            if not is_replay:
                data['count'] += 1
        else:
            data = {'student_id': student_id, 'count': 1}

        data['last_encoding'] = list(face_encoding) if face_encoding is not None else None
        store.set(cache_key, data, timeout=60)
        return data['count'], is_replay

    @staticmethod
    def recognize_all_faces_in_frame(session, frame_bytes, tolerance=None, timing=None):
        """
        Professional single-look recognition (no head-turn challenge):
        1. Detect faces; pick one (prefer an unmarked student, else largest / centered).
        2. Quality gate from 68 landmarks: head angle (solvePnP yaw/pitch/roll), eyes open,
           eye distance, sharpness, light. Bad frames are skipped (never guessed on).
        3. Strict Euclidean match of the 128-D code against the FULL section roster with
           confidence floor and second-best margin; already-marked owners are only reported.
        4. Passive liveness (heuristics + MiniFASNet), fails closed.
        5. FACE_CONSENSUS_FRAMES consecutive, non-identical good frames before marking.
        """
        if tolerance is None:
            tolerance = getattr(settings, 'FACE_RECOGNITION_TOLERANCE', 0.38)

        timing = {} if timing is None else timing
        lap = time.perf_counter()

        # Decode ONCE; the same pixels feed detection, quality and liveness.
        # If decoding fails, quality and liveness fail closed below.
        try:
            img_rgb = _decode_image_to_rgb(frame_bytes)
            frame_h, frame_w = img_rgb.shape[:2]
        except Exception:
            img_rgb = None
            frame_w, frame_h = 640, 480
        lap = _lap(timing, 'image', lap)

        # Only the student in front of the camera: the largest, most centred face. Background
        # faces are counted but never encoded or matched (no slowdown, no wrong marks).
        stats = {}
        all_detected = detect_and_encode_all_faces(
            frame_bytes, downscale=0.42, fast=True, img_rgb=img_rgb, primary_only=True, stats=stats,
        )
        lap = _lap(timing, 'detect', lap)
        total_face_count = stats.get('face_count', len(all_detected))
        if not all_detected:
            return {'success': True, 'recognized': [], 'face_count': 0}
        all_detected = pick_primary_face(all_detected, frame_w, frame_h)

        def run_liveness(face_box):
            if img_rgb is None:
                return False, 'Liveness check failed: frame could not be decoded'
            is_live, _score, reason = check_face_liveness(img_rgb, face_box)
            return is_live, reason

        section = session.schedule.section
        subject = session.schedule.subject
        section_data = FaceService.get_section_student_encodings(section, subject=subject)
        students = section_data['students']
        section_matrix = section_data.get('matrix')
        if section_matrix is None and section_data.get('encodings'):
            section_matrix = np.array(section_data['encodings'], dtype=np.float32)

        # One query: who is already marked, and with which status (uses record_session_status_idx).
        marked_status = dict(
            session.records.exclude(status='absent').values_list('student_id', 'status')
        )
        marked_student_ids = set(marked_status)
        lap = _lap(timing, 'roster', lap)  # roster cache/DB + who is already marked

        detected_faces = all_detected
        recognized_results = []

        def base_result(student, confidence, box, **extra):
            data = {
                'student_id': student['id'] if student else None,
                'student_number': student['student_number'] if student else None,
                'name': student['name'] if student else 'Unknown',
                'confidence': round(confidence * 100, 1),
                'status': None,
                'new_status': None,
                'box': box,
                'matched': False,
                'wrong_section': False,
            }
            data.update(extra)
            return data

        for face_item in detected_faces:
            box = face_item.get('box', {})

            # Cheap gates first (milliseconds); the ~0.4 s face code only runs when they pass.
            # Position: near and in the middle (the student in front, not someone behind).
            position_ok, position_reason = scan_face_position(box, frame_w, frame_h)
            if not position_ok:
                recognized_results.append(base_result(
                    None, 0.0, box, name='', quality_failed=True, message=position_reason,
                ))
                continue

            # Quality: a blurry / turned / eyes-closed frame is skipped, not matched.
            # The consensus streak is kept, so one bad frame does not restart the student.
            quality_ok, quality_reason, _metrics = assess_scan_quality(img_rgb, box)
            lap = _lap(timing, 'gates', lap)  # position + quality
            if not quality_ok:
                recognized_results.append(base_result(
                    None, 0.0, box, name='', quality_failed=True, message=quality_reason,
                ))
                continue

            face_encoding = face_item.get('encoding') or encode_scan_face(img_rgb, box)
            lap = _lap(timing, 'encode', lap)  # the face code: usually the slowest step

            best_match = None
            best_confidence = 0.0

            # Match against the FULL roster (marked students included) so the margin gate sees
            # every enrolled face; only afterwards decide whether the student is already marked.
            if section_matrix is not None and len(section_matrix) > 0 and face_encoding:
                is_match, best_idx, _dist, confidence, _margin = batch_compare_faces(
                    section_matrix, face_encoding, tolerance
                )
                if is_match and best_idx is not None and best_idx < len(students):
                    candidate = students[best_idx]
                    if candidate.get('id') in marked_student_ids:
                        recognized_results.append(base_result(
                            candidate, confidence, box,
                            status=marked_status.get(candidate['id']),
                            verifying=False, already_marked=True,
                        ))
                        FaceService._reset_consensus(session.pk)
                        continue
                    best_match = candidate
                    best_confidence = confidence

            lap = _lap(timing, 'match', lap)
            if best_match:
                is_live, live_reason = run_liveness(box)
                lap = _lap(timing, 'live', lap)
                if not is_live:
                    FaceService._reset_consensus(session.pk)
                    recognized_results.append(base_result(
                        best_match, best_confidence, box, liveness_failed=True, message=live_reason,
                    ))
                    continue

                streak, is_replay = FaceService._update_consensus(session.pk, best_match['id'], face_encoding)
                consensus_reached = (
                    streak >= FaceService._consensus_frames_required(best_confidence) and not is_replay
                )
                record, is_new_mark = (None, False)
                if consensus_reached:
                    # Load the student only when actually marking (not on every verifying frame).
                    from core.models import Student
                    student_obj = Student.objects.get(pk=best_match['id'])
                    record, is_new_mark = AttendanceService.mark_attendance(
                        session=session, student=student_obj, confidence=best_confidence,
                    )
                if consensus_reached:
                    FaceService._reset_consensus(session.pk)
                lap = _lap(timing, 'mark', lap)  # streak + saving attendance

                recognized_results.append(base_result(
                    best_match, best_confidence, box,
                    status=record.status if record else 'verifying',
                    new_status=record.status if (is_new_mark and consensus_reached) else None,
                    matched=consensus_reached,
                    verifying=not consensus_reached,
                    replay_suspected=is_replay,
                ))
                continue

            FaceService._reset_consensus(session.pk)
            is_live, live_reason = run_liveness(box)
            lap = _lap(timing, 'live', lap)
            if not is_live:
                recognized_results.append(base_result(None, 0.0, box, liveness_failed=True, message=live_reason))
                continue

            # Not in this class: is it a student from ANOTHER section? Same strict match rules
            # against the whole school; details are read only for the one matched student.
            global_ids, global_matrix = FaceService.all_face_codes(max_age=10.0)
            wrong_section_match = None
            wrong_section_conf = 0.0
            if len(global_ids) > 0 and face_encoding and len(face_encoding) == global_matrix.shape[1]:
                is_match_g, g_idx, _d, conf_g, _m = batch_compare_faces(global_matrix, face_encoding, tolerance)
                if is_match_g and g_idx is not None and g_idx < len(global_ids):
                    wrong_section_match = FaceService.describe_student(int(global_ids[g_idx]))
                    wrong_section_conf = conf_g

            lap = _lap(timing, 'other_sections', lap)
            if wrong_section_match:
                recognized_results.append(base_result(
                    wrong_section_match, wrong_section_conf, box,
                    status='wrong_section', wrong_section=True,
                    assigned_sections=wrong_section_match.get('assigned_sections', 'Different Section'),
                ))
            else:
                recognized_results.append(base_result(None, 0.0, box))

        _log_scan_timing(timing, recognized_results)
        return {
            'success': True,
            'recognized': recognized_results,
            'face_count': total_face_count,
            'scanning_primary': len(detected_faces) == 1,
            'multiple_faces_detected': total_face_count > 1,
        }

    @staticmethod
    def draw_boxes(frame_bytes, recognized_results):
        """Draw bounding boxes and names on the frame image."""
        box_data = []
        for r in recognized_results:
            box = r.get('box', {})
            box_data.append({
                'top': box.get('top', 0),
                'right': box.get('right', 0),
                'bottom': box.get('bottom', 0),
                'left': box.get('left', 0),
                'name': r.get('name', 'Unknown'),
                'status': r.get('status', 'absent'),
            })
        return draw_face_boxes(frame_bytes, box_data)
