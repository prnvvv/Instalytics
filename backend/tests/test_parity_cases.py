"""Runs the shared parser parity cases (docs/parser/parity-cases.json) against the backend parser.

The frontend runs the very same file in frontend/src/lib/instagram/parity.test.ts, so the two ports of the
parser cannot silently drift apart. All data in the file is synthetic.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.modules.analytics.service import compute_relationships
from app.modules.parser.models import InstagramAccount
from app.modules.parser.normalize import build_profile_url
from app.modules.parser.service import parse_export_files

CASES_FILE = Path(__file__).resolve().parents[2] / "docs" / "parser" / "parity-cases.json"
CASES = json.loads(CASES_FILE.read_text("utf-8"))["cases"]


def encode(value: object) -> bytes:
    if isinstance(value, dict) and set(value) == {"__raw"}:
        return str(value["__raw"]).encode()
    return json.dumps(value).encode()


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_backend_matches_the_shared_expectations(case: dict) -> None:
    result = parse_export_files({path: encode(value) for path, value in case["files"].items()})
    expected = case["expect"]

    assert sorted(a.username for a in result.followers) == sorted(expected["followers"])
    assert sorted(a.username for a in result.following) == sorted(expected["following"])
    assert sorted(i.code for i in result.issues) == sorted(expected["issues"])
    assert result.diagnostics.status == expected["status"]
    assert result.diagnostics.appears_complete is (expected["status"] == "complete")

    for kind in ("followers", "following"):
        for key, want in expected.get("totals", {}).get(kind, {}).items():
            snake = "".join(f"_{c.lower()}" if c.isupper() else c for c in key)
            assert getattr(getattr(result.diagnostics, kind), snake) == want, f"{kind}.{key}"


ANALYTICS = json.loads(CASES_FILE.read_text("utf-8"))["analytics"]


def account(username: str) -> InstagramAccount:
    return InstagramAccount(username=username, profile_url=build_profile_url(username))


@pytest.mark.parametrize("case", ANALYTICS, ids=[c["name"] for c in ANALYTICS])
def test_backend_analytics_matches_the_shared_expectations(case: dict) -> None:
    result = compute_relationships(
        [account(n) for n in case["followers"]], [account(n) for n in case["following"]]
    )
    expected = case["expect"]

    assert result.followers_count == expected["followersCount"]
    assert result.following_count == expected["followingCount"]
    assert result.mutual_count == expected["mutualCount"]
    assert result.following_only_count == expected["notFollowingBackCount"]
    assert result.followers_only_count == expected["fansCount"]
    assert result.unique_accounts_count == expected["uniqueAccountsCount"]
    for actual, key in (
        (result.mutuality_rate, "mutualityRate"),
        (result.follow_back_rate, "followBackRate"),
        (result.follower_to_following_ratio, "followerToFollowingRatio"),
    ):
        assert (
            actual == pytest.approx(expected[key]) if expected[key] is not None else actual is None
        )
    assert [a.username for a in result.mutuals] == expected["mutuals"]
    assert [a.username for a in result.following_only] == expected["notFollowingBack"]
    assert [a.username for a in result.followers_only] == expected["fans"]


def test_the_shared_file_is_valid_and_covers_the_main_scenarios() -> None:
    names = {c["name"] for c in CASES}

    assert len(CASES) >= 15
    assert len(names) == len(CASES), "case names must be unique"
    for needle in (
        "aggregated",
        "gap in numbered parts",
        "look-alike",
        "label_values",
        "malformed",
    ):
        assert any(needle in name for name in names), needle
