"""Canonical models produced by the parser."""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Literal

from pydantic import ConfigDict

from app.schemas.base import CamelModel


class InstagramAccount(CamelModel):
    """An account as it appears in an export. Only fields present in the source are populated."""

    model_config = ConfigDict(frozen=True)

    username: str
    profile_url: str
    followed_at: datetime | None = None
    source: str | None = None


class ConnectionKind(StrEnum):
    FOLLOWERS = "followers"
    FOLLOWING = "following"


class ParseIssue(CamelModel):
    """A non-fatal problem. Never contains file contents or usernames."""

    code: Literal["invalid_json", "unexpected_structure", "file_too_large"]
    path: str
    message: str


class FileReport(CamelModel):
    path: str
    kind: ConnectionKind
    entries_seen: int
    invalid_entries: int


class ParseResult(CamelModel):
    followers: list[InstagramAccount]
    following: list[InstagramAccount]
    files: list[FileReport]
    issues: list[ParseIssue]
