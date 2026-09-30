"""
Move existing face photos from public storage to private storage.

    python manage.py make_face_photos_private            # dry run: only lists what would change
    python manage.py make_face_photos_private --apply    # copy to private, update rows, delete public copy

Safe to re-run: photos already readable from private storage are skipped. A public copy is
deleted only after the private copy is saved and the database rows point at it.
"""
from django.core.files.base import ContentFile
from django.core.management.base import BaseCommand
from django.db import transaction

from core.models import StudentBiometric
from attendance_fr.storage import get_legacy_public_storage


class Command(BaseCommand):
    help = 'Move existing public face photos into private storage (dry run unless --apply).'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Actually move the photos.')
        parser.add_argument('--keep-public', action='store_true',
                            help='Do not delete the public copy after moving (for a cautious first run).')

    def handle(self, *args, apply=False, keep_public=False, **options):
        private = StudentBiometric._meta.get_field('face_image').storage  # the private storage in use
        public = get_legacy_public_storage()
        students = StudentBiometric.objects.select_related('student').exclude(face_image='').exclude(face_image__isnull=True)
        moved = skipped = failed = 0

        mode = 'APPLY' if apply else 'DRY RUN'
        self.stdout.write(f'[{mode}] {students.count()} student(s) with a face photo')

        for bio in students.iterator():
            student = bio.student
            name = bio.face_image.name
            if self._readable(private, name):
                skipped += 1
                continue
            data = self._read(public, name)
            if data is None:
                failed += 1
                self.stderr.write(f'  ! {student.student_id}: photo "{name}" not found in public storage')
                continue
            if not apply:
                moved += 1
                self.stdout.write(f'  would move {student.student_id}: {name}')
                continue
            try:
                new_name = private.save(name, ContentFile(data))
                with transaction.atomic():
                    StudentBiometric.objects.filter(pk=bio.pk).update(face_image=new_name)
                if not keep_public:
                    try:
                        public.delete(name)
                    except Exception as exc:  # the private copy is already in place
                        self.stderr.write(f'  ! {student.student_id}: moved, but public copy not deleted ({exc})')
                moved += 1
                self.stdout.write(f'  moved {student.student_id}: {name} -> {new_name}')
            except Exception as exc:
                failed += 1
                self.stderr.write(f'  ! {student.student_id}: {exc}')

        verb = 'moved' if apply else 'to move'
        self.stdout.write(self.style.SUCCESS(
            f'[{mode}] {moved} {verb}, {skipped} already private, {failed} failed'
        ))
        if apply and moved:
            from face_app.services.face_service import FaceService
            FaceService.invalidate_cache()

    @staticmethod
    def _read(storage, name):
        try:
            with storage.open(name, 'rb') as handle:
                return handle.read()
        except Exception:
            return None

    @classmethod
    def _readable(cls, storage, name):
        # Cheap existence check (HEAD on Cloudinary) so re-runs on every deploy stay fast.
        try:
            return bool(storage.exists(name))
        except Exception:
            return False
