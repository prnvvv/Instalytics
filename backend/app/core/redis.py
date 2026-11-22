"""Redis integration boundary.

Redis is optional at this stage: no feature depends on it yet. When ``REDIS_URL`` is set, a client
is created at startup (lazy connection) and the readiness probe verifies connectivity. Future
caching, rate limiting and queue code should obtain the client through ``get_redis``.
"""

from __future__ import annotations

from fastapi import Request
from redis.asyncio import Redis

from app.core.config import Settings


def create_redis_client(settings: Settings) -> Redis | None:
    if not settings.redis_url:
        return None
    return Redis.from_url(
        settings.redis_url,
        socket_connect_timeout=settings.redis_timeout_seconds,
        socket_timeout=settings.redis_timeout_seconds,
        decode_responses=True,
    )


def get_redis(request: Request) -> Redis | None:
    """FastAPI dependency returning the shared Redis client, or ``None`` if not configured."""
    return request.app.state.redis
