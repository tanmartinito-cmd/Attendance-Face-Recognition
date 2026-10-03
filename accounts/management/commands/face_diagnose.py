"""
Explain face-match mistakes without changing anything.

    python manage.py face_diagnose                 # distance between every pair of enrolled faces
    python manage.py face_diagnose --image me.jpg  # who does this photo match, and how closely?

A correct setup has every pair FAR apart (well above FACE_RECOGNITION_TOLERANCE) and a photo of
a student within tolerance of ONLY that student. Pairs closer than the tolerance are the
students that get confused with each other.
"""
import itertools
import json

import numpy as np
from django.conf import settings
from django.core.management.base import BaseCommand

from core.models import StudentBiometric


class Command(BaseCommand):
    help = 'Show how close enrolled faces are to each other (and to one photo).'

    def add_arguments(self, parser):
        parser.add_argument('--image', help='Photo to match the way live attendance does.')

    def handle(self, *args, **options):
        tol = float(getattr(settings, 'FACE_RECOGNITION_TOLERANCE', 0.38))
        margin = float(getattr(settings, 'FACE_MATCH_MARGIN', 0.08))
        self.stdout.write(f'tolerance={tol} margin={margin} enroll_jitters={settings.FACE_ENROLL_JITTERS}')

        rows = []
        for bio in StudentBiometric.objects.select_related('student').exclude(face_encoding=''):
            try:
                vec = np.asarray(json.loads(bio.face_encoding), dtype=np.float32)
            except ValueError:
                continue
            if vec.shape == (128,):
                rows.append((bio.student.student_id, vec, bio.enrolled_at))
        self.stdout.write(f'{len(rows)} enrolled face(s)')
        for sid, vec, at in rows:
            self.stdout.write(f'  {sid}  enrolled {at:%Y-%m-%d %H:%M}  |v|={np.linalg.norm(vec):.3f}')

        for (a, va, _), (b, vb, _) in itertools.combinations(rows, 2):
            d = float(np.linalg.norm(va - vb))
            flag = '  <-- CAN BE CONFUSED' if d <= tol + margin else ''
            self.stdout.write(f'  pair {a} / {b}: {d:.3f}{flag}')

        image = options.get('image')
        if not image:
            return
        from face_app.utils import _decode_image_to_rgb, detect_and_encode_all_faces, encode_scan_face
        data = open(image, 'rb').read()
        img = _decode_image_to_rgb(data)
        faces = detect_and_encode_all_faces(data, downscale=0.42, fast=True, img_rgb=img, primary_only=True)
        if not faces:
            self.stdout.write(self.style.ERROR('No face found in the photo.'))
            return
        probe = np.asarray(encode_scan_face(img, faces[0]['box']), dtype=np.float32)
        self.stdout.write('photo vs enrolled (closest first):')
        for sid, vec, _ in sorted(rows, key=lambda r: np.linalg.norm(r[1] - probe)):
            d = float(np.linalg.norm(vec - probe))
            self.stdout.write(f'  {sid}: {d:.3f}  {"MATCH" if d <= tol else ""}')
