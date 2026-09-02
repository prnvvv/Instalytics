# ============================================================
# services/social_analyzer.py
# ============================================================
"""
Social Graph & Follow Analytics calculations, built on top of the
normalized dataset produced by services/parser.py.

Every function here matches the signatures called from routes/social.py:

    get_overview(dataset_id: str) -> dict
    get_relationship_list(
        dataset_id: str, category: str, search: Optional[str],
        sort: str, page: int, limit: int
    ) -> dict
"""

from __future__ import annotations

import logging
import time
from typing import Dict, List, Optional

from utils.helpers import paginate_list
from services.parser import _PRESENT_KEY, get_parsed_dataset

logger = logging.getLogger(__name__)

# Categories that come straight from a single parsed list (no set math).
_DIRECT_CATEGORIES = {
    "followers",
    "following",
    "recently_unfollowed",
    "recent_follow_requests",
    "pending_follow_requests",
    "received_follow_requests",
    "close_friends",
    "hidden_story_from",
}

_VALID_SORTS = {"username_asc", "username_desc", "timestamp_asc", "timestamp_desc"}


class DatasetNotFoundError(Exception):
    """Raised when a dataset_id has no parsed data available."""


def _require_dataset(dataset_id: str) -> Dict[str, List[dict]]:
    dataset = get_parsed_dataset(dataset_id)
    if dataset is None:
        raise DatasetNotFoundError(f"No dataset found for id '{dataset_id}'.")
    return dataset


def _keys(records: List[dict]) -> set:
    return {r["username_key"] for r in records}


def _by_key(records: List[dict]) -> Dict[str, dict]:
    return {r["username_key"]: r for r in records}


# ------------------------------------------------------------------
# Derived relationship sets
# ------------------------------------------------------------------

def _compute_mutuals(followers: List[dict], following: List[dict]) -> List[dict]:
    follower_keys = _keys(followers)
    following_by_key = _by_key(following)
    mutual_keys = follower_keys & set(following_by_key.keys())

    followers_by_key = _by_key(followers)
    results = []
    for key in mutual_keys:
        record = dict(followers_by_key.get(key) or following_by_key.get(key))
        record["category"] = "mutuals"
        results.append(record)
    return results


def _compute_non_followers(followers: List[dict], following: List[dict]) -> List[dict]:
    """People the user follows who do NOT follow them back."""
    follower_keys = _keys(followers)
    results = []
    for record in following:
        if record["username_key"] not in follower_keys:
            new_record = dict(record)
            new_record["category"] = "non_followers"
            results.append(new_record)
    return results


def _compute_not_followed_back(followers: List[dict], following: List[dict]) -> List[dict]:
    """People who follow the user whom the user does NOT follow back."""
    following_keys = _keys(following)
    results = []
    for record in followers:
        if record["username_key"] not in following_keys:
            new_record = dict(record)
            new_record["category"] = "not_followed_back"
            results.append(new_record)
    return results


def _resolve_category_records(dataset: Dict[str, List[dict]], category: str) -> List[dict]:
    if category in _DIRECT_CATEGORIES:
        return dataset.get(category, [])

    followers = dataset.get("followers", [])
    following = dataset.get("following", [])

    if category == "mutuals":
        return _compute_mutuals(followers, following)
    if category == "non_followers":
        return _compute_non_followers(followers, following)
    if category == "not_followed_back":
        return _compute_not_followed_back(followers, following)

    raise ValueError(f"Unknown relationship category: '{category}'")


# ------------------------------------------------------------------
# Overview / statistics
# ------------------------------------------------------------------

