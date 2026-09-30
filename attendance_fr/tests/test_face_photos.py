"""
Private face photos: private storage, signed expiring links, role checks, migration command.
All storage is redirected to temporary folders; the real Cloudinary account is never used.
"""
import shutil
import tempfile
from datetime import time
from io import StringIO
from unittest.mock import patch

from django.core.cache import cache
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage
from django.core.management import call_command
from django.test import Client, TestCase, override_settings
from django.utils import timezone

from attendance_fr.face_photos import face_photo_link
from attendance_fr.storage import PrivateFileSystemStorage
from accounts.models import User, UserProfile
from core.models import (
    AcademicTerm, AttendanceRecord, AttendanceSession, ClassSchedule, ClassScheduleDay, ClassSection,
    Course, Enrollment, Instructor, Program, SectionTemplate, SessionReopenLog, Student, StudentBiometric, Subject,
)
from attendance_fr.tests.factories import (
    create_instructor, create_schedule, create_section, create_student, create_subject,
    create_template, create_user, enroll, set_face, term, build_schedule,
)

JPEG = b'\xff\xd8\xff\xe0fake-jpeg-bytes'


class TempStorageMixin:
    """Point face_image fields at a temp private dir and 'default' at a temp public dir."""

    def setUp(self):
        super().setUp()
        cache.clear()
        self.private_dir = tempfile.mkdtemp()
        self.public_dir = tempfile.mkdtemp()
        self.private = PrivateFileSystemStorage(location=self.private_dir)
        self.public = FileSystemStorage(location=self.public_dir, base_url='/media/')
        fields = [StudentBiometric._meta.get_field('face_image')]
        self._originals = [(f, f.storage) for f in fields]
        for field in fields:
            field.storage = self.private
        legacy = patch('attendance_fr.face_photos.get_legacy_public_storage', return_value=self.public)
        legacy_cmd = patch('accounts.management.commands.make_face_photos_private.get_legacy_public_storage',
                           return_value=self.public)
        legacy.start()
        legacy_cmd.start()
        self.addCleanup(legacy.stop)
        self.addCleanup(legacy_cmd.stop)

    def tearDown(self):
        for field, storage in self._originals:
            field.storage = storage
        shutil.rmtree(self.private_dir, ignore_errors=True)
        shutil.rmtree(self.public_dir, ignore_errors=True)
        cache.clear()
        super().tearDown()


class FacePhotoAccessTests(TempStorageMixin, TestCase):
    def setUp(self):
        super().setUp()
        self.admin = create_user(username='fp_admin', role='admin', password='StrongPassword123!')
        self.teacher_u = create_user(username='fp_teacher', role='instructor', password='StrongPassword123!')
        self.teacher = create_instructor(user=self.teacher_u, faculty_id='FAC-FP-1')
        self.other_teacher_u = create_user(username='fp_other', role='instructor', password='StrongPassword123!')
        create_instructor(user=self.other_teacher_u, faculty_id='FAC-FP-2')

        self.student_u = create_user(username='fp_student', role='student', password='StrongPassword123!')
        self.student = create_student(user=self.student_u, student_id='FP-001')
        self.classmate_u = create_user(username='fp_classmate', role='student', password='StrongPassword123!')
        self.classmate = create_student(user=self.classmate_u, student_id='FP-002')

        section = create_section(name='FP-1A', teacher=self.teacher)
        create_schedule(section=section, day_of_week='Mon', start_time=time(8), end_time=time(9), room='R')
        enroll(student=self.student, section=section)
        enroll(student=self.classmate, section=section)

        self.bio = set_face(self.student, '[0.1]')
        self.bio.face_image.save('face_images/face_FP-001.jpg', ContentFile(JPEG), save=True)
        self.client = Client()

    def _get(self, link):
        return self.client.get(link)

    def test_photo_is_stored_privately_with_no_public_url(self):
        self.assertTrue(self.private.exists(self.bio.face_image.name))
        self.assertEqual(self.bio.face_image.url, '')

    def test_admin_gets_working_signed_link(self):
        link = face_photo_link(self.student, user=self.admin)
        self.assertIn('/api/media/face/', link)
        res = self._get(link)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content, JPEG)
        self.assertIn('no-store', res['Cache-Control'])

    def test_who_gets_a_link(self):
        self.assertIsNotNone(face_photo_link(self.student, user=self.student_u))      # self
        self.assertIsNotNone(face_photo_link(self.student, user=self.teacher_u))      # their teacher
        self.assertIsNone(face_photo_link(self.student, user=self.classmate_u))       # other student
        self.assertIsNone(face_photo_link(self.student, user=self.other_teacher_u))   # unrelated teacher
        self.assertIsNone(face_photo_link(self.student, user=None))                   # anonymous

    def test_link_expires(self):
        link = face_photo_link(self.student, user=self.admin)
        with override_settings(FACE_PHOTO_LINK_SECONDS=0), \
             patch('django.core.signing.time.time', return_value=timezone.now().timestamp() + 5):
            self.assertEqual(self._get(link).status_code, 404)

    def test_tampered_or_missing_token_rejected(self):
        link = face_photo_link(self.student, user=self.admin)
        self.assertEqual(self._get(link[:-3] + 'abc').status_code, 404)
        self.assertEqual(self._get(f'/api/media/face/{self.student.pk}/').status_code, 404)

    def test_token_for_one_student_does_not_open_another(self):
        set_face(self.classmate, '[0.2]').face_image.save('face_images/face_FP-002.jpg', ContentFile(JPEG), save=True)
        token = face_photo_link(self.student, user=self.admin).split('?t=')[1]
        self.assertEqual(self._get(f'/api/media/face/{self.classmate.pk}/?t={token}').status_code, 404)

    def test_reenrollment_invalidates_old_links(self):
        link = face_photo_link(self.student, user=self.admin)
        self.bio.face_image.save('face_images/face_FP-001_new.jpg', ContentFile(JPEG), save=True)
        self.assertEqual(self._get(link).status_code, 404)

    def test_api_payloads_follow_the_same_rules(self):
        """Students list (admin) carries links; a classmate's view of the roster does not."""
        self.client.force_login(self.admin)
        rows = self.client.get('/api/students/').json()
        row = next(r for r in rows if r['student_id'] == 'FP-001')
        self.assertIn('/api/media/face/', row['face_image'])
        self.assertNotIn('cloudinary', row['face_image'])

        self.client.force_login(self.student_u)
        me = self.client.get('/api/auth/me/').json()
        self.assertIn('/api/media/face/', me['student_profile']['face_image'])


