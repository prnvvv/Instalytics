from __future__ import annotations

import logging

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.core.config import Settings
from app.core.exceptions import AppError
from app.main import create_app
from tests.conftest import make_settings


def test_unknown_route_uses_error_envelope(client: TestClient) -> None:
    response = client.get("/api/v1/nope")
    assert response.status_code == 404
    error = response.json()["error"]
    assert error["code"] == "not_found"
    assert error["requestId"] == response.headers["X-Request-ID"]


def test_method_not_allowed_envelope(client: TestClient) -> None:
    response = client.post("/api/v1/health/live")
    assert response.status_code == 405
    assert response.json()["error"]["code"] == "method_not_allowed"


def test_security_headers_present(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")
    assert response.headers["X-Content-Type-Options"] == "nosniff"
    assert response.headers["X-Frame-Options"] == "DENY"
    assert response.headers["Cache-Control"] == "no-store"
    assert "default-src 'none'" in response.headers["Content-Security-Policy"]


def test_valid_inbound_request_id_is_echoed(client: TestClient) -> None:
    response = client.get("/api/v1/health/live", headers={"X-Request-ID": "abc-12345678"})
    assert response.headers["X-Request-ID"] == "abc-12345678"


def test_unsafe_inbound_request_id_is_replaced(client: TestClient) -> None:
    response = client.get("/api/v1/health/live", headers={"X-Request-ID": "bad id\twith spaces"})
    assert response.headers["X-Request-ID"] != "bad id\twith spaces"


def _app_with_failing_routes() -> FastAPI:
    app = create_app(make_settings())

    @app.get("/boom")
    async def boom() -> None:
        raise RuntimeError("secret internal detail")

    @app.get("/app-error")
    async def app_error() -> None:
        raise AppError("Custom failure.")

    return app


def test_unhandled_exception_is_sanitised() -> None:
    with TestClient(_app_with_failing_routes(), raise_server_exceptions=False) as client:
        response = client.get("/boom")
    assert response.status_code == 500
    body = response.json()
    assert body["error"]["code"] == "internal_error"
    assert body["error"]["requestId"] == response.headers["X-Request-ID"]
    assert "secret" not in response.text


def test_app_error_maps_to_envelope() -> None:
    with TestClient(_app_with_failing_routes()) as client:
        response = client.get("/app-error")
    assert response.status_code == 400
    assert response.json()["error"]["message"] == "Custom failure."


def test_oversized_body_rejected_by_content_length() -> None:
    app = create_app(make_settings(max_request_body_bytes=100))
    with TestClient(app) as client:
        response = client.post("/api/v1/health/live", content=b"x" * 500)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"


def test_cors_allows_only_configured_origins() -> None:
    app = create_app(make_settings(cors_origins=["http://localhost:5173"]))
    with TestClient(app) as client:
        allowed = client.get("/api/v1/health/live", headers={"Origin": "http://localhost:5173"})
        denied = client.get("/api/v1/health/live", headers={"Origin": "https://evil.example"})
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "access-control-allow-origin" not in denied.headers


def test_cors_origins_parsed_from_comma_separated_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ORIGINS", "http://a.test, http://b.test")
    assert Settings(_env_file=None).cors_origins == ["http://a.test", "http://b.test"]


def test_wildcard_cors_rejected() -> None:
    with pytest.raises(ValidationError):
        Settings(_env_file=None, cors_origins=["*"])


def test_docs_disabled_in_production() -> None:
    app = create_app(make_settings(app_env="production"))
    with TestClient(app) as client:
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404


def test_docs_available_in_development(client: TestClient) -> None:
    assert client.get("/openapi.json").status_code == 200


def test_request_logs_contain_no_query_string(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        client.get("/api/v1/health/live?username=private_person")
    app_records = [r for r in caplog.records if r.name == "app.request"]
    assert app_records
    assert all("private_person" not in str(r.__dict__) for r in app_records)
    assert app_records[0].__dict__["path"] == "/api/v1/health/live"
