from __future__ import annotations

from typing import Literal

ArchiveErrorCode = Literal[
    "archive_too_large",
    "not_a_zip",
    "corrupted_archive",
    "too_many_entries",
    "unsafe_path",
    "duplicate_entry",
    "encrypted_entry",
    "symlink_entry",
    "unsupported_file_type",
    "unsupported_compression",
    "entry_too_large",
    "total_too_large",
    "suspicious_compression",
    "member_not_found",
]


class ArchiveError(Exception):
    """Raised when an archive fails validation. The message never includes file contents."""

    def __init__(self, code: ArchiveErrorCode, message: str) -> None:
        super().__init__(message)
        self.code: ArchiveErrorCode = code
        self.message = message
