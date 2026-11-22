"""Locating and classifying follower/following files inside an export.

Discovery does not rely on one fixed directory layout. A JSON file is a candidate if its file name
looks like a followers/following file anywhere in the archive, or if it sits in a
``followers_and_following`` directory (where its content is then inspected).
"""

from __future__ import annotations

import re
from typing import Any

from app.modules.archive.paths import is_metadata_path, normalize_member_path
from app.modules.parser.models import ConnectionKind

FOLLOW_DIRECTORY = "followers_and_following"

_FOLLOWERS_NAME = re.compile(r"followers(_\d+)?\.json")
_FOLLOWING_NAME = re.compile(r"following(_\d+)?\.json")

# Wrapper keys used by the JSON export. followers_N.json files are bare lists instead.
WRAPPER_KEYS: dict[str, ConnectionKind] = {
    "relationships_followers": ConnectionKind.FOLLOWERS,
    "relationships_following": ConnectionKind.FOLLOWING,
}


def _split(path: str) -> tuple[list[str], str]:
    parts = normalize_member_path(path).split("/")
    return [p.lower() for p in parts[:-1]], parts[-1].lower()


def kind_from_filename(path: str) -> ConnectionKind | None:
    _, name = _split(path)
    if _FOLLOWERS_NAME.fullmatch(name):
        return ConnectionKind.FOLLOWERS
    if _FOLLOWING_NAME.fullmatch(name):
        return ConnectionKind.FOLLOWING
    return None


def is_candidate_path(path: str) -> bool:
    """Whether the archive member should be read and considered by the parser."""
    if is_metadata_path(path):
        return False
    directories, name = _split(path)
    if not name.endswith(".json"):
        return False
    return kind_from_filename(path) is not None or FOLLOW_DIRECTORY in directories


def kind_from_content(data: Any) -> ConnectionKind | None:
    if isinstance(data, dict):
        for key, kind in WRAPPER_KEYS.items():
            if key in data:
                return kind
    return None


def classify(path: str, data: Any) -> ConnectionKind | None:
    """Content wrapper keys take precedence over the file name."""
    return kind_from_content(data) or kind_from_filename(path)
