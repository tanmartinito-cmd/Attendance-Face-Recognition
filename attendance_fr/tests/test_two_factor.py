"""
Optional two-step sign-in (authenticator app): setup, enable, sign-in, backup codes,
lockout, Django admin, disable, recovery command.
"""
from io import StringIO

import pyotp
from django.core.cache import cache, caches
from django.core.management import call_command
from django.test import Client, TestCase, override_settings

from accounts.models import User, UserBackupCode, UserTwoFactor
from attendance_fr.api.services.two_factor import TwoFactorService, _decrypt
from attendance_fr.tests.factories import create_user

PASSWORD = 'StrongPassword123!'


def _code(secret, offset=0):
    totp = pyotp.TOTP(secret)
    import time
    return totp.at(time.time() + offset * 30)


class _Base(TestCase):
    def setUp(self):
        cache.clear()
        caches['security'].clear()
        self.user = create_user(username='tf_student', role='student', password=PASSWORD)
        self.client = Client()

    def tearDown(self):
        cache.clear()
        caches['security'].clear()

    def _password_login(self, password=PASSWORD, ip='10.5.0.1', username='tf_student'):
        return self.client.post('/api/token/', {'username': username, 'password': password},
                                content_type='application/json', REMOTE_ADDR=ip)

    def _access(self):
        res = self._password_login()
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()['access']

    def _auth(self, access):
        return {'HTTP_AUTHORIZATION': f'Bearer {access}'}

    def _turn_on(self):
        """Returns (secret, backup_codes) for self.user."""
        access = self._access()
        setup = self.client.post('/api/auth/2fa/setup/', **self._auth(access))
        self.assertEqual(setup.status_code, 200, setup.content)
        secret = setup.json()['secret']
        enable = self.client.post('/api/auth/2fa/enable/', {'code': _code(secret)},
                                  content_type='application/json', **self._auth(access))
        self.assertEqual(enable.status_code, 200, enable.content)
        # The enabling code is now used; move the replay guard back so tests can sign in
        # within the same 30 seconds (in real life the next code comes 30 s later).
        UserTwoFactor.objects.filter(user=self.user).update(last_used_step=0)
        return secret, enable.json()['backup_codes']


class TwoFactorSetupTests(_Base):
    def test_off_by_default(self):
        res = self.client.get('/api/auth/2fa/', **self._auth(self._access()))
        self.assertEqual(res.json()['enabled'], False)

    def test_setup_returns_qr_and_secret_but_is_not_active_yet(self):
        access = self._access()
        res = self.client.post('/api/auth/2fa/setup/', **self._auth(access))
        data = res.json()
        self.assertTrue(data['qr_svg'].startswith('data:image/svg+xml'))
        self.assertIn('otpauth://totp/', data['otpauth_uri'])
        self.assertIn('issuer=AttendFR', data['otpauth_uri'])
        self.assertEqual(res['Cache-Control'], 'no-store')
        self.assertFalse(TwoFactorService.is_enabled(self.user))
        # Password-only sign-in still works until it is confirmed
        self.assertIn('access', self._password_login().json())

    def test_secret_is_encrypted_at_rest(self):
        access = self._access()
        secret = self.client.post('/api/auth/2fa/setup/', **self._auth(access)).json()['secret']
        stored = UserTwoFactor.objects.get(user=self.user).secret_encrypted
        self.assertNotIn(secret, stored)
        self.assertEqual(_decrypt(stored), secret)

    def test_wrong_code_does_not_enable(self):
        access = self._access()
        self.client.post('/api/auth/2fa/setup/', **self._auth(access))
        res = self.client.post('/api/auth/2fa/enable/', {'code': '000000'},
                               content_type='application/json', **self._auth(access))
        self.assertEqual(res.status_code, 400)
        self.assertFalse(TwoFactorService.is_enabled(self.user))

    def test_enable_gives_ten_backup_codes_stored_hashed(self):
        _, codes = self._turn_on()
        self.assertEqual(len(codes), 10)
        stored = list(UserBackupCode.objects.filter(user=self.user).values_list('code_hash', flat=True))
        self.assertEqual(len(stored), 10)
        self.assertFalse(any(c in stored for c in codes))

    def test_setup_refused_when_already_on(self):
        self._turn_on()
        access = self._login_with_code_tokens()
        res = self.client.post('/api/auth/2fa/setup/', **self._auth(access))
        self.assertEqual(res.status_code, 400)

    def _login_with_code_tokens(self):
        record = UserTwoFactor.objects.get(user=self.user)
        secret = _decrypt(record.secret_encrypted)
        challenge = self._password_login().json()['challenge']
        res = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': _code(secret, 1)},
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()['access']


