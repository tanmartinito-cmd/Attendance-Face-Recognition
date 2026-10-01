"""
POST /api/auth/password/: strict policy, current password required, every device signed out.
"""
from unittest.mock import patch

from django.core.cache import cache, caches
from django.test import Client, TestCase

from attendance_fr.tests.factories import create_user

OLD = 'StrongPassword123!'
NEW = 'Brand-New-Pass-42'


class PasswordChangeTests(TestCase):
    def setUp(self):
        cache.clear()
        caches['security'].clear()
        self.user = create_user(username='pw_teacher', role='instructor', password=OLD)
        self.client = Client()

    def tearDown(self):
        cache.clear()
        caches['security'].clear()

    def _tokens(self, password=OLD):
        res = self.client.post('/api/token/', {'username': 'pw_teacher', 'password': password},
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()['access'], res.json()['refresh']

    def _change(self, access, current=OLD, new=NEW, confirm=None):
        return self.client.post(
            '/api/auth/password/',
            {'current_password': current, 'new_password': new, 'confirm_password': NEW if confirm is None else confirm},
            content_type='application/json', HTTP_AUTHORIZATION=f'Bearer {access}',
        )

    def test_requires_sign_in(self):
        res = self.client.post('/api/auth/password/', {}, content_type='application/json')
        self.assertEqual(res.status_code, 401)

    def test_wrong_current_password_is_rejected(self):
        access, _ = self._tokens()
        res = self._change(access, current='nope')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['field'], 'current_password')
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(OLD))

    def test_confirmation_must_match(self):
        access, _ = self._tokens()
        res = self._change(access, confirm='Brand-New-Pass-43')
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.json()['field'], 'confirm_password')

    def test_weak_password_is_rejected(self):
        access, _ = self._tokens()
        for weak in ('short1!', 'alllowercase1!', 'NoDigits!!', 'NoSymbol123', 'password'):  # 5 = rate limit
            res = self._change(access, new=weak, confirm=weak)
            self.assertEqual(res.status_code, 400, weak)
            self.assertEqual(res.json()['field'], 'new_password', weak)

    def test_unchanged_password_is_rejected(self):
        access, _ = self._tokens()
        same = self._change(access, new=OLD, confirm=OLD)
        self.assertEqual(same.status_code, 400)
        self.assertIn('different', same.json()['error'])

    def test_success_changes_password_and_signs_out_every_device(self):
        access_a, refresh_a = self._tokens()   # this device
        access_b, refresh_b = self._tokens()   # another device

        with patch('django.utils.timezone.now') as now:
            from django.utils import timezone as tz
            import datetime as dt
            now.return_value = tz.make_aware(dt.datetime.now()) + dt.timedelta(seconds=5)
            res = self._change(access_a)
        self.assertEqual(res.status_code, 200, res.content)

        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW))
        self.assertFalse(self.user.check_password(OLD))

        # Old access tokens (both devices) are rejected
        for access in (access_a, access_b):
            me = self.client.get('/api/auth/me/', HTTP_AUTHORIZATION=f'Bearer {access}')
            self.assertEqual(me.status_code, 401)
        # Old refresh tokens cannot mint new ones
        for refresh in (refresh_a, refresh_b):
            ref = self.client.post('/api/token/refresh/', {'refresh': refresh}, content_type='application/json')
            self.assertEqual(ref.status_code, 401)

        # Signing in again: old password fails, new one works
        bad = self.client.post('/api/token/', {'username': 'pw_teacher', 'password': OLD},
                               content_type='application/json')
        self.assertEqual(bad.status_code, 401)
        cache.clear()
        caches['security'].clear()

    def test_new_sign_in_after_change_works(self):
        access, _ = self._tokens()
        self.assertEqual(self._change(access).status_code, 200)
        new_access, _ = self._tokens(password=NEW)
        me = self.client.get('/api/auth/me/', HTTP_AUTHORIZATION=f'Bearer {new_access}')
        self.assertEqual(me.status_code, 200)

    def test_rate_limited(self):
        access, _ = self._tokens()
        codes = [self._change(access, current='wrong').status_code for _ in range(6)]
        self.assertEqual(codes[:5], [400] * 5)
        self.assertEqual(codes[5], 429)
