"""Extracting accounts from the parsed JSON of a followers/following file.

Observed layouts (see docs/parser/instagram-export-format.md)::

    followers_N.json   [ {"title": "", "string_list_data": [{"href", "value", "timestamp"}]} ]
    following.json     {"relationships_following": [ {"title": "<username>",
                           "string_list_data": [{"href", "timestamp"}]} ]}

The username is taken from ``value``, else the entry ``title``, else the ``href`` URL, using the
first one that normalizes to a valid username.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.modules.parser.discovery import WRAPPER_KEYS
from app.modules.parser.models import ConnectionKind, InstagramAccount
from app.modules.parser.normalize import build_profile_url, normalize_username, parse_timestamp


class UnexpectedStructureError(ValueError):
    """The JSON is valid but is not a recognised followers/following layout."""


@dataclass
class ExtractionResult:
    accounts: list[InstagramAccount] = field(default_factory=list)
    entries_seen: int = 0
    invalid_entries: int = 0


def _entries(data: Any, kind: ConnectionKind) -> list[Any]:
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        wrapper_key = next(key for key, value in WRAPPER_KEYS.items() if value is kind)
        entries = data.get(wrapper_key)
        if isinstance(entries, list):
            return entries
    raise UnexpectedStructureError


def _username_for(entry: dict[str, Any], item: dict[str, Any]) -> str | None:
    for candidate in (item.get("value"), entry.get("title"), item.get("href")):
        username = normalize_username(candidate)
        if username is not None:
            return username
    return None


def extract_accounts(data: Any, kind: ConnectionKind, source: str) -> ExtractionResult:
    result = ExtractionResult()
    for entry in _entries(data, kind):
        items = entry.get("string_list_data") if isinstance(entry, dict) else None
        if not isinstance(items, list) or not items:
            result.entries_seen += 1
            result.invalid_entries += 1
            continue
        for item in items:
            result.entries_seen += 1
            username = _username_for(entry, item) if isinstance(item, dict) else None
            if username is None:
                result.invalid_entries += 1
                continue
            result.accounts.append(
                InstagramAccount(
                    username=username,
                    profile_url=build_profile_url(username),
                    followed_at=parse_timestamp(item.get("timestamp")),
                    source=source,
                )
            )
    return result


def deduplicate(accounts: list[InstagramAccount]) -> list[InstagramAccount]:
    """One account per username, in first-seen order.

    If an account appears more than once, the record with the most recent timestamp is kept; a
    record with a timestamp always beats one without.
    """
    best: dict[str, InstagramAccount] = {}
    for account in accounts:
        current = best.get(account.username)
        if current is None or _is_newer(account, current):
            best[account.username] = account
    return list(best.values())


def _is_newer(candidate: InstagramAccount, current: InstagramAccount) -> bool:
    if candidate.followed_at is None:
        return False
    return current.followed_at is None or candidate.followed_at > current.followed_at
