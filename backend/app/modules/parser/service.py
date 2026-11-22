"""Parse followers/following data from already-obtained export files.

This module is pure: it knows nothing about HTTP, databases or the filesystem. Callers provide
``{path: bytes}`` (or an archive via :mod:`app.modules.archive`) and receive canonical models.
Nothing here logs or persists export content.
"""

from __future__ import annotations

import json
from collections.abc import Iterator, Mapping

from app.modules.archive.errors import ArchiveError
from app.modules.archive.limits import ArchiveLimits
from app.modules.archive.paths import normalize_member_path
from app.modules.archive.safe_zip import ArchiveSource, SafeZip
from app.modules.parser.discovery import classify, is_candidate_path
from app.modules.parser.extract import UnexpectedStructureError, deduplicate, extract_accounts
from app.modules.parser.models import (
    ConnectionKind,
    FileReport,
    InstagramAccount,
    ParseIssue,
    ParseResult,
)

DEFAULT_MAX_JSON_BYTES = 50 * 1024 * 1024


def parse_export_files(
    files: Mapping[str, bytes], *, max_json_bytes: int = DEFAULT_MAX_JSON_BYTES
) -> ParseResult:
    """Parse every followers/following file found in ``files``.

    Multiple files of one kind (``followers_1.json``, ``followers_2.json``...) are merged and
    de-duplicated. Malformed files produce issues instead of aborting the whole parse.
    """
    collected: dict[ConnectionKind, list[InstagramAccount]] = {
        ConnectionKind.FOLLOWERS: [],
        ConnectionKind.FOLLOWING: [],
    }
    reports: list[FileReport] = []
    issues: list[ParseIssue] = []

    for raw_path in sorted(files):
        path = normalize_member_path(raw_path)
        if not is_candidate_path(path):
            continue
        try:
            content = files[raw_path]
        except ArchiveError as exc:
            if exc.code != "entry_too_large":
                raise
            issues.append(_issue("file_too_large", path, "File exceeds the size limit."))
            continue

        if len(content) > max_json_bytes:
            issues.append(_issue("file_too_large", path, "File exceeds the size limit."))
            continue
        try:
            data = json.loads(content.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            issues.append(_issue("invalid_json", path, "File is not valid UTF-8 JSON."))
            continue

        kind = classify(path, data)
        if kind is None:
            # A JSON file in the connections folder that is not followers/following (for example
            # close friends); it is outside the scope of this parser.
            continue
        try:
            extracted = extract_accounts(data, kind, source=path.rsplit("/", 1)[-1])
        except UnexpectedStructureError:
            issues.append(_issue("unexpected_structure", path, "Unrecognised file structure."))
            continue

        collected[kind].extend(extracted.accounts)
        reports.append(
            FileReport(
                path=path,
                kind=kind,
                entries_seen=extracted.entries_seen,
                invalid_entries=extracted.invalid_entries,
            )
        )

    return ParseResult(
        followers=deduplicate(collected[ConnectionKind.FOLLOWERS]),
        following=deduplicate(collected[ConnectionKind.FOLLOWING]),
        files=reports,
        issues=issues,
    )


class _LazyArchiveFiles(Mapping[str, bytes]):
    """Reads candidate members on demand so only one file is held in memory at a time."""

    def __init__(self, archive: SafeZip, max_json_bytes: int) -> None:
        self._archive = archive
        self._max_json_bytes = max_json_bytes
        self._paths = [m.path for m in archive.members if is_candidate_path(m.path)]

    def __getitem__(self, path: str) -> bytes:
        return self._archive.read(path, max_bytes=self._max_json_bytes)

    def __iter__(self) -> Iterator[str]:
        return iter(self._paths)

    def __len__(self) -> int:
        return len(self._paths)


def parse_export_archive(source: ArchiveSource, limits: ArchiveLimits | None = None) -> ParseResult:
    """Validate a ZIP with :class:`SafeZip` and parse the followers/following files inside it.

    Raises :class:`ArchiveError` if the archive violates ``limits``. The archive is never
    extracted to disk.
    """
    limits = limits or ArchiveLimits()
    with SafeZip(source, limits) as archive:
        return parse_export_files(
            _LazyArchiveFiles(archive, limits.max_json_bytes), max_json_bytes=limits.max_json_bytes
        )


def _issue(code: str, path: str, message: str) -> ParseIssue:
    return ParseIssue(code=code, path=path, message=message)  # type: ignore[arg-type]
