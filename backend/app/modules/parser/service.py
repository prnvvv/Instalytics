"""Parse followers/following data from already-obtained export files.

This module is pure: it knows nothing about HTTP, databases or the filesystem. Callers provide
``{path: bytes}`` (or an archive via :mod:`app.modules.archive`) and receive canonical models.
Nothing here logs or persists export content.
"""

from __future__ import annotations

import json
from collections.abc import Mapping

from app.modules.parser.discovery import (
    classify,
    is_candidate_path,
    normalize_member_path,
)
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
        content = files[raw_path]

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


def _issue(code: str, path: str, message: str) -> ParseIssue:
    return ParseIssue(code=code, path=path, message=message)  # type: ignore[arg-type]
