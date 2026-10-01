"""Django admin sign-in form with the two-step code (see attendance_fr/admin_site.py)."""
from django import forms
from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.exceptions import ValidationError


class TwoFactorAdminAuthenticationForm(AdminAuthenticationForm):
    """Admin sign-in that also asks for the two-step code when the account has it turned on."""
    otp_code = forms.CharField(
        label='Two-step code', required=False, max_length=20, strip=True,
        help_text='Only if you turned on two-step sign-in: the 6-digit code from your app, or a backup code.',
        widget=forms.TextInput(attrs={'autocomplete': 'one-time-code', 'inputmode': 'numeric'}),
    )

    def clean(self):
        cleaned = super().clean()  # password + staff checks; sets self.user_cache
        user = self.get_user()
        if user is not None:
            from attendance_fr.api.services.two_factor import TwoFactorService
            if TwoFactorService.is_enabled(user):
                code = cleaned.get('otp_code')
                if not code:
                    self.user_cache = None
                    raise ValidationError('This account uses two-step sign-in. Enter the code from your app.',
                                          code='otp_required')
                if not TwoFactorService.verify(user, code):
                    self.user_cache = None
                    raise ValidationError('That two-step code is not correct.', code='otp_invalid')
        return cleaned