class TwoFactorLoginTests(_Base):
    def test_password_alone_no_longer_gives_tokens(self):
        self._turn_on()
        res = self._password_login()
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertTrue(data['two_factor_required'])
        self.assertNotIn('access', data)
        self.assertNotIn('refresh', data)

    def test_correct_code_signs_in(self):
        secret, _ = self._turn_on()
        challenge = self._password_login().json()['challenge']
        res = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': _code(secret)},
                               content_type='application/json')
        self.assertEqual(res.status_code, 200, res.content)
        me = self.client.get('/api/auth/me/', **self._auth(res.json()['access']))
        self.assertEqual(me.json()['username'], 'tf_student')

    def test_a_code_works_only_once(self):
        secret, _ = self._turn_on()
        code = _code(secret)
        challenge = self._password_login().json()['challenge']
        first = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': code},
                                 content_type='application/json')
        self.assertEqual(first.status_code, 200)
        challenge = self._password_login().json()['challenge']
        again = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': code},
                                 content_type='application/json')
        self.assertEqual(again.status_code, 401)

    def test_wrong_code_counts_toward_lockout(self):
        self._turn_on()
        challenge = self._password_login().json()['challenge']
        codes = [self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': '123456'},
                                  content_type='application/json', REMOTE_ADDR='10.5.0.1').status_code
                 for _ in range(5)]
        self.assertEqual(codes[:4], [401] * 4)
        self.assertEqual(codes[4], 429)

    def test_backup_code_signs_in_once(self):
        _, backups = self._turn_on()
        challenge = self._password_login().json()['challenge']
        ok = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': backups[0].upper()},
                              content_type='application/json')
        self.assertEqual(ok.status_code, 200)
        challenge = self._password_login().json()['challenge']
        reuse = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': backups[0]},
                                 content_type='application/json')
        self.assertEqual(reuse.status_code, 401)
        self.assertEqual(TwoFactorService.backup_codes_left(self.user), 9)

    def test_tampered_or_foreign_challenge_is_rejected(self):
        secret, _ = self._turn_on()
        res = self.client.post('/api/token/2fa/', {'challenge': 'garbage', 'code': _code(secret)},
                               content_type='application/json')
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.json()['code'], 'challenge_expired')

    def test_challenge_stops_working_after_password_change(self):
        secret, _ = self._turn_on()
        challenge = self._password_login().json()['challenge']
        self.user.set_password('Another-Pass-77')
        self.user.save()
        res = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': _code(secret)},
                               content_type='application/json')
        self.assertEqual(res.status_code, 401)

    @override_settings(LOGIN_MAX_FAILED_ATTEMPTS=5)
    def test_admin_login_requires_the_code(self):
        admin = User.objects.create_superuser(username='tf_admin', password=PASSWORD, email='t@example.com')
        self.user = admin
        res = self.client.post('/api/token/', {'username': 'tf_admin', 'password': PASSWORD},
                               content_type='application/json')
        access = res.json()['access']
        secret = self.client.post('/api/auth/2fa/setup/', **self._auth(access)).json()['secret']
        self.client.post('/api/auth/2fa/enable/', {'code': _code(secret)},
                         content_type='application/json', **self._auth(access))
        UserTwoFactor.objects.filter(user=admin).update(last_used_step=0)

        page = self.client.get('/admin/login/')
        self.assertContains(page, 'Two-step code')
        no_code = self.client.post('/admin/login/', {'username': 'tf_admin', 'password': PASSWORD, 'next': '/admin/'})
        self.assertEqual(no_code.status_code, 200)
        self.assertContains(no_code, 'two-step sign-in')
        self.assertFalse(self.client.get('/admin/').wsgi_request.user.is_authenticated)
        ok = self.client.post('/admin/login/', {'username': 'tf_admin', 'password': PASSWORD,
                                                'otp_code': _code(secret), 'next': '/admin/'})
        self.assertEqual(ok.status_code, 302)

    def test_admin_without_2fa_still_signs_in_with_password(self):
        User.objects.create_superuser(username='plain_admin', password=PASSWORD, email='p@example.com')
        ok = self.client.post('/admin/login/', {'username': 'plain_admin', 'password': PASSWORD, 'next': '/admin/'})
        self.assertEqual(ok.status_code, 302)


class TwoFactorDisableTests(_Base):
    def _signed_in_access(self, secret):
        challenge = self._password_login().json()['challenge']
        res = self.client.post('/api/token/2fa/', {'challenge': challenge, 'code': _code(secret)},
                               content_type='application/json')
        return res.json()['access']

    def test_disable_needs_password_and_code(self):
        secret, backups = self._turn_on()
        access = self._signed_in_access(secret)
        wrong_pw = self.client.post('/api/auth/2fa/disable/', {'password': 'nope', 'code': backups[0]},
                                    content_type='application/json', **self._auth(access))
        self.assertEqual(wrong_pw.status_code, 400)
        no_code = self.client.post('/api/auth/2fa/disable/', {'password': PASSWORD, 'code': '000000'},
                                   content_type='application/json', **self._auth(access))
        self.assertEqual(no_code.status_code, 400)
        ok = self.client.post('/api/auth/2fa/disable/', {'password': PASSWORD, 'code': backups[1]},
                              content_type='application/json', **self._auth(access))
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(ok.json()['enabled'])
        self.assertFalse(UserBackupCode.objects.filter(user=self.user).exists())
        self.assertIn('access', self._password_login().json())

    def test_regenerate_backup_codes_replaces_old_ones(self):
        secret, old = self._turn_on()
        access = self._signed_in_access(secret)
        res = self.client.post('/api/auth/2fa/backup-codes/', {'code': _code(secret, 1)},
                               content_type='application/json', **self._auth(access))
        self.assertEqual(res.status_code, 200, res.content)
        new = res.json()['backup_codes']
        self.assertEqual(len(new), 10)
        self.assertFalse(TwoFactorService.verify(self.user, old[0]))
        self.assertTrue(TwoFactorService.verify(self.user, new[0]))

    def test_recovery_command(self):
        self._turn_on()
        out = StringIO()
        call_command('disable_2fa', 'tf_student', stdout=out)
        self.assertIn('turned off', out.getvalue())
        self.assertFalse(TwoFactorService.is_enabled(self.user))
        self.assertIn('access', self._password_login().json())
