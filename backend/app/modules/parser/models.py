"""Canonical models produced by the parser.

Everything in the diagnostics is counts, file paths and dates. Usernames and file contents never
appear in diagnostics, issues or logs.
"""

from __future__ import annotations

from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from pydantic import ConfigDict, Field

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


IssueCode = Literal[
    # A file could not be read or understood: its accounts are missing from the totals.
    "invalid_json",
    "unexpected_structure",
    "file_too_large",
    # The archive is missing data the analytics need.
    "no_connection_files",
    "missing_followers_file",
    "missing_following_file",
    "missing_part",
    # Data was read but may not be the whole picture.
    "rejected_records",
    "possible_date_range_limit",
    # Informational.
    "empty_list",
    "conflicting_usernames",
    "duplicate_source_files",
]

Severity = Literal["info", "warning", "error"]


class ParseIssue(CamelModel):
    """A problem or observation. Never contains file contents or usernames."""

    code: IssueCode
    path: str | None = None
    message: str
    severity: Severity = "warning"


class FileReport(CamelModel):
    """What was read from one followers/following file."""

    path: str
    kind: ConnectionKind
    # How the file was recognised: its name, or its content inside a followers_and_following folder.
    detected_by: Literal["filename", "content"] = "filename"
    # Record layout found: "list", "nested-lists", "wrapped:<key>" or "single-record".
    schema_name: str = "list"
    # The numeric part of followers_N.json, when the name has one.
    part: int | None = None
    # Records seen in the file, valid or not. entries_seen is kept for compatibility.
    entries_seen: int
    # Accounts successfully extracted (before cross-file de-duplication).
    accounts_extracted: int = 0
    invalid_entries: int
    rejected_by_reason: dict[str, int] = Field(default_factory=dict)
    # Which field each username was taken from: profile_url, value, title, label_username...
    username_sources: dict[str, int] = Field(default_factory=dict)
    # Records where two valid usernames disagreed (the profile URL was used).
    conflicting_usernames: int = 0


class DiscoveredFile(CamelModel):
    """A file the parser looked at, and what it decided."""

    path: str
    role: Literal["followers", "following", "ignored"]
    detected_by: Literal["filename", "content", "none"] = "none"
    status: Literal["processed", "failed", "ignored"]
    note: str | None = None


class ListTotals(CamelModel):
    """Complete totals for one list, computed from everything extracted, never from previews."""

    source_files: int = 0
    records_seen: int = 0
    valid_records: int = 0
    rejected_records: int = 0
    duplicates_removed: int = 0
    unique_accounts: int = 0
    # Range of the dates the export attaches to these accounts, when it has any.
    earliest: datetime | None = None
    latest: datetime | None = None
    with_timestamp: int = 0


class ParseDiagnostics(CamelModel):
    files: list[DiscoveredFile]
    followers: ListTotals
    following: ListTotals
    # The export's date, read from the folder name (instagram-<name>-YYYY-MM-DD-<id>) when present.
    export_date: date | None = None
    status: Literal["complete", "warning", "incomplete"]
    # True only if no warning or error was raised: nothing suggests data is missing.
    appears_complete: bool


class ParseResult(CamelModel):
    followers: list[InstagramAccount]
    following: list[InstagramAccount]
    files: list[FileReport]
    issues: list[ParseIssue]
    diagnostics: ParseDiagnostics
