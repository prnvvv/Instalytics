"""Archive member path handling. Member names are untrusted input."""

from __future__ import annotations

import re

from app.modules.archive.errors import ArchiveError
from app.modules.archive.limits import ArchiveLimits

_DRIVE_PREFIX = re.compile(r"[A-Za-z]:")


def normalize_member_path(path: str) -> str:
    """Forward-slash form without a leading slash. Does not make the path safe."""
    return path.replace("\\", "/").lstrip("/")


def is_metadata_path(path: str) -> bool:
    """macOS archive metadata (``__MACOSX/``, ``._*``) and ``.DS_Store`` are never export data."""
    parts = normalize_member_path(path).lower().split("/")
    return "__macosx" in parts[:-1] or parts[-1].startswith("._") or parts[-1] == ".ds_store"


def safe_member_path(name: str, limits: ArchiveLimits) -> str:
    """Validate a member name and return its normalized form, or raise ``ArchiveError``.

    Rejects absolute paths, drive letters, parent-directory references, control characters,
    empty/``.`` components and over-long or over-deep paths. The result is only ever used as a
    lookup key; archives are never extracted to disk.
    """
    if any(ord(char) < 32 or ord(char) == 127 for char in name):
        raise _unsafe()
    unified = name.replace("\\", "/")
    if unified.startswith("/") or _DRIVE_PREFIX.match(unified):
        raise _unsafe()

    parts = unified.split("/")
    if parts and parts[-1] == "":  # directory entries end with a slash
        parts.pop()
    if not parts or any(part in {"", ".", ".."} for part in parts):
        raise _unsafe()
    if len(unified) > limits.max_path_length or len(parts) > limits.max_path_depth:
        raise _unsafe()
    return "/".join(parts)


def _unsafe() -> ArchiveError:
    return ArchiveError("unsafe_path", "Archive contains an unsafe file path.")
