"""ASGI middleware: request IDs, request logging, security headers and body-size limits."""

from __future__ import annotations

import logging
import re
import time
from uuid import uuid4

from starlette.datastructures import Headers, MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.exceptions import PayloadTooLargeError, error_response
from app.core.logging import request_id_ctx

logger = logging.getLogger("app.request")

_SAFE_REQUEST_ID = re.compile(r"[A-Za-z0-9._-]{8,64}")
_DOCS_PREFIXES = ("/docs", "/redoc", "/openapi.json")

_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
}
_API_CSP = "default-src 'none'; frame-ancestors 'none'"


class RequestContextMiddleware:
    """Assigns a request ID, adds security headers, logs request metadata only, and converts
    unhandled exceptions into the standard 500 error envelope."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = Headers(scope=scope).get("x-request-id")
        request_id = incoming if incoming and _SAFE_REQUEST_ID.fullmatch(incoming) else uuid4().hex
        token = request_id_ctx.set(request_id)
        path: str = scope["path"]
        is_docs = path.startswith(_DOCS_PREFIXES)
        started = time.perf_counter()
        status = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status = message["status"]
                headers = MutableHeaders(scope=message)
                headers["X-Request-ID"] = request_id
                for name, value in _SECURITY_HEADERS.items():
                    headers.setdefault(name, value)
                if not is_docs:
                    headers.setdefault("Content-Security-Policy", _API_CSP)
            await send(message)

        try:
            try:
                await self.app(scope, receive, send_wrapper)
            except Exception as exc:
                logger.error("unhandled_exception", extra={"exc_type": type(exc).__name__})
                if response_started:
                    raise
                response = error_response(500, "internal_error", "An unexpected error occurred.")
                await response(scope, receive, send_wrapper)
        finally:
            logger.info(
                "request_completed",
                extra={
                    "method": scope["method"],
                    "path": path,
                    "status": status,
                    "duration_ms": round((time.perf_counter() - started) * 1000, 2),
                },
            )
            request_id_ctx.reset(token)


class BodySizeLimitMiddleware:
    """Rejects request bodies larger than ``max_bytes`` (declared or actually streamed)."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = Headers(scope=scope).get("content-length")
        if declared and declared.isdigit() and int(declared) > self.max_bytes:
            response = error_response(413, "payload_too_large", "Request body is too large.")
            await response(scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise PayloadTooLargeError("Request body is too large.")
            return message

        await self.app(scope, limited_receive, send)
