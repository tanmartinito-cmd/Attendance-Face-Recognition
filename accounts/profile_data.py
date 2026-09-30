"""
Read / write a user's personal information in the API's flat shape.

The API (and the frontend forms) use flat keys such as `middle_name`, `current_address`,
`permanent_province` and `languages_spoken` ("English, Filipino"). In the database they are
normalized into user_profiles, user_addresses (one row per kind) and user_languages
(one row per language). These helpers are the only place that translates between the two.
"""
from accounts.models import UserAddress, UserLanguage, UserProfile

# API key -> UserProfile field
PROFILE_FIELDS = {
    'first_name': 'first_name',
    'middle_name': 'middle_name',
    'last_name': 'last_name',
    'gender': 'gender',
    'birth_date': 'birth_date',
    'birth_place': 'birth_place',
    'civil_status': 'civil_status',
    'citizenship': 'citizenship',
    'religion': 'religion',
    'blood_type': 'blood_type',
    'height': 'height',
    'mobile_number': 'mobile_number',
    'telephone': 'telephone',
}

# API key -> (address kind, UserAddress field)
ADDRESS_FIELDS = {
    f'{kind}_{api}': (kind, field)
    for kind in (UserAddress.Kind.CURRENT, UserAddress.Kind.PERMANENT)
    for api, field in (('address', 'street'), ('region', 'region'), ('province', 'province'), ('municipality', 'municipality'))
}

LANGUAGES_KEY = 'languages_spoken'
PERSONAL_KEYS = set(PROFILE_FIELDS) | set(ADDRESS_FIELDS) | {LANGUAGES_KEY}


def get_profile(user):
    """The user's profile, created empty if missing."""
    try:
        return user.profile
    except UserProfile.DoesNotExist:
        return UserProfile.objects.create(user=user)


def _addresses(user):
    cache = getattr(user, '_prefetched_objects_cache', {}).get('addresses')
    rows = cache if cache is not None else user.addresses.all()
    return {row.kind: row for row in rows}


def _languages(user):
    cache = getattr(user, '_prefetched_objects_cache', {}).get('languages')
    rows = cache if cache is not None else user.languages.all()
    return [row.name for row in sorted(rows, key=lambda r: r.pk)]


def read_personal(user):
    """Flat dict of every personal key (empty strings / None when not set)."""
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        profile = None
    data = {key: (getattr(profile, field) if profile else None) for key, field in PROFILE_FIELDS.items()}
    for key, value in data.items():
        if value is None and key != 'birth_date':
            data[key] = ''
    addresses = _addresses(user)
    for key, (kind, field) in ADDRESS_FIELDS.items():
        row = addresses.get(kind)
        data[key] = getattr(row, field) if row else ''
    data[LANGUAGES_KEY] = ', '.join(_languages(user))
    return data


def contact_number(user):
    """Best phone number for display: mobile first, then telephone."""
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        return ''
    return profile.mobile_number or profile.telephone or ''


def photo_url(user):
    try:
        photo = user.profile.photo
    except UserProfile.DoesNotExist:
        return None
    return photo.url if photo else None


def write_personal(user, data):
    """Apply any personal keys present in `data`. Missing keys are left unchanged."""
    profile = get_profile(user)
    changed = []
    for key, field in PROFILE_FIELDS.items():
        if key in data:
            value = data[key]
            if field == 'birth_date':
                value = value or None
            else:
                value = '' if value is None else str(value).strip()
            setattr(profile, field, value)
            changed.append(field)
    if changed:
        profile.save(update_fields=changed)

    by_kind = {}
    for key, (kind, field) in ADDRESS_FIELDS.items():
        if key in data:
            by_kind.setdefault(kind, {})[field] = '' if data[key] is None else str(data[key]).strip()
    for kind, values in by_kind.items():
        UserAddress.objects.update_or_create(user=user, kind=kind, defaults=values)

    if LANGUAGES_KEY in data:
        raw = data[LANGUAGES_KEY]
        names = raw if isinstance(raw, (list, tuple)) else str(raw or '').split(',')
        names = list(dict.fromkeys(n.strip() for n in names if n and n.strip()))
        user.languages.exclude(name__in=names).delete()
        existing = set(user.languages.values_list('name', flat=True))
        UserLanguage.objects.bulk_create([UserLanguage(user=user, name=n) for n in names if n not in existing])
    return profile
