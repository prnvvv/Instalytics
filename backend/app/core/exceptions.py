"""Application exceptions and the standard error envelope.

Every error response has the shape::

    {"error": {"code": "...", "message": "...", "requestId": "...", "details": [...]}}
"""

from __future__ import annotations

from typing import Any, cast

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.core.logging import request_id_ctx


class AppError(Exception):
    """Base class for errors that are safe to show to API clients."""

    status_code: int = 400
    code: str = "bad_request"

    def __init__(self, message: str, *, details: list[dict[str, Any]] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details


class PayloadTooLargeError(AppError):
    status_code = 413
    code = "payload_too_large"


def error_response(
    status_code: int,
    code: str,
    message: str,
    details: list[dict[str, Any]] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    body: dict[str, Any] = {
        "code": code,
        "message": message,
        "requestId": request_id_ctx.get(),
    }
    if details:
        body["details"] = details
    return JSONResponse({"error": body}, status_code=status_code, headers=headers)


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    error = cast(AppError, exc)
    return error_response(error.status_code, error.code, error.message, error.details)


async def _http_error_handler(_: Request, exc: Exception) -> JSONResponse:
    error = cast(StarletteHTTPException, exc)
    code = {404: "not_found", 405: "method_not_allowed"}.get(error.status_code, "http_error")
    message = error.detail if isinstance(error.detail, str) else "Request failed."
    return error_response(error.status_code, code, message, headers=dict(error.headers or {}))


async def _validation_error_handler(_: Request, exc: Exception) -> JSONResponse:
    error = cast(RequestValidationError, exc)
    # Deliberately drop the "input" field: it would echo user-supplied (possibly sensitive) data.
    details = [
        {"location": [str(part) for part in e["loc"]], "type": e["type"], "message": e["msg"]}
        for e in error.errors()
    ]
    return error_response(422, "validation_error", "Request validation failed.", details)


def register_exception_handlers(app: FastAPI) -> None:
    # Unhandled (500) errors are converted by RequestContextMiddleware so they carry a request ID.
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(StarletteHTTPException, _http_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
