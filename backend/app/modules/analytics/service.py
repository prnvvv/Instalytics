"""Deterministic relationship analytics over followers (F) and following (G).

Pure functions with no HTTP, database or Redis dependencies. All comparisons use sets of
normalized usernames. Output lists are sorted by username so results are reproducible.
"""

from __future__ import annotations

from collections.abc import Iterable

from app.modules.analytics.schemas import AccountInput, RelationshipAnalytics
from app.modules.parser.extract import deduplicate
from app.modules.parser.models import InstagramAccount
from app.modules.parser.normalize import build_profile_url, normalize_username


def compute_relationships(
    followers: Iterable[InstagramAccount], following: Iterable[InstagramAccount]
) -> RelationshipAnalytics:
    """Compute mutuals, following-only, followers-only and summary metrics.

    Inputs are de-duplicated by username first. For accounts present in both lists, the
    followers-side record is used (its timestamp says when that account followed the user).
    """
    followers_by_name = {a.username: a for a in deduplicate(list(followers))}
    following_by_name = {a.username: a for a in deduplicate(list(following))}
    follower_names = followers_by_name.keys()
    following_names = following_by_name.keys()

    mutual_names = follower_names & following_names  # M = F ∩ G
    following_only_names = following_names - follower_names  # N = G - F
    followers_only_names = follower_names - following_names  # U = F - G
    unique_count = len(follower_names | following_names)  # A = union of F and G

    return RelationshipAnalytics(
        followers_count=len(follower_names),
        following_count=len(following_names),
        unique_accounts_count=unique_count,
        mutual_count=len(mutual_names),
        following_only_count=len(following_only_names),
        followers_only_count=len(followers_only_names),
        mutuality_rate=_percentage(len(mutual_names), unique_count),
        follow_back_rate=_percentage(len(mutual_names), len(following_names)),
        follower_to_following_ratio=_ratio(len(follower_names), len(following_names)),
        mutuals=[followers_by_name[name] for name in sorted(mutual_names)],
        following_only=[following_by_name[name] for name in sorted(following_only_names)],
        followers_only=[followers_by_name[name] for name in sorted(followers_only_names)],
    )


def accounts_from_inputs(inputs: Iterable[AccountInput]) -> tuple[list[InstagramAccount], int]:
    """Normalize client-supplied accounts. Returns the valid accounts and the number skipped."""
    accounts: list[InstagramAccount] = []
    skipped = 0
    for item in inputs:
        username = normalize_username(item.username)
        if username is None:
            skipped += 1
            continue
        accounts.append(
            InstagramAccount(
                username=username,
                profile_url=build_profile_url(username),
                followed_at=item.followed_at,
            )
        )
    return accounts, skipped


def _percentage(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else numerator * 100 / denominator


def _ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else numerator / denominator
