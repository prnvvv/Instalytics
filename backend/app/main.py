"""Application entry point: ``uvicorn app.main:app``."""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_v1_router
from app.core.config import Settings, get_settings
from app.core.exceptions import register_exception_handlers
from app.core.logging import configure_logging
from app.core.middleware import BodySizeLimitMiddleware, RequestContextMiddleware
from app.core.redis import create_redis_client

logger = logging.getLogger(__name__)

API_VERSION = "0.1.0"


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, json_logs=settings.log_json)

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.redis = create_redis_client(settings)
        logger.info("startup", extra={"env": settings.app_env})
        try:
            yield
        finally:
            if app.state.redis is not None:
                await app.state.redis.aclose()
            logger.info("shutdown")

    app = FastAPI(
        title=settings.app_name,
        version=API_VERSION,
        description=(
            "Stateless analytics API for Instalytics. The backend never receives Instagram "
            "credentials, and raw Instagram exports are processed client-side by default."
        ),
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None if settings.is_production else "/redoc",
        openapi_url=None if settings.is_production else "/openapi.json",
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.redis = None

    register_exception_handlers(app)
    app.include_router(api_v1_router)

    # Middleware added last runs first: request context wraps everything else.
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_request_body_bytes)
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["Content-Type", "X-Request-ID"],
            allow_credentials=False,
            expose_headers=["X-Request-ID"],
        )
    app.add_middleware(RequestContextMiddleware)
    return app


app = create_app()
