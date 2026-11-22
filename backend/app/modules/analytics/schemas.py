from __future__ import annotations

from datetime import datetime

from pydantic import ConfigDict, Field

from app.modules.parser.models import InstagramAccount
from app.schemas.base import CamelModel


class RelationshipAnalytics(CamelModel):
    """Follower/following relationship analytics. See docs/analytics/definitions.md.

    Rates are percentages (0-100). A rate or ratio is ``None`` when its denominator is zero:
    it is undefined, not zero.
    """

    followers_count: int
    following_count: int
    unique_accounts_count: int
    mutual_count: int
    following_only_count: int
    followers_only_count: int
    mutuality_rate: float | None
    follow_back_rate: float | None
    follower_to_following_ratio: float | None
    mutuals: list[InstagramAccount]
    following_only: list[InstagramAccount]
    followers_only: list[InstagramAccount]


class AccountInput(CamelModel):
    """An account supplied by the client: a username, ``@handle`` or Instagram profile URL."""

    model_config = ConfigDict(extra="forbid")

    username: str = Field(max_length=2048)
    followed_at: datetime | None = None


class RelationshipRequest(CamelModel):
    model_config = ConfigDict(extra="forbid")

    followers: list[AccountInput]
    following: list[AccountInput]


class SkippedEntries(CamelModel):
    """Counts of entries ignored because they were not valid Instagram usernames."""

    followers: int
    following: int


class RelationshipResponse(CamelModel):
    analytics: RelationshipAnalytics
    skipped_invalid: SkippedEntries
