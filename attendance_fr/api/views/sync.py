"""
Live data sync.

GET /api/sync/versions/ -> {"versions": {"academic": 12, "attendance": 40, ...}}

Every database write bumps the version of the data groups it affects (see
core/signals.py -> ResponseCache.invalidate_on_commit). Clients poll this tiny
endpoint; when a group's number changes they silently re-fetch only that data,
so every open screen shows the real database state within seconds.
Contains no data, only counters, so it is safe for every signed-in role.
"""
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from attendance_fr.api.services.response_cache import ResponseCache


class SyncVersionsAPIView(APIView):
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'sync_versions'

    def get(self, request):
        response = Response({'versions': ResponseCache.versions()})
        response['Cache-Control'] = 'no-store'
        return response
