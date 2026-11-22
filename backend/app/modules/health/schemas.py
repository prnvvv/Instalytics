from __future__ import annotations

from typing import Literal

from app.schemas.base import CamelModel

CheckStatus = Literal["ok", "unavailable", "not_configured"]


class LivenessResponse(CamelModel):
    status: Literal["ok"] = "ok"


class ReadinessResponse(CamelModel):
    status: Literal["ok", "unavailable"]
    checks: dict[str, CheckStatus]
