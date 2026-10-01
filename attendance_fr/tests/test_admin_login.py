"""
/admin/login/ must have the same brute-force protection as the app's /api/token/.
"""
from django.core.cache import cache, caches
from django.test import Client, TestCase, override_settings

from accounts.models import User

PASSWORD = 'StrongPassword123!'


@override_settings(LOGIN_MAX_FAILED_ATTEMPTS=5, LOGIN_ACCOUNT_MAX_FAILURES=100)
class AdminLoginLockoutTests(TestCase):
    def setUp(self):
        cache.clear()
        caches['security'].clear()
        User.objects.create_superuser(username='site_admin', password=PASSWORD, email='a@example.com')
        self.client = Client()

    def tearDown(self):
        cache.clear()
        caches['security'].clear()

    def _admin_login(self, password='wrong', ip='10.1.0.1', username='site_admin'):
        return self.client.post('/admin/login/', {'username': username, 'password': password, 'next': '/admin/'},
                                REMOTE_ADDR=ip)

    def test_login_page_still_loads(self):
        self.assertEqual(self.client.get('/admin/login/').status_code, 200)

    def test_correct_password_signs_in(self):
        response = self._admin_login(password=PASSWORD)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.get('/admin/').status_code, 200)

    def test_repeated_wrong_passwords_lock_the_admin_login(self):
        for _ in range(4):
            self.assertEqual(self._admin_login().status_code, 200)  # form re-shown with an error
        self.assertEqual(self._admin_login().status_code, 200)      # 5th failure sets the lock
        locked = self._admin_login(password=PASSWORD)                # even the right password
        self.assertEqual(locked.status_code, 429)
        self.assertIn('Retry-After', locked)
        self.assertFalse(self.client.get('/admin/').wsgi_request.user.is_authenticated)

    def test_lock_is_per_ip_and_other_devices_still_work(self):
        for _ in range(5):
            self._admin_login(ip='10.1.0.1')
        self.assertEqual(self._admin_login(password=PASSWORD, ip='10.1.0.1').status_code, 429)
        self.assertEqual(self._admin_login(password=PASSWORD, ip='10.1.0.2').status_code, 302)

    def test_admin_and_app_logins_share_the_same_counter(self):
        for _ in range(3):
            self._admin_login()
        for _ in range(2):
            self.client.post('/api/token/', {'username': 'site_admin', 'password': 'wrong'},
                             content_type='application/json', REMOTE_ADDR='10.1.0.1')
        self.assertEqual(self._admin_login(password=PASSWORD).status_code, 429)

    @override_settings(LOGIN_ACCOUNT_MAX_FAILURES=3, LOGIN_MAX_FAILED_ATTEMPTS=50)
    def test_account_wide_cap_applies_across_ips(self):
        for i in range(3):
            self._admin_login(ip=f'10.2.0.{i}')
        self.assertEqual(self._admin_login(password=PASSWORD, ip='10.2.0.99').status_code, 429)

    def test_successful_login_resets_the_counter(self):
        for _ in range(4):
            self._admin_login()
        self.assertEqual(self._admin_login(password=PASSWORD).status_code, 302)
        self.client.logout()
        for _ in range(4):
            self._admin_login()
        self.assertEqual(self._admin_login(password=PASSWORD).status_code, 302)
