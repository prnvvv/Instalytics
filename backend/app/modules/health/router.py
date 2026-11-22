from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from redis.asyncio import Redis

from app.core.redis import get_redis
from app.modules.health.schemas import LivenessResponse, ReadinessResponse
from app.modules.health.service import get_readiness

router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live", summary="Liveness probe")
async def liveness() -> LivenessResponse:
    """Returns 200 while the process is running. Checks no dependencies."""
    return LivenessResponse()


@router.get(
    "/ready",
    summary="Readiness probe",
    responses={503: {"model": ReadinessResponse, "description": "A dependency is unavailable."}},
)
async def readiness(
    response: Response, redis: Annotated[Redis | None, Depends(get_redis)]
) -> ReadinessResponse:
    """Returns 200 when configured dependencies are reachable, otherwise 503."""
    result = await get_readiness(redis)
    if result.status != "ok":
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return result
