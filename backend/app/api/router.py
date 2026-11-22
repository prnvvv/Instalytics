"""Versioned API router registration."""

from __future__ import annotations

from fastapi import APIRouter

from app.modules.health.router import router as health_router

API_V1_PREFIX = "/api/v1"

api_v1_router = APIRouter(prefix=API_V1_PREFIX)
api_v1_router.include_router(health_router)