class MakeFacePhotosPrivateCommandTests(TempStorageMixin, TestCase):
    def setUp(self):
        super().setUp()
        user = create_user(username='mig_student', role='student', password='StrongPassword123!')
        self.student = create_student(user=user, student_id='MIG-001', face_encoding='[0.1]')
        name = self.public.save('face_images/face_MIG-001.jpg', ContentFile(JPEG))
        StudentBiometric.objects.filter(student=self.student).update(face_image=name)
        self.name = name

    def _run(self, *args):
        out = StringIO()
        call_command('make_face_photos_private', *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def test_dry_run_changes_nothing(self):
        output = self._run()
        self.assertIn('DRY RUN', output)
        self.assertIn('would move MIG-001', output)
        self.assertTrue(self.public.exists(self.name))
        self.assertFalse(self.private.exists(self.name))

    def test_apply_moves_photo_and_deletes_public_copy(self):
        output = self._run('--apply')
        self.assertIn('1 moved', output)
        self.student.refresh_from_db()
        self.assertTrue(self.private.exists(self.student.biometric.face_image.name))
        self.assertFalse(self.public.exists(self.name))
        self.assertIn('0 to move', self._run())  # re-running is a no-op

    def test_keep_public_leaves_the_original(self):
        self._run('--apply', '--keep-public')
        self.assertTrue(self.public.exists(self.name))

    def test_unmigrated_photo_still_served_through_signed_link(self):
        admin = create_user(username='mig_admin', role='admin', password='StrongPassword123!')
        self.student.refresh_from_db()
        res = Client().get(face_photo_link(self.student, user=admin))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.content, JPEG)


class AuthenticatedCloudinaryStorageTests(TestCase):
    """The Cloudinary backend uploads privately and never exposes a delivery URL (network mocked)."""

    def _storage(self):
        from attendance_fr.storage import _authenticated_cloudinary_storage_class
        return _authenticated_cloudinary_storage_class()()

    def test_upload_is_authenticated_type(self):
        with patch('cloudinary.uploader.upload', return_value={'public_id': 'face_images/x'}) as upload:
            self._storage()._save('face_images/x.jpg', ContentFile(JPEG))
        self.assertEqual(upload.call_args.kwargs['type'], 'authenticated')

    def test_public_url_is_empty_and_internal_url_is_signed(self):
        import cloudinary
        with patch.object(cloudinary, 'config', wraps=cloudinary.config):
            storage = self._storage()
            self.assertEqual(storage.url('face_images/x'), '')
            internal = storage._get_url('face_images/x')
        self.assertIn('/authenticated/', internal)
        self.assertIn('/s--', internal)  # signature component

    def test_delete_targets_authenticated_asset(self):
        with patch('cloudinary.uploader.destroy', return_value={'result': 'ok'}) as destroy:
            self.assertTrue(self._storage().delete('face_images/x'))
        self.assertEqual(destroy.call_args.kwargs['type'], 'authenticated')
