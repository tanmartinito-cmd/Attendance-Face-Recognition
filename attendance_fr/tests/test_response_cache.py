"""Regression tests for backend-only, versioned API response caching."""
from django.core.cache import cache
from django.test import TestCase, TransactionTestCase

from attendance_fr.api.services.response_cache import ResponseCache
from core.models import Program


class ResponseCacheTests(TestCase):
    def setUp(self):
        cache.clear()

    def test_reuses_value_for_same_authorized_scope(self):
        calls = []

        def factory():
            calls.append(True)
            return {'result': len(calls)}

        scope = {'user_id': 7, 'role': 'teacher', 'filters': ()}
        self.assertEqual(ResponseCache.get_or_set('dashboard', scope, factory), {'result': 1})
        self.assertEqual(ResponseCache.get_or_set('dashboard', scope, factory), {'result': 1})
        self.assertEqual(len(calls), 1)

    def test_never_shares_response_between_requesting_users(self):
        first = ResponseCache.get_or_set(
            'reports', {'user_id': 1, 'role': 'student', 'filters': ()}, lambda: {'student': 1}
        )
        second = ResponseCache.get_or_set(
            'reports', {'user_id': 2, 'role': 'student', 'filters': ()}, lambda: {'student': 2}
        )
        self.assertEqual(first, {'student': 1})
        self.assertEqual(second, {'student': 2})

    def test_group_invalidation_bypasses_stale_value_immediately(self):
        scope = {'user_id': 7, 'role': 'teacher', 'filters': ()}
        self.assertEqual(ResponseCache.get_or_set('attendance', scope, lambda: {'count': 1}), {'count': 1})
        ResponseCache.invalidate('attendance')
        self.assertEqual(ResponseCache.get_or_set('attendance', scope, lambda: {'count': 2}), {'count': 2})


class ResponseCacheSignalTests(TransactionTestCase):
    def setUp(self):
        cache.clear()

    def test_academic_write_invalidates_academic_group_after_commit(self):
        scope = {'user_id': 1, 'role': 'admin', 'filters': ()}
        ResponseCache.get_or_set('academic', scope, lambda: {'program_count': 0})
        Program.objects.create(code='CACHE', name='Cache Test')
        self.assertEqual(
            ResponseCache.get_or_set('academic', scope, lambda: {'program_count': 1}),
            {'program_count': 1},
        )


class LiveSyncVersionsTests(TransactionTestCase):
    """Every DB write bumps a group version that clients poll (GET /api/sync/versions/)."""

    def setUp(self):
        from django.test import Client
        from accounts.models import CustomUser
        cache.clear()
        self.user = CustomUser.objects.create_user(username='sync_admin', role='admin', password='StrongPassword123!')
        self.client = Client()
        self.client.force_login(self.user)

    def _versions(self):
        res = self.client.get('/api/sync/versions/')
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res['Cache-Control'], 'no-store')
        return res.json()['versions']

    def test_academic_change_bumps_academic_version(self):
        before = self._versions()
        Program.objects.create(code='SYNC', name='Sync Test')
        after = self._versions()
        self.assertGreater(after['academic'], before['academic'])

    def test_user_change_bumps_people_version(self):
        from accounts.models import CustomUser
        before = self._versions()
        CustomUser.objects.create_user(username='new_teacher', role='teacher', password='StrongPassword123!')
        self.assertGreater(self._versions()['people'], before['people'])

    def test_sign_in_is_not_a_data_change(self):
        before = self._versions()
        self.user.save(update_fields=['last_login'])
        self.assertEqual(self._versions()['people'], before['people'])

    def test_requires_sign_in(self):
        from django.test import Client
        self.assertIn(Client().get('/api/sync/versions/').status_code, (401, 403))
