from __future__ import annotations

from dataclasses import dataclass

from app.core.config import Settings

# Types that appear in a real Instagram export. Only JSON is ever read; the rest are tolerated so
# a complete export validates, but unknown types (executables, nested archives...) are rejected.
DEFAULT_ALLOWED_EXTENSIONS = frozenset(
    {
        ".json",
        ".html",
        ".htm",
        ".txt",
        ".csv",
        ".jpg",
        ".jpeg",
        ".png",
        ".gif",
        ".webp",
        ".heic",
        ".mp4",
        ".mov",
        ".m4a",
        ".mp3",
        ".aac",
    }
)


@dataclass(frozen=True)
class ArchiveLimits:
    max_archive_bytes: int = 250 * 1024 * 1024
    max_entries: int = 10_000
    max_entry_bytes: int = 200 * 1024 * 1024
    max_total_bytes: int = 1024 * 1024 * 1024
    max_compression_ratio: int = 100
    # The ratio check is skipped for small entries: tiny files legitimately compress very well.
    ratio_check_min_bytes: int = 1024 * 1024
    max_path_length: int = 255
    max_path_depth: int = 20
    max_json_bytes: int = 50 * 1024 * 1024
    allowed_extensions: frozenset[str] = DEFAULT_ALLOWED_EXTENSIONS

    @classmethod
    def from_settings(cls, settings: Settings) -> ArchiveLimits:
        return cls(
            max_archive_bytes=settings.archive_max_bytes,
            max_entries=settings.archive_max_entries,
            max_entry_bytes=settings.archive_max_entry_bytes,
            max_total_bytes=settings.archive_max_total_bytes,
            max_compression_ratio=settings.archive_max_compression_ratio,
            max_json_bytes=settings.archive_max_json_bytes,
        )
