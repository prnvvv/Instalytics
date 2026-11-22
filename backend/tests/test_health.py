from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings


class FakeRedis:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.closed = False

    async def ping(self) -> bool:
        if self.fail:
            raise ConnectionError("redis://user:secret@internal-host:6379 refused")
        return True

    async def aclose(self) -> None:
        self.closed = True


def test_liveness(client: TestClient) -> None:
    response = client.get("/api/v1/health/live")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_readiness_without_redis_configured(client: TestClient) -> None:
    response = client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "checks": {"redis": "not_configured"}}


def test_readiness_ok_with_healthy_redis() -> None:
    app = create_app(make_settings())
    with TestClient(app) as test_client:
        app.state.redis = FakeRedis()
        response = test_client.get("/api/v1/health/ready")
    assert response.status_code == 200
    assert response.json()["checks"] == {"redis": "ok"}


def test_readiness_503_without_leaking_details() -> None:
    app = create_app(make_settings())
    with TestClient(app) as test_client:
        app.state.redis = FakeRedis(fail=True)
        response = test_client.get("/api/v1/health/ready")
    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "checks": {"redis": "unavailable"}}
    assert "secret" not in response.text
    assert "internal-host" not in response.text


def test_redis_client_closed_on_shutdown() -> None:
    app = create_app(make_settings())
    fake = FakeRedis()
    with TestClient(app):
        app.state.redis = fake
    assert fake.closed is True
