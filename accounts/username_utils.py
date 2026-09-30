import re


def sanitize_username(value: str) -> str:
    """Characters allowed in a login username (Django's username rules)."""
    return re.sub(r'[^\w.@+-]', '', str(value or '').strip())


def username_from_student_id(student_id: str, exclude_user_id: int | None = None) -> str:
    """Login username equals the student ID (sanitized); a numeric suffix avoids clashes."""
    from accounts.models import User

    base = sanitize_username(student_id) or 'student'
    username, suffix = base, 2
    qs = User.objects.all()
    if exclude_user_id:
        qs = qs.exclude(pk=exclude_user_id)
    while qs.filter(username=username).exists():
        username = f'{base}_{suffix}'
        suffix += 1
    return username