def get_overview(dataset_id: str) -> dict:
    start = time.perf_counter()
    logger.info("[Social] Loading dataset...")
    dataset = _require_dataset(dataset_id)
    logger.info("[Social] Dataset loaded")

    followers = dataset.get("followers", [])
    following = dataset.get("following", [])
    logger.info("[Social] Followers: %d", len(followers))
    logger.info("[Social] Following: %d", len(following))

    logger.info("[Social] Calculating relationships...")
    follower_count = len(followers)
    following_count = len(following)

    # Set-based, O(n) — build each key set once, no O(n^2) membership loops.
    follower_keys = {r["username_key"] for r in followers}
    following_keys = {r["username_key"] for r in following}

    mutual_count = len(follower_keys & following_keys)
    non_follower_count = sum(1 for r in following if r["username_key"] not in follower_keys)
    not_followed_back_count = sum(1 for r in followers if r["username_key"] not in following_keys)
    logger.info("[Social] Relationships calculated")

    follow_back_percentage = (
        round((mutual_count / following_count) * 100, 2) if following_count > 0 else 0.0
    )
    follower_following_ratio = (
        round(follower_count / following_count, 2) if following_count > 0 else None
    )

    logger.info("[Social] Overview generated in %.2fs", time.perf_counter() - start)

    return {
        "follower_count": follower_count,
        "following_count": following_count,
        "mutual_count": mutual_count,
        "non_follower_count": non_follower_count,
        "not_followed_back_count": not_followed_back_count,
        "follow_back_percentage": follow_back_percentage,
        "follower_following_ratio": follower_following_ratio,
    }


# ------------------------------------------------------------------
# Search / sort / paginate
# ------------------------------------------------------------------

def _apply_search(records: List[dict], search: Optional[str]) -> List[dict]:
    if not search:
        return records
    needle = search.strip().lower()
    if not needle:
        return records
    return [
        r for r in records
        if needle in (r.get("username") or "").lower()
        or needle in (r.get("name") or "").lower()
    ]


def _apply_sort(records: List[dict], sort: str) -> List[dict]:
    if sort not in _VALID_SORTS:
        sort = "username_asc"

    if sort == "username_asc":
        return sorted(records, key=lambda r: (r.get("username") or "").lower())
    if sort == "username_desc":
        return sorted(records, key=lambda r: (r.get("username") or "").lower(), reverse=True)
    if sort == "timestamp_asc":
        return sorted(records, key=lambda r: (r.get("timestamp") is None, r.get("timestamp") or 0))
    if sort == "timestamp_desc":
        return sorted(
            records,
            key=lambda r: (r.get("timestamp") is None, -(r.get("timestamp") or 0)),
        )
    return records


def _paginate(records: List[dict], page: int, limit: int) -> List[dict]:
    return paginate_list(records, page, limit, max_limit=200)


# ------------------------------------------------------------------
# Public entry point used by routes/social.py
# ------------------------------------------------------------------

def get_relationship_list(
    dataset_id: str,
    category: str,
    search: Optional[str],
    sort: str,
    page: int,
    limit: int,
) -> dict:
    start = time.perf_counter()
    logger.info("[Social] Request: category=%s page=%d limit=%d", category, page, limit)
    logger.info("[Social] Loading dataset...")
    dataset = _require_dataset(dataset_id)
    logger.info("[Social] Dataset loaded")

    # `available` reflects whether the underlying data file was actually
    # present in the upload. Followers/following are always present (a valid
    # export always contains them). Optional categories report False when the
    # corresponding file was never uploaded (as opposed to present but empty).
    present = set(dataset.get(_PRESENT_KEY, []))
    if category in ("followers", "following"):
        available = True
    elif category in _DIRECT_CATEGORIES:
        available = category in present
    else:
        # Derived categories (mutuals, non-followers, not-followed-back)
        # are always computable from followers/following.
        available = True

    logger.info("[Social] Resolving category records: %s", category)
    records = _resolve_category_records(dataset, category)
    logger.info("[Social] Category %s resolved: %d records", category, len(records))

    total_before_filter = len(records)
    filtered = _apply_search(records, search)
    sorted_records = _apply_sort(filtered, sort)
    page_items = _paginate(sorted_records, page, limit)

    # Strip internal-only field before returning.
    clean_items = [
        {
            "username": r.get("username"),
            "name": r.get("name"),
            "profile_url": r.get("profile_url"),
            "timestamp": r.get("timestamp"),
            "category": r.get("category"),
        }
        for r in page_items
    ]

    logger.info("[Social] %s done in %.3fs (total=%d, returned=%d)",
                category, time.perf_counter() - start, len(filtered), len(page_items))

    return {
        "items": clean_items,
        "total": len(filtered),
        "total_unfiltered": total_before_filter,
        "page": page,
        "limit": limit,
        "available": available,
    }