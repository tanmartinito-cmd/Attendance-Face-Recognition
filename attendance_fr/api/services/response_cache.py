"""Safe, backend-only response caching for authenticated API reads.

Keys are versioned by logical data group and caller scope. Writes bump a small
version key, so stale values become unreachable immediately without wildcard
cache deletion or any frontend refresh behavior.
"""
from hashlib import sha256
from django.core.cache import cache
from django.db import transaction


class ResponseCache:
    TTL = {
        'dashboard': 30,
        'academic': 120,
        'attendance': 15,
        'reports': 60,
        'people': 120,  # users / instructors / students (version only; used by live sync)
    }
    VERSION_PREFIX = 'api_response_cache_version:'
    VALUE_PREFIX = 'api_response_cache:'

    @classmethod
    def _version_key(cls, group):
        return f'{cls.VERSION_PREFIX}{group}'

    @classmethod
    def _version(cls, group):
        return cache.get_or_set(cls._version_key(group), 1, timeout=None)

    @classmethod
    def _key(cls, group, scope):
        digest = sha256(str(scope).encode('utf-8')).hexdigest()
        return f'{cls.VALUE_PREFIX}{group}:v{cls._version(group)}:{digest}'

    @classmethod
    def get_or_set(cls, group, scope, factory, ttl=None):
        """Cache a fully authorized, JSON-compatible response payload."""
        key = cls._key(group, scope)
        cached = cache.get(key)
        if cached is not None:
            return cached
        value = factory()
        cache.set(key, value, timeout=ttl or cls.TTL[group])
        return value

    @classmethod
    def invalidate(cls, *groups):
        """Make all existing values in each data group unreachable."""
        for group in set(groups):
            key = cls._version_key(group)
            cache.add(key, 1, timeout=None)
            try:
                cache.incr(key)
            except ValueError:
                cache.set(key, 2, timeout=None)

    @classmethod
    def versions(cls):
        """Current version of every data group. Clients poll this to learn what changed."""
        return {group: cls._version(group) for group in cls.TTL}

    @classmethod
    def invalidate_on_commit(cls, *groups):
        transaction.on_commit(lambda: cls.invalidate(*groups))


def request_scope(request, **extra):
    """Return a role- and filter-safe cache scope for an authenticated request."""
    filters = tuple(sorted((key, value) for key, value in request.query_params.items()))
    return {
        'user_id': request.user.pk,
        'role': request.user.role,
        'filters': filters,
        **extra,
    }
