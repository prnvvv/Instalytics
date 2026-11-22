"""Locating and classifying follower/following files inside an export.

Files are found by *file name*, anywhere in the archive, case-insensitively. The directory layout
and the ZIP root name are never relied on. The patterns are anchored, so look-alikes such as
``recent_follow_requests.json``, ``pending_follow_requests.json`` or ``following_hashtags.json``
never match.

Inside a ``followers_and_following`` folder a differently named JSON file is still inspected, and is
used only if its content carries a known followers/following wrapper key.
"""

from __future__ import annotations

import re
from typing import Any

from app.modules.archive.paths import is_metadata_path, normalize_member_path
from app.modules.parser.models import ConnectionKind

FOLLOW_DIRECTORY = "followers_and_following"

# followers.json, followers_1.json, Followers_12.JSON, followers-2.json ...
_FOLLOWERS_NAME = re.compile(r"followers(?:[_-]?(\d+))?\.json", re.IGNORECASE)
_FOLLOWING_NAME = re.compile(r"following(?:[_-]?(\d+))?\.json", re.IGNORECASE)

# Wrapper keys used by the JSON export. followers_N.json files are usually bare lists instead.
WRAPPER_KEYS: dict[str, ConnectionKind] = {
    "relationships_followers": ConnectionKind.FOLLOWERS,
    "relationships_following": ConnectionKind.FOLLOWING,
}


def _split(path: str) -> tuple[list[str], str]:
    parts = normalize_member_path(path).split("/")
    return [p.lower() for p in parts[:-1]], parts[-1].lower()


def _name_match(path: str) -> tuple[ConnectionKind, int | None] | None:
    _, name = _split(path)
    for kind, pattern in (
        (ConnectionKind.FOLLOWERS, _FOLLOWERS_NAME),
        (ConnectionKind.FOLLOWING, _FOLLOWING_NAME),
    ):
        match = pattern.fullmatch(name)
        if match:
            return kind, int(match.group(1)) if match.group(1) else None
    return None


def kind_from_filename(path: str) -> ConnectionKind | None:
    match = _name_match(path)
    return match[0] if match else None


def part_number(path: str) -> int | None:
    """The N of ``followers_N.json``; ``None`` for ``followers.json`` or non-matching names."""
    match = _name_match(path)
    return match[1] if match else None


def in_follow_directory(path: str) -> bool:
    directories, _ = _split(path)
    return any(directory.startswith(FOLLOW_DIRECTORY) for directory in directories)


def is_candidate_path(path: str) -> bool:
    """Whether the archive member should be read and considered by the parser."""
    if is_metadata_path(path):
        return False
    _, name = _split(path)
    if not name.endswith(".json"):
        return False
    return kind_from_filename(path) is not None or in_follow_directory(path)


def kind_from_content(data: Any) -> ConnectionKind | None:
    if isinstance(data, dict):
        for key, kind in WRAPPER_KEYS.items():
            if key in data:
                return kind
    return None


def classify(path: str, data: Any) -> ConnectionKind | None:
    """Content wrapper keys take precedence over the file name."""
    return kind_from_content(data) or kind_from_filename(path)
