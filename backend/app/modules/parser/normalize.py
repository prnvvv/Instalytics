"""Username and profile-URL normalization.

Usernames are compared case-insensitively, so the canonical form is lowercase. Only strings that
pass validation are ever turned into profile URLs; this is what keeps imported data from
producing ``javascript:`` or off-site links.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime
from urllib.parse import urlsplit

PROFILE_URL_TEMPLATE = "https://www.instagram.com/{username}/"

# Instagram usernames: 1-30 characters of letters, digits, periods and underscores.
_USERNAME_RE = re.compile(r"[a-z0-9._]{1,30}")
_INSTAGRAM_HOSTS = frozenset({"instagram.com", "www.instagram.com", "m.instagram.com"})
# First path segments that are Instagram routes, never usernames.
_RESERVED_PATHS = frozenset(
    {"p", "reel", "reels", "tv", "stories", "explore", "accounts", "direct", "tags", "web"}
)

# Plausible range for export timestamps: Instagram launched in 2010; cap at 2100.
_MIN_TIMESTAMP = 1_262_304_000
_MAX_TIMESTAMP = 4_102_444_800


def is_valid_username(username: str) -> bool:
    return _USERNAME_RE.fullmatch(username) is not None


def normalize_username(raw: object) -> str | None:
    """Return the canonical username for a username, ``@handle`` or Instagram profile URL.

    Returns ``None`` if the input is not a string or does not contain a valid username.
    """
    if not isinstance(raw, str):
        return None
    text = raw.strip()
    if not text:
        return None

    lowered = text.lower()
    if "://" in lowered or lowered.startswith(("instagram.com/", "www.instagram.com/")):
        candidate = _username_from_url(lowered)
    else:
        candidate = lowered.removeprefix("@").rstrip("/")

    if candidate is None or not is_valid_username(candidate):
        return None
    return candidate


def _username_from_url(url: str) -> str | None:
    if "://" not in url:
        url = f"https://{url}"
    try:
        parts = urlsplit(url)
        hostname = parts.hostname
    except ValueError:
        return None
    if parts.scheme not in {"http", "https"} or hostname not in _INSTAGRAM_HOSTS:
        return None

    segments = [segment for segment in parts.path.split("/") if segment]
    # Exports link followed accounts as /_u/<username>.
    if segments and segments[0] == "_u":
        segments = segments[1:]
    if not segments or segments[0] in _RESERVED_PATHS:
        return None
    return segments[0]


def build_profile_url(username: str) -> str:
    """Build the profile URL for an already-normalized username."""
    if not is_valid_username(username):
        raise ValueError("Invalid Instagram username.")
    return PROFILE_URL_TEMPLATE.format(username=username)


def parse_timestamp(raw: object) -> datetime | None:
    """Convert a Unix timestamp (seconds) to an aware UTC datetime.

    Missing, non-numeric or implausible values return ``None``; nothing is invented.
    """
    if isinstance(raw, bool) or not isinstance(raw, int | float):
        return None
    if not _MIN_TIMESTAMP <= raw <= _MAX_TIMESTAMP:
        return None
    return datetime.fromtimestamp(raw, tz=UTC)
