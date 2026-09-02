# ============================================================
# services/parser.py
# ============================================================
"""
Parsing layer for Instagram data exports (Social Graph & Follow Analytics).

Upload flow: routes/upload.py extracts the ZIP, locates the
`connections/followers_and_following/` folder, and calls register_dataset()
to parse the dataset ONCE and cache the normalized result in memory, keyed
by dataset_id. Social Graph endpoints then simply reuse that cached data via
get_parsed_dataset() — they never re-read or re-parse the ZIP on every
request.

A compact best-effort `parsed.json` mirror is written so a process restart
can still reuse previously parsed data. In-memory storage is the primary
read path for the current development version.

All schema-specific parsing (followers_*.json, following.json, and the
label_values-based optional files) is preserved exactly.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

from utils.helpers import normalize_username, safe_timestamp

logger = logging.getLogger(__name__)

# Key under which the set of optional files actually present in an export is
# stored. Uses a leading underscore so it can never collide with a real
# relationship category ("followers", "close_friends", ...).
_PRESENT_KEY = "_present"

# The optional (non-followers/following) relationship categories that may be
# present or absent depending on the export. Used to track file presence so
# clients can distinguish "this optional file was never uploaded" from
# "uploaded but empty".
OPTIONAL_CATEGORIES = ("close_friends", "received_follow_requests",
                       "hidden_story_from", "pending_follow_requests",
                       "recent_follow_requests", "recently_unfollowed")

# Soft cap on the number of parsed datasets kept in memory. When exceeded,
# the least-recently-registered dataset is evicted (the `parsed.json` mirror
# still allows a fast disk reload if it is accessed again). Prevents unbounded
# memory growth on a long-running server that ingests many datasets.
_MAX_CACHED_DATASETS = 25

# In-memory cache of parsed datasets, keyed by dataset_id.
_PARSED_STORE: Dict[str, Dict[str, List[dict]]] = {}
# Where each dataset's raw followers_and_following folder lives (on disk).
_RAW_DIRS: Dict[str, Path] = {}
# Insertion order of dataset_id -> used for simple FIFO eviction.
_INSERTION_ORDER: List[str] = []

UPLOAD_ROOT = Path("uploads")

FOLLOWER_FILE_PREFIX = "followers_"
FOLLOWING_FILE = "following.json"

LABEL_VALUE_FILES = {
    "close_friends.json": "close_friends",
    "follow_requests_you've_received.json": "received_follow_requests",
    "hide_story_from.json": "hidden_story_from",
    "pending_follow_requests.json": "pending_follow_requests",
    "recent_follow_requests.json": "recent_follow_requests",
    "recently_unfollowed_profiles.json": "recently_unfollowed",
}


class ParsingError(Exception):
    """Raised when an Instagram export file is malformed or unreadable."""


# ------------------------------------------------------------------
# Dataset discovery / registration
# ------------------------------------------------------------------

def find_followers_and_following_dir(extracted_root: Path) -> Optional[Path]:
    if not extracted_root.exists():
        return None
    if extracted_root.name == "followers_and_following" and extracted_root.is_dir():
        return extracted_root
    for candidate in extracted_root.rglob("followers_and_following"):
        if candidate.is_dir():
            return candidate
    return None


def register_dataset(dataset_id: str, follow_dir: Path) -> None:
    """Register a dataset and parse it once, caching the normalized result.

    Called from upload.py inside a threadpool. Parses followers/following and
    all optional relationship files, stores the normalized data in the
    in-memory store keyed by dataset_id, and writes a compact best-effort
    `parsed.json` mirror plus a `meta.json` for restart recovery.
    """
    # Registering the same dataset again must not push a duplicate onto the
    # insertion-order queue used for eviction.
    if dataset_id not in _PARSED_STORE:
        _INSERTION_ORDER.append(dataset_id)
    _evict_if_needed()
    _RAW_DIRS[dataset_id] = follow_dir

    logger.info("[Parser] Parsing dataset %s...", dataset_id)
    parsed = _parse_connections_dataset(dataset_id, follow_dir)
    _PARSED_STORE[dataset_id] = parsed
    logger.info("[Parser] Dataset %s parsed and cached (%d followers, %d following)",
                dataset_id, len(parsed.get("followers", [])), len(parsed.get("following", [])))

    dataset_dir = UPLOAD_ROOT / dataset_id
    dataset_dir.mkdir(parents=True, exist_ok=True)

    # Record the raw folder location. Prefer a path relative to the dataset
    # directory when possible; fall back to the absolute path if follow_dir
    # lives outside uploads/ (e.g. synthetic tests). This must never fail,
    # otherwise a later cold-cache request would be unable to resolve the
    # data and fall into a slow full re-parse on the request path.
    try:
        rel = follow_dir.relative_to(dataset_dir).as_posix()
        meta_follow_dir = rel
        meta_is_relative = True
    except ValueError:
        meta_follow_dir = str(follow_dir.resolve())
        meta_is_relative = False
    try:
        (dataset_dir / "meta.json").write_text(
            json.dumps(
                {"follow_dir": meta_follow_dir, "follow_dir_is_relative": meta_is_relative}
            ),
            encoding="utf-8",
        )
    except OSError as exc:
        logger.error("Could not persist dataset registration %s: %s", dataset_id, exc)

    try:
        # Compact mirror (no pretty-print) so the one-time parse stays fast.
        (dataset_dir / "parsed.json").write_text(
            json.dumps(parsed, separators=(",", ":")), encoding="utf-8"
        )
    except OSError as exc:
        logger.error("Could not persist parsed mirror %s: %s", dataset_id, exc)


# ------------------------------------------------------------------
# Cache management (bounded memory + explicit discard)
# ------------------------------------------------------------------

def _evict_if_needed() -> None:
    """Evict the oldest-parsed datasets from memory until under the cap.

    Eviction only drops the in-memory copy; the on-disk `parsed.json` mirror
    for the evicted dataset remains, so a later access can reload it quickly
    via get_parsed_dataset(). This keeps memory bounded on long-running
    servers without a background worker.
    """
    while len(_PARSED_STORE) >= _MAX_CACHED_DATASETS and _INSERTION_ORDER:
        victim = _INSERTION_ORDER.pop(0)
        _PARSED_STORE.pop(victim, None)
        _RAW_DIRS.pop(victim, None)
        logger.info("[Parser] Evicted dataset %s from memory cache (cap=%d)",
                    victim, _MAX_CACHED_DATASETS)


def discard_dataset(dataset_id: str) -> None:
    """Drop a dataset's in-memory parsed data and path records.

    Called when a dataset is deleted (DELETE /api/upload/{dataset_id}) so the
    in-memory store does not retain stale data or grow unboundedly.
    """
    _PARSED_STORE.pop(dataset_id, None)
    _RAW_DIRS.pop(dataset_id, None)
    try:
        _INSERTION_ORDER.remove(dataset_id)
    except ValueError:
        pass


# ------------------------------------------------------------------
# JSON loading
# ------------------------------------------------------------------

def _load_json_file(path: Path) -> Any:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise ParsingError(f"Could not read file '{path.name}': {exc}") from exc

    if not raw.strip():
        raise ParsingError(f"File '{path.name}' is empty.")

    try:
        return json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ParsingError(f"File '{path.name}' contains invalid JSON: {exc}") from exc


# ------------------------------------------------------------------
# followers_*.json  →  array → string_list_data → value/href/timestamp
# ------------------------------------------------------------------

def _parse_followers_file(data: Any, category: str = "followers") -> List[dict]:
    """
    followers_*.json shape:
    [
      {
        "title": "",
        "string_list_data": [
          {"href": "...", "value": "username", "timestamp": 1234567890}
        ]
      },
      ...
    ]
    Username comes from string_list_data[0]["value"] — this file is a
    flat array, unlike following.json.
    """
    if not isinstance(data, list):
        raise ParsingError("Expected 'followers' file to contain a JSON array.")

    results: List[dict] = []
    for entry in data:
        if not isinstance(entry, dict):
            continue
        string_list = entry.get("string_list_data") or []
        if not string_list or not isinstance(string_list, list):
            continue
        first = string_list[0] if isinstance(string_list[0], dict) else {}
        username = (first.get("value") or "").strip()
        if not username:
            continue
        results.append(
            {
                "username": username,
                "username_key": normalize_username(username),
                "name": None,
                "profile_url": first.get("href") or None,
                "timestamp": safe_timestamp(first.get("timestamp")),
                "category": category,
            }
        )
    return results


# ------------------------------------------------------------------
# following.json  →  object → relationships_following → title + string_list_data
# ------------------------------------------------------------------

def _parse_following_file(data: Any) -> List[dict]:
    """
    following.json shape:
    {
      "relationships_following": [
        {
          "title": "dhirajkumar_22",
          "string_list_data": [
            {"href": "https://www.instagram.com/_u/dhirajkumar_22", "timestamp": 1788057581}
          ]
        },
        ...
      ]
    }

    IMPORTANT: for following.json the username lives in `title`, NOT in
    string_list_data[0]["value"] — in real exports string_list_data only
    carries `href`/`timestamp` and has NO `value` field at all. So the
    username is taken exclusively from `title`.
    """
    if not isinstance(data, dict):
        raise ParsingError("Expected 'following.json' to contain a JSON object.")

    entries = data.get("relationships_following")
    if entries is None:
        raise ParsingError("'following.json' is missing 'relationships_following'.")
    if not isinstance(entries, list):
        raise ParsingError("'relationships_following' must be a JSON array.")

    results: List[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        username = (entry.get("title") or "").strip()
        if not username:
            continue

        string_list = entry.get("string_list_data") or []
        first = string_list[0] if string_list and isinstance(string_list[0], dict) else {}

        results.append(
            {
                "username": username,
                "username_key": normalize_username(username),
                "name": None,
                "profile_url": first.get("href") or None,
                "timestamp": safe_timestamp(first.get("timestamp")),
                "category": "following",
            }
        )

    if entries and not results:
        raise ParsingError(
            "'following.json' contained entries but no usernames could be "
            "extracted from the 'title' field."
        )

    return results


# ------------------------------------------------------------------
# label_values-based files (close_friends, requests, hidden story, etc.)
# ------------------------------------------------------------------

def _extract_label_value(label_values: List[dict], *labels: str) -> Optional[str]:
    if not isinstance(label_values, list):
        return None
    for item in label_values:
        if not isinstance(item, dict):
            continue
        if item.get("label") in labels:
            value = item.get("value")
            if value:
                return str(value).strip()
    return None


def _parse_label_values_file(data: Any, category: str) -> List[dict]:
    entries = data
    if isinstance(entries, dict):
        list_values = [v for v in entries.values() if isinstance(v, list)]
        entries = list_values[0] if list_values else None

    if not isinstance(entries, list):
        raise ParsingError(f"Could not find a list of entries for category '{category}'.")

    results: List[dict] = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue

        label_values = entry.get("label_values") or []
        username = _extract_label_value(label_values, "Username")
        name = _extract_label_value(label_values, "Name")
        url = _extract_label_value(label_values, "URL", "Value")

        if not username:
            continue

        timestamp = entry.get("timestamp")
        if timestamp is None:
            for item in label_values:
                if isinstance(item, dict) and item.get("label") == "Timestamp":
                    timestamp = item.get("value")
                    break

        results.append(
            {
                "username": username,
                "username_key": normalize_username(username),
                "name": name,
                "profile_url": url,
                "timestamp": safe_timestamp(timestamp),
                "category": category,
            }
        )
    return results


# ------------------------------------------------------------------
# Deduplication (linear, dict/set based — no O(n^2) list searches)
# ------------------------------------------------------------------

def _dedupe_by_username(records: List[dict]) -> List[dict]:
    seen: Dict[str, dict] = {}
    for record in records:
        key = record["username_key"]
        if key not in seen:
            seen[key] = record
    return list(seen.values())


# ------------------------------------------------------------------
# Full parse (runs once at upload time)
# ------------------------------------------------------------------

def _parse_connections_dataset(dataset_id: str, follow_dir: Path) -> Dict[str, List[dict]]:
    """Parse every required file inside follow_dir and return normalized data."""
    if not follow_dir.exists() or not follow_dir.is_dir():
        raise ParsingError(f"'followers_and_following' directory not found at {follow_dir}.")

    parsed: Dict[str, List[dict]] = {
        "followers": [],
        "following": [],
        "close_friends": [],
        "received_follow_requests": [],
        "hidden_story_from": [],
        "pending_follow_requests": [],
        "recent_follow_requests": [],
        "recently_unfollowed": [],
    }
    present: List[str] = []

    follower_files = sorted(follow_dir.glob(f"{FOLLOWER_FILE_PREFIX}*.json"))
    all_followers: List[dict] = []
    for f in follower_files:
        data = _load_json_file(f)
        all_followers.extend(_parse_followers_file(data, category="followers"))
    parsed["followers"] = _dedupe_by_username(all_followers)
    logger.info("[Parser] Parsed %d follower file(s) -> %d unique followers",
                len(follower_files), len(parsed["followers"]))

    following_path = follow_dir / FOLLOWING_FILE
    if following_path.exists():
        data = _load_json_file(following_path)
        parsed["following"] = _dedupe_by_username(_parse_following_file(data))
    logger.info("[Parser] Parsed following.json -> %d unique following", len(parsed["following"]))

    for filename, category in LABEL_VALUE_FILES.items():
        file_path = follow_dir / filename
        if not file_path.exists():
            continue  # optional file missing — leave as empty list
        present.append(category)
        data = _load_json_file(file_path)
        parsed[category] = _dedupe_by_username(_parse_label_values_file(data, category))
    parsed[_PRESENT_KEY] = present
    logger.info("[Parser] Parsed optional relationship files: present=%s", sorted(present))

    return parsed


def _resolve_raw_dir(dataset_id: str) -> Optional[Path]:
    if dataset_id in _RAW_DIRS:
        return _RAW_DIRS[dataset_id]
    dataset_dir = UPLOAD_ROOT / dataset_id
    meta_path = dataset_dir / "meta.json"
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
            rel = meta["follow_dir"]
            if meta.get("follow_dir_is_relative", True):
                _RAW_DIRS[dataset_id] = dataset_dir / rel
            else:
                _RAW_DIRS[dataset_id] = Path(rel)
            return _RAW_DIRS[dataset_id]
        except (OSError, json.JSONDecodeError, KeyError):
            return None
    return None


def get_parsed_dataset(dataset_id: str) -> Optional[Dict[str, List[dict]]]:
    """Return the cached parsed dataset for dataset_id (rapid, no re-parse).

    Resolution order:
      1. In-memory cache (primary -- data parsed once at upload).
      2. Compact parsed.json mirror (fast recovery after a process restart).

    A full re-parse of the raw export is intentionally NOT performed on this
    read path. Re-parsing can take many seconds on a real-large dataset and
    would block the request (hanging the overview/list endpoints behind the
    Dev Tunnel gateway timeout). Because register_dataset() always writes the
    parsed.json mirror, a cold cache can recover quickly from disk; if the
    mirror is absent there is nothing to serve so we return None (-> 404)
    rather than stalling the request.
    """
    if dataset_id in _PARSED_STORE:
        return _PARSED_STORE[dataset_id]

    disk_path = UPLOAD_ROOT / dataset_id / "parsed.json"
    if disk_path.exists():
        try:
            logger.info("[Parser] Loading parsed mirror from disk for %s", dataset_id)
            data = json.loads(disk_path.read_text(encoding="utf-8"))
            if dataset_id not in _PARSED_STORE:
                _INSERTION_ORDER.append(dataset_id)
            _evict_if_needed()
            _PARSED_STORE[dataset_id] = data
            logger.info("[Parser] Loaded %d followers, %d following from mirror",
                        len(data.get("followers", [])), len(data.get("following", [])))
            return data
        except (OSError, json.JSONDecodeError) as exc:
            logger.error("[Parser] Could not load parsed mirror %s: %s", dataset_id, exc)
            return None

    logger.warning("[Parser] No cached data or parsed mirror for %s", dataset_id)
    return None
