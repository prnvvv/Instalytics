from __future__ import annotations

import time

import pytest

from app.modules.analytics.service import compute_relationships
from app.modules.parser.models import InstagramAccount
from app.modules.parser.normalize import build_profile_url


def acc(username: str, ts: int | None = None) -> InstagramAccount:
    from datetime import UTC, datetime

    return InstagramAccount(
        username=username,
        profile_url=build_profile_url(username),
        followed_at=datetime.fromtimestamp(ts, tz=UTC) if ts else None,
    )


def accs(*names: str) -> list[InstagramAccount]:
    return [acc(n) for n in names]


def names(items: list[InstagramAccount]) -> list[str]:
    return [a.username for a in items]


def test_basic_relationships() -> None:
    result = compute_relationships(accs("a", "b", "c"), accs("b", "c", "d", "e"))
    assert names(result.mutuals) == ["b", "c"]
    assert names(result.following_only) == ["d", "e"]  # G - F: you follow, they don't
    assert names(result.followers_only) == ["a"]  # F - G: they follow, you don't
    assert result.followers_count == 3
    assert result.following_count == 4
    assert result.mutual_count == 2
    assert result.following_only_count == 2
    assert result.followers_only_count == 1
    assert result.unique_accounts_count == 5


def test_metrics() -> None:
    result = compute_relationships(accs("a", "b", "c"), accs("b", "c", "d", "e"))
    assert result.mutuality_rate == pytest.approx(2 / 5 * 100)
    assert result.follow_back_rate == pytest.approx(2 / 4 * 100)
    assert result.follower_to_following_ratio == pytest.approx(3 / 4)


def test_partition_invariants() -> None:
    result = compute_relationships(accs(*"abcdef"), accs(*"defghi"))
    assert result.mutual_count + result.followers_only_count == result.followers_count
    assert result.mutual_count + result.following_only_count == result.following_count
    assert (
        result.mutual_count + result.followers_only_count + result.following_only_count
        == result.unique_accounts_count
    )


def test_both_empty_gives_none_rates_not_zero() -> None:
    result = compute_relationships([], [])
    assert result.unique_accounts_count == 0
    assert result.mutuality_rate is None
    assert result.follow_back_rate is None
    assert result.follower_to_following_ratio is None
    assert result.mutuals == [] and result.following_only == [] and result.followers_only == []


def test_empty_following() -> None:
    result = compute_relationships(accs("a", "b"), [])
    assert result.follow_back_rate is None
    assert result.follower_to_following_ratio is None
    assert result.mutuality_rate == 0.0
    assert names(result.followers_only) == ["a", "b"]


def test_empty_followers() -> None:
    result = compute_relationships([], accs("a", "b"))
    assert result.follower_to_following_ratio == 0.0
    assert result.follow_back_rate == 0.0
    assert names(result.following_only) == ["a", "b"]


def test_duplicates_are_counted_once() -> None:
    result = compute_relationships(accs("a", "a", "b"), accs("a", "a", "a"))
    assert result.followers_count == 2
    assert result.following_count == 1
    assert names(result.mutuals) == ["a"]
    assert result.mutuality_rate == pytest.approx(50.0)


def test_identical_lists_are_fully_mutual() -> None:
    result = compute_relationships(accs("a", "b"), accs("b", "a"))
    assert result.mutuality_rate == 100.0
    assert result.follow_back_rate == 100.0
    assert result.follower_to_following_ratio == 1.0
    assert result.following_only == [] and result.followers_only == []


def test_output_is_sorted_and_deterministic() -> None:
    first = compute_relationships(accs("z", "m", "a"), accs("m", "q", "b"))
    second = compute_relationships(accs("a", "m", "z"), accs("b", "q", "m"))
    assert first == second
    assert names(first.followers_only) == ["a", "z"]


def test_mutuals_use_followers_side_record() -> None:
    result = compute_relationships([acc("a", 1_700_000_000)], [acc("a", 1_600_000_000)])
    assert result.mutuals[0].followed_at is not None
    assert int(result.mutuals[0].followed_at.timestamp()) == 1_700_000_000


def test_profile_urls_are_validated_links() -> None:
    result = compute_relationships(accs("alice"), [])
    assert result.followers_only[0].profile_url == "https://www.instagram.com/alice/"


def test_large_dataset_performance() -> None:
    followers = accs(*(f"user{i}" for i in range(0, 60_000)))
    following = accs(*(f"user{i}" for i in range(30_000, 90_000)))
    started = time.perf_counter()
    result = compute_relationships(followers, following)
    elapsed = time.perf_counter() - started
    assert result.mutual_count == 30_000
    assert result.followers_only_count == 30_000
    assert result.following_only_count == 30_000
    assert elapsed < 5  # generous bound; guards against accidental quadratic behaviour
