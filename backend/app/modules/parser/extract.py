"""Schema-aware extraction of accounts from the parsed JSON of a followers/following file.

Record layouts understood (see docs/parser/instagram-export-format.md):

``string_list_data`` (followers_N.json, following.json)::

    {"title": "<name or empty>",
     "string_list_data": [{"href": "...", "value": "<name>", "timestamp": 1}]}

``label_values`` (the newer layout used by sibling files such as recent_follow_requests.json)::

    {"timestamp": 1, "media": [],
     "label_values": [{"label": "Username", "value": "..."},
                      {"label": "URL", "value": "https://..."}]}

flat records (``{"href": ..., "value": ..., "timestamp": ...}``).

Records are found at the top level (a list, possibly nested lists) or under a wrapper key. A
username is never harvested from arbitrary strings: it must come from a known field and pass
structural validation (a valid Instagram username, or a profile URL on an Instagram host).
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Any

from app.modules.parser.discovery import WRAPPER_KEYS
from app.modules.parser.models import ConnectionKind, InstagramAccount
from app.modules.parser.normalize import build_profile_url, normalize_username, parse_timestamp

_MAX_NESTING = 4
_RECORD_KEYS = frozenset({"string_list_data", "label_values", "href", "value", "username"})


class UnexpectedStructureError(ValueError):
    """The JSON is valid but no recognisable list of records could be located in it."""


@dataclass
class Extraction:
    accounts: list[InstagramAccount] = field(default_factory=list)
    records_seen: int = 0
    rejected: Counter[str] = field(default_factory=Counter)
    sources: Counter[str] = field(default_factory=Counter)
    conflicts: int = 0
    schema: str = "list"

    @property
    def rejected_total(self) -> int:
        return sum(self.rejected.values())


def _looks_like_record(value: Any) -> bool:
    return isinstance(value, dict) and bool(_RECORD_KEYS & value.keys())


def _flatten(items: list[Any], depth: int = 0) -> tuple[list[Any], bool]:
    """Flatten nested lists a few levels deep. Returns the records and whether nesting was found."""
    flat: list[Any] = []
    nested = False
    for item in items:
        if isinstance(item, list) and depth < _MAX_NESTING:
            inner, _ = _flatten(item, depth + 1)
            flat.extend(inner)
            nested = True
        else:
            flat.append(item)
    return flat, nested


def locate_records(data: Any, kind: ConnectionKind) -> tuple[list[Any], str]:
    """Find the list of records in a parsed file and name the layout. Raises if there is none."""
    if isinstance(data, list):
        records, nested = _flatten(data)
        return records, "nested-lists" if nested else "list"

    if isinstance(data, dict):
        wrapper = next(key for key, value in WRAPPER_KEYS.items() if value is kind)
        if wrapper in data:
            if not isinstance(data[wrapper], list):
                raise UnexpectedStructureError
            return _flatten(data[wrapper])[0], f"wrapped:{wrapper}"

        if _looks_like_record(data):
            return [data], "single-record"

        # Unknown wrapper key: accept it only if exactly one list holds record-like items.
        holders = [
            (key, value)
            for key, value in data.items()
            if isinstance(value, list)
            and any(_looks_like_record(item) for item in _flatten(value)[0][:50])
        ]
        if len(holders) == 1:
            key, value = holders[0]
            return _flatten(value)[0], f"wrapped:{key}"

    raise UnexpectedStructureError


def _resolve(candidates: list[tuple[str, Any]]) -> tuple[str, str, bool] | str:
    """Pick the username from candidate fields, first valid one wins.

    Returns ``(username, source_field, conflict)`` or a rejection reason. ``conflict`` is true when
    another field held a different valid username. The profile URL is listed first because it is
    the one value that is structurally validated and is what the app links to.
    """
    valid: list[tuple[str, str]] = []
    saw_text = False
    for source, raw in candidates:
        if isinstance(raw, str) and raw.strip():
            saw_text = True
        username = normalize_username(raw)
        if username is not None:
            valid.append((source, username))

    if not valid:
        return "invalid_username" if saw_text else "no_username"

    source, username = valid[0]
    return username, source, any(other != username for _, other in valid[1:])


def _label_value(label_values: list[Any], *labels: str) -> Any:
    for item in label_values:
        if isinstance(item, dict) and str(item.get("label", "")).strip().lower() in labels:
            return item.get("value")
    return None


def _add(
    out: Extraction,
    candidates: list[tuple[str, Any]],
    timestamp: Any,
    source_name: str,
) -> None:
    resolved = _resolve(candidates)
    if isinstance(resolved, str):
        out.rejected[resolved] += 1
        return

    username, source, conflict = resolved
    out.sources[source] += 1
    out.conflicts += int(conflict)
    out.accounts.append(
        InstagramAccount(
            username=username,
            profile_url=build_profile_url(username),
            followed_at=parse_timestamp(timestamp),
            source=source_name,
        )
    )


def _process_record(record: Any, out: Extraction, source_name: str) -> None:
    if not isinstance(record, dict):
        out.records_seen += 1
        out.rejected["not_a_record"] += 1
        return

    if "string_list_data" in record:
        items = record["string_list_data"]
        if not isinstance(items, list) or not items:
            out.records_seen += 1
            out.rejected["empty_record"] += 1
            return
        for item in items:
            out.records_seen += 1
            if not isinstance(item, dict):
                out.rejected["malformed_item"] += 1
                continue
            _add(
                out,
                [
                    ("profile_url", item.get("href")),
                    ("value", item.get("value")),
                    ("title", record.get("title")),
                ],
                item.get("timestamp", record.get("timestamp")),
                source_name,
            )
        return

    out.records_seen += 1

    if "label_values" in record:
        values = record["label_values"]
        if not isinstance(values, list):
            out.rejected["malformed_record"] += 1
            return
        _add(
            out,
            [
                ("label_url", _label_value(values, "url", "profile url", "link")),
                ("label_username", _label_value(values, "username", "user name")),
            ],
            record.get("timestamp"),
            source_name,
        )
        return

    if _looks_like_record(record):
        _add(
            out,
            [
                ("profile_url", record.get("href")),
                ("value", record.get("value", record.get("username"))),
                ("title", record.get("title")),
            ],
            record.get("timestamp"),
            source_name,
        )
        return

    out.rejected["not_a_record"] += 1


def extract_accounts(data: Any, kind: ConnectionKind, source_name: str) -> Extraction:
    records, schema = locate_records(data, kind)
    out = Extraction(schema=schema)
    for record in records:
        _process_record(record, out, source_name)
    return out


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
