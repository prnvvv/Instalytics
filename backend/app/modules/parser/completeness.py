"""Deciding whether an extraction looks complete, and saying why not.

Nothing here can know an account's true follower count. It can only notice signals in the export
itself: files that are missing or unreadable, gaps in numbered parts, records that were rejected,
and lists whose dates look cut off by a date range chosen when the export was requested. Each
signal becomes an issue so partial data is never reported as a clean success.
"""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import UTC, date, datetime, timedelta

from app.modules.archive.paths import normalize_member_path
from app.modules.parser.models import (
    ConnectionKind,
    FileReport,
    ListTotals,
    ParseIssue,
    Severity,
)

# Export date range presets Instagram offers, in days (last week, month, 3 months, year).
WINDOWS_DAYS = (7, 30, 90, 365)
# Too few dated accounts say nothing about a date window.
MIN_DATED_ACCOUNTS = 10
# Slack around the window edge: the export date is approximate and the first account lands a few
# days in.
EDGE_SLACK_DAYS = 7
# A list is only suspected of being cut when the other list reaches back at least this far beyond
# the window.
CORROBORATION_DAYS = 14

_EXPORT_FOLDER_DATE = re.compile(r"^instagram-.*?-(\d{4}-\d{2}-\d{2})(?:-[^/]*)?$", re.IGNORECASE)


def detect_export_date(paths: Iterable[str]) -> date | None:
    """The date in an ``instagram-<name>-YYYY-MM-DD-<id>`` folder name (only the date is read)."""
    for path in paths:
        for part in normalize_member_path(path).split("/")[:-1]:
            match = _EXPORT_FOLDER_DATE.match(part)
            if match:
                try:
                    return date.fromisoformat(match.group(1))
                except ValueError:
                    continue
    return None


def missing_parts(reports: Sequence[FileReport], kind: ConnectionKind) -> list[int]:
    """Numbers absent from the sequence of ``<kind>_N.json`` parts (numbering starts at 1)."""
    numbers = {r.part for r in reports if r.kind is kind and r.part is not None}
    if not numbers:
        return []
    return [n for n in range(1, max(numbers) + 1) if n not in numbers]


def duplicate_sources(reports: Sequence[FileReport]) -> dict[tuple[str, ConnectionKind], int]:
    """File names processed from more than one place (for example the export unpacked twice)."""
    counts = Counter((r.path.rsplit("/", 1)[-1].lower(), r.kind) for r in reports)
    return {key: count for key, count in counts.items() if count > 1}


def _as_datetime(value: date) -> datetime:
    return datetime(value.year, value.month, value.day, tzinfo=UTC) + timedelta(days=1)


def detect_date_range_limit(
    totals: dict[ConnectionKind, ListTotals], export_date: date | None
) -> list[ParseIssue]:
    """Flag a list that starts just inside a preset date window while the other goes further back.

    Example: followers start 360 days before the export while following goes back four years. That
    pattern is what an export limited to "last year" produces. It is a heuristic and is reported
    as a warning, never as a certainty.
    """
    issues: list[ParseIssue] = []
    # (earliest, latest) per list, only for lists with enough dated accounts to say anything.
    spans: dict[ConnectionKind, tuple[datetime, datetime]] = {
        kind: (t.earliest, t.latest)
        for kind, t in totals.items()
        if t.earliest is not None
        and t.latest is not None
        and t.with_timestamp >= MIN_DATED_ACCOUNTS
    }
    if len(spans) < 2:
        return issues

    reference = (
        _as_datetime(export_date) if export_date else max(latest for _, latest in spans.values())
    )

    for kind, other_kind in (
        (ConnectionKind.FOLLOWERS, ConnectionKind.FOLLOWING),
        (ConnectionKind.FOLLOWING, ConnectionKind.FOLLOWERS),
    ):
        mine, other = spans[kind][0], spans[other_kind][0]
        age = (reference - mine).days

        for window in WINDOWS_DAYS:
            starts_inside_window = window * 0.85 <= age <= window + EDGE_SLACK_DAYS
            other_reaches_further = (reference - other).days > window + CORROBORATION_DAYS
            if starts_inside_window and other_reaches_further:
                other_age = (reference - other).days
                message = (
                    f"The {kind.value} list only reaches back about {age} days from the export "
                    f"date, while the {other_kind.value} list goes back {other_age} days. That is "
                    f"what an export limited to a date range (for example the last {window} days) "
                    f"looks like, so older {kind.value} may be missing and counts incomplete. "
                    "Compare the total with your Instagram profile, or request the export again "
                    "with the date range set to All time."
                )
                issues.append(
                    ParseIssue(
                        code="possible_date_range_limit", message=message, severity="warning"
                    )
                )
                break
    return issues


def status_of(issues: Iterable[ParseIssue]) -> tuple[str, bool]:
    severities: set[Severity] = {issue.severity for issue in issues}
    if "error" in severities:
        return "incomplete", False
    if "warning" in severities:
        return "warning", False
    return "complete", True
