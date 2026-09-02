# ============================================================
# utils/helpers.py
# ============================================================
"""
Small, genuinely reusable utility functions used by services/parser.py
and services/social_analyzer.py.

Nothing Instagram-parsing-specific or social-graph-specific lives here —
only generic normalization, pagination, and timestamp helpers.
"""

from __future__ import annotations

from typing import List, Optional, Tuple, TypeVar

T = TypeVar("T")


# ------------------------------------------------------------------
# Username normalization
# ------------------------------------------------------------------

def normalize_username(username: Optional[str]) -> str:
    """
    Produce a case-insensitive comparison key for an Instagram username.

    The original username (for display) should always be kept separately;
    this function only returns the normalized key.
    """
    if not username:
        return ""
    return username.strip().lower()


# ------------------------------------------------------------------
# Pagination
# ------------------------------------------------------------------

def safe_pagination_bounds(page: int, limit: int, max_limit: int = 200) -> Tuple[int, int]:
    """
    Clamp `page` and `limit` to safe values.

    - page is coerced to at least 1
    - limit is coerced into the range [1, max_limit]

    Returns (page, limit) as the sanitized values to use.
    """
    safe_page = page if isinstance(page, int) and page >= 1 else 1
    safe_limit = limit if isinstance(limit, int) and limit >= 1 else 1
    safe_limit = min(safe_limit, max_limit)
    return safe_page, safe_limit


def paginate_list(items: List[T], page: int, limit: int, max_limit: int = 200) -> List[T]:
    """
    Return the slice of `items` corresponding to `page`/`limit`.

    Handles empty lists and out-of-range pages gracefully by returning
    an empty list rather than raising.
    """
    if not items:
        return []

    safe_page, safe_limit = safe_pagination_bounds(page, limit, max_limit)
    start = (safe_page - 1) * safe_limit
    if start >= len(items):
        return []

    end = start + safe_limit
    return items[start:end]


# ------------------------------------------------------------------
# Timestamps
# ------------------------------------------------------------------

def safe_timestamp(value) -> Optional[int]:
    """
    Safely coerce an Instagram export timestamp into an int, or None
    if it's missing, zero, or otherwise invalid.

    Instagram sometimes omits timestamps, sends them as strings, or
    (rarely) sends 0 as a placeholder — treat all of these as "unknown".
    """
    if value is None:
        return None
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return None
    if ts <= 0:
        return None
    return ts