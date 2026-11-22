from __future__ import annotations

from datetime import UTC, datetime

import pytest

from app.modules.parser.normalize import (
    build_profile_url,
    is_valid_username,
    normalize_username,
    parse_timestamp,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("alice", "alice"),
        ("  Alice  ", "alice"),
        ("@alice", "alice"),
        ("alice/", "alice"),
        ("A.l_i.c3e", "a.l_i.c3e"),
        ("https://www.instagram.com/alice", "alice"),
        ("https://www.instagram.com/alice/", "alice"),
        ("https://instagram.com/Alice?hl=en", "alice"),
        ("https://www.instagram.com/_u/alice", "alice"),
        ("http://m.instagram.com/alice/#top", "alice"),
        ("www.instagram.com/alice", "alice"),
        ("instagram.com/alice/", "alice"),
    ],
)
def test_normalizes_valid_inputs(raw: str, expected: str) -> None:
    assert normalize_username(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        None,
        42,
        "",
        "   ",
        "@",
        "has space",
        "a" * 31,
        "bad/slash",
        "bad<script>",
        "ünïcode",
        "javascript:alert(1)",
        "https://evil.example/alice",
        "https://instagram.com.evil.example/alice",
        "https://www.instagram.com/",
        "https://www.instagram.com/p/ABC123/",
        "https://www.instagram.com/explore/",
        "https://www.instagram.com/_u/",
        "ftp://www.instagram.com/alice",
        "https://[::1/alice",
    ],
)
def test_rejects_invalid_inputs(raw: object) -> None:
    assert normalize_username(raw) is None


def test_max_length_username_accepted() -> None:
    assert normalize_username("a" * 30) == "a" * 30


def test_profile_url_built_from_valid_username() -> None:
    assert build_profile_url("alice") == "https://www.instagram.com/alice/"


@pytest.mark.parametrize("bad", ["", "Alice", "a b", "x/../y", "javascript:1"])
def test_profile_url_refuses_unvalidated_username(bad: str) -> None:
    assert not is_valid_username(bad)
    with pytest.raises(ValueError, match="Invalid"):
        build_profile_url(bad)


def test_parse_timestamp_valid() -> None:
    assert parse_timestamp(1_700_000_000) == datetime(2023, 11, 14, 22, 13, 20, tzinfo=UTC)
    assert parse_timestamp(1_700_000_000.0) is not None


@pytest.mark.parametrize("bad", [None, "1700000000", True, 0, -5, 999, 10**12, float("inf")])
def test_parse_timestamp_rejects_missing_or_implausible(bad: object) -> None:
    assert parse_timestamp(bad) is None
