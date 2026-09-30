"""
Login with any of: username, Faculty ID, Student ID, or email (case-insensitive, trimmed).
Used by both the JWT login (/api/token/) and the Django admin.
"""
from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

from accounts.models import User


class FlexibleLoginBackend(ModelBackend):

    @staticmethod
    def find_user(identifier):
        """Resolve the login identifier to exactly one user, or None."""
        identifier = (identifier or '').strip()
        if not identifier:
            return None

        # Exact username always wins (keeps existing logins unambiguous).
        exact = User.objects.filter(username=identifier).first()
        if exact:
            return exact

        # Then username (any case), Faculty ID, Student ID, email - in that order.
        for lookup in (
            Q(username__iexact=identifier),
            Q(instructor__faculty_id__iexact=identifier),
            Q(student__student_id__iexact=identifier),
            Q(email__iexact=identifier),
        ):
            matches = list(User.objects.filter(lookup)[:2])
            if len(matches) == 1:
                return matches[0]
            if len(matches) > 1:
                return None  # ambiguous (e.g. shared email): refuse rather than guess
        return None

    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None:
            username = kwargs.get(User.USERNAME_FIELD)
        if username is None or password is None:
            return None
        user = self.find_user(username)
        if user is None:
            # Same cost as a real check, so response time does not reveal whether the account exists.
            User().set_password(password)
            return None
        if user.check_password(password) and self.user_can_authenticate(user):
            return user
        return None
