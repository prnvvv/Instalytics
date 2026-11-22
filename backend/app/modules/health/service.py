from __future__ import annotations

import logging

from redis.asyncio import Redis

from app.modules.health.schemas import CheckStatus, ReadinessResponse

logger = logging.getLogger(__name__)


async def check_redis(client: Redis | None) -> CheckStatus:
    if client is None:
        return "not_configured"
    try:
        await client.ping()
    except Exception as exc:
        # Log only the exception type: details may contain connection strings.
        logger.warning(
            "readiness_check_failed",
            extra={"dependency": "redis", "exc_type": type(exc).__name__},
        )
        return "unavailable"
    return "ok"


async def get_readiness(redis: Redis | None) -> ReadinessResponse:
    checks: dict[str, CheckStatus] = {"redis": await check_redis(redis)}
    healthy = all(value != "unavailable" for value in checks.values())
    return ReadinessResponse(status="ok" if healthy else "unavailable", checks=checks)
