from __future__ import annotations

import logging
from dataclasses import dataclass
from time import time

from django.conf import settings

from sentry.exceptions import InvalidConfiguration
from sentry.utils import redis

logger = logging.getLogger(__name__)


ErrorLimit = float("inf")
DEFAULT_MAX_TTL_SECONDS = 30

rate_limit_info = redis.load_script("ratelimits/api_limiter.lua")


@dataclass
class ConcurrentLimitInfo:
    limit: int
    current_executions: int
    limit_exceeded: bool


class ConcurrentRateLimiter:
    def __init__(self, max_tll_seconds: int = DEFAULT_MAX_TTL_SECONDS) -> None:
        cluster_key = getattr(settings, "SENTRY_RATE_LIMIT_REDIS_CLUSTER", "default")
        self.client = redis.redis_clusters.get(cluster_key)
        self.max_ttl_seconds = max_tll_seconds

    def validate(self) -> None:
        try:
            self.client.ping()
        except Exception as e:
            raise InvalidConfiguration(str(e))

    def namespaced_key(self, key: str) -> str:
        return f"concurrent_limit:{key}"

    def start_request(self, key: str, limit: int, request_uid: str) -> ConcurrentLimitInfo:
        redis_key = self.namespaced_key(key)
        try:
            res = rate_limit_info(
                self.client, [redis_key], [limit, request_uid, time(), self.max_ttl_seconds]
            )
            current_executions, limit_exceeded = res
            return ConcurrentLimitInfo(limit, current_executions, bool(limit_exceeded))
        except Exception:
            logger.exception(
                "Could not start request", dict(key=redis_key, limit=limit, request_uid=request_uid)
            )
            return ConcurrentLimitInfo(limit, -1, False)

    def get_concurrent_requests(self, key: str) -> int:
        redis_key = self.namespaced_key(key)
        # this can fail loudly as it is only meant for observability
        return self.client.zcard(redis_key)

    def finish_request(self, key: str, request_uid: str) -> None:
        try:
            self.client.zrem(self.namespaced_key(key), request_uid)
        except Exception:
            logger.exception("Could not finish request", dict(key=key, request_uid=request_uid))
