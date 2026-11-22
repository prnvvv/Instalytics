from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings

URL = "/api/v1/analytics/relationships"


def post(client: TestClient, followers: list, following: list):
    return client.post(URL, json={"followers": followers, "following": following})


def u(username: str, **extra: object) -> dict:
    return {"username": username, **extra}


def test_computes_relationships_with_camel_case_output(client: TestClient) -> None:
    response = post(client, [u("alice"), u("bob")], [u("bob"), u("carol")])
    assert response.status_code == 200
    analytics = response.json()["analytics"]
    assert analytics["followersCount"] == 2
    assert analytics["followingCount"] == 2
    assert analytics["mutualCount"] == 1
    assert analytics["followingOnlyCount"] == 1
    assert analytics["followersOnlyCount"] == 1
    assert analytics["uniqueAccountsCount"] == 3
    assert analytics["mutuals"][0]["username"] == "bob"
    assert analytics["mutuals"][0]["profileUrl"] == "https://www.instagram.com/bob/"
    assert analytics["followingOnly"][0]["username"] == "carol"
    assert analytics["followersOnly"][0]["username"] == "alice"
    assert analytics["mutualityRate"] == pytest.approx(100 / 3)


def test_normalizes_urls_handles_and_case(client: TestClient) -> None:
    response = post(
        client,
        [u("@Alice"), u("https://www.instagram.com/bob/")],
        [u("https://www.instagram.com/_u/ALICE"), u("bob/")],
    )
    analytics = response.json()["analytics"]
    assert analytics["mutualCount"] == 2
    assert analytics["followersCount"] == 2


def test_invalid_usernames_are_skipped_and_counted_not_echoed(client: TestClient) -> None:
    response = post(
        client,
        [u("alice"), u("<script>alert(1)</script>"), u("javascript:alert(1)")],
        [u("https://evil.example/x"), u("bob")],
    )
    body = response.json()
    assert body["skippedInvalid"] == {"followers": 2, "following": 1}
    assert "script" not in response.text and "evil.example" not in response.text
    assert body["analytics"]["followersCount"] == 1


def test_empty_lists_return_null_rates(client: TestClient) -> None:
    analytics = post(client, [], []).json()["analytics"]
    assert analytics["mutualityRate"] is None
    assert analytics["followBackRate"] is None
    assert analytics["followerToFollowingRatio"] is None


def test_followed_at_is_passed_through(client: TestClient) -> None:
    response = post(client, [u("alice", followedAt="2024-01-02T03:04:05Z")], [])
    account = response.json()["analytics"]["followersOnly"][0]
    assert account["followedAt"].startswith("2024-01-02T03:04:05")


def test_missing_field_is_validation_error(client: TestClient) -> None:
    response = client.post(URL, json={"followers": []})
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "validation_error"
    assert error["details"][0]["location"] == ["body", "following"]


def test_validation_errors_do_not_echo_input(client: TestClient) -> None:
    response = client.post(URL, json={"followers": "secret_user", "following": []})
    assert response.status_code == 422
    assert "secret_user" not in response.text


def test_unknown_fields_rejected(client: TestClient) -> None:
    response = post(client, [u("alice", messages=["hi"])], [])
    assert response.status_code == 422
    response = client.post(URL, json={"followers": [], "following": [], "cookie": "x"})
    assert response.status_code == 422


def test_wrong_types_rejected(client: TestClient) -> None:
    assert post(client, [u(123)], []).status_code == 422
    assert post(client, [u("a", followedAt="not-a-date")], []).status_code == 422
    assert (
        client.post(
            URL, content=b"{not json", headers={"content-type": "application/json"}
        ).status_code
        == 422
    )


def test_overlong_username_rejected(client: TestClient) -> None:
    assert post(client, [u("a" * 5000)], []).status_code == 422


def test_account_count_limit() -> None:
    app = create_app(make_settings(max_accounts_per_list=2))
    with TestClient(app) as client:
        assert post(client, [u("a"), u("b")], []).status_code == 200
        response = post(client, [u("a"), u("b"), u("c")], [])
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "too_many_accounts"


def test_request_body_size_limit() -> None:
    app = create_app(make_settings(max_request_body_bytes=200))
    with TestClient(app) as client:
        response = post(client, [u(f"user{i}") for i in range(100)], [])
    assert response.status_code == 413


def test_get_not_allowed(client: TestClient) -> None:
    assert client.get(URL).status_code == 405


def test_openapi_documents_endpoint(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    assert URL in schema["paths"]
    assert "/api/v1/health/live" in schema["paths"]
