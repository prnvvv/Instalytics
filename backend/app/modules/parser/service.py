"""Parse followers/following data from already-obtained export files.

This module is pure: it knows nothing about HTTP, databases or the filesystem. Callers provide
``{path: bytes}`` (or an archive via :mod:`app.modules.archive`) and receive canonical models plus
diagnostics. Nothing here logs or persists export content, and nothing in the results echoes a
username except the account lists themselves.
"""

from __future__ import annotations

import json
import os
from collections import Counter
from collections.abc import Iterator, Mapping
from pathlib import Path

from app.modules.archive.errors import ArchiveError
from app.modules.archive.limits import ArchiveLimits
from app.modules.archive.paths import normalize_member_path
from app.modules.archive.safe_zip import ArchiveSource, SafeZip
from app.modules.parser.completeness import (
    detect_date_range_limit,
    detect_export_date,
    duplicate_sources,
    missing_parts,
    status_of,
)
from app.modules.parser.discovery import (
    classify,
    is_candidate_path,
    kind_from_filename,
    part_number,
)
from app.modules.parser.extract import UnexpectedStructureError, deduplicate, extract_accounts
from app.modules.parser.models import (
    ConnectionKind,
    DiscoveredFile,
    FileReport,
    InstagramAccount,
    IssueCode,
    ListTotals,
    ParseDiagnostics,
    ParseIssue,
    ParseResult,
    Severity,
)

DEFAULT_MAX_JSON_BYTES = 50 * 1024 * 1024

_KINDS = (ConnectionKind.FOLLOWERS, ConnectionKind.FOLLOWING)


def _issue(
    code: IssueCode, message: str, path: str | None = None, severity: Severity = "warning"
) -> ParseIssue:
    return ParseIssue(code=code, path=path, message=message, severity=severity)


def _totals(
    reports: list[FileReport], collected: list[InstagramAccount], unique: list[InstagramAccount]
) -> ListTotals:
    stamps = [a.followed_at for a in unique if a.followed_at is not None]
    return ListTotals(
        source_files=len(reports),
        records_seen=sum(r.entries_seen for r in reports),
        valid_records=len(collected),
        rejected_records=sum(r.invalid_entries for r in reports),
        duplicates_removed=len(collected) - len(unique),
        unique_accounts=len(unique),
        earliest=min(stamps) if stamps else None,
        latest=max(stamps) if stamps else None,
        with_timestamp=len(stamps),
    )


def parse_export_files(
    files: Mapping[str, bytes],
    *,
    max_json_bytes: int = DEFAULT_MAX_JSON_BYTES,
    source_name: str | None = None,
) -> ParseResult:
    """Parse every followers/following file found in ``files``.

    ``source_name`` (for example ``instagram-<name>-2026-11-22-<id>.zip``) is only used to read the
    export date when no folder in ``files`` carries it.

    Files are found by name anywhere in the mapping. All files of one kind (``followers_1.json``,
    ``followers_2.json``...) are aggregated and de-duplicated. Anything that cannot be read becomes
    an issue instead of being silently dropped, and the diagnostics say whether the extraction
    looks complete.
    """
    collected: dict[ConnectionKind, list[InstagramAccount]] = {k: [] for k in _KINDS}
    reports: list[FileReport] = []
    discovered: list[DiscoveredFile] = []
    issues: list[ParseIssue] = []
    failed_named: set[ConnectionKind] = set()

    def fail(
        path: str, by_name: ConnectionKind | None, code: IssueCode, message: str, note: str
    ) -> None:
        # A named followers/following file that fails costs real data (error). An unknown file in
        # the folder might never have been follower data (warning).
        issues.append(_issue(code, message, path, "error" if by_name else "warning"))
        discovered.append(
            DiscoveredFile(
                path=path,
                role=by_name.value if by_name else "ignored",  # type: ignore[arg-type]
                detected_by="filename" if by_name else "none",
                status="failed",
                note=note,
            )
        )
        if by_name:
            failed_named.add(by_name)

    for raw_path in sorted(files):
        path = normalize_member_path(raw_path)
        if not is_candidate_path(path):
            continue
        by_name = kind_from_filename(path)

        try:
            content = files[raw_path]
        except ArchiveError as exc:
            if exc.code != "entry_too_large":
                raise
            fail(
                path,
                by_name,
                "file_too_large",
                "File exceeds the size limit.",
                "Skipped: too large.",
            )
            continue

        if len(content) > max_json_bytes:
            fail(
                path,
                by_name,
                "file_too_large",
                "File exceeds the size limit.",
                "Skipped: too large.",
            )
            continue

        try:
            data = json.loads(content.decode("utf-8-sig"))
        except (UnicodeDecodeError, ValueError, RecursionError):
            fail(
                path,
                by_name,
                "invalid_json",
                "File is not valid UTF-8 JSON.",
                "Could not be parsed.",
            )
            continue

        kind = classify(path, data)
        if kind is None:
            # A JSON file in the connections folder that is not followers or following data.
            discovered.append(
                DiscoveredFile(
                    path=path,
                    role="ignored",
                    status="ignored",
                    note="Not followers or following data.",
                )
            )
            continue

        try:
            extraction = extract_accounts(data, kind, source_name=path.rsplit("/", 1)[-1])
        except UnexpectedStructureError:
            fail(
                path,
                by_name,
                "unexpected_structure",
                "Unrecognised file structure.",
                "Layout not recognised.",
            )
            continue

        report = FileReport(
            path=path,
            kind=kind,
            detected_by="filename" if by_name is kind else "content",
            schema_name=extraction.schema,
            part=part_number(path) if by_name is kind else None,
            entries_seen=extraction.records_seen,
            accounts_extracted=len(extraction.accounts),
            invalid_entries=extraction.rejected_total,
            rejected_by_reason=dict(extraction.rejected),
            username_sources=dict(extraction.sources),
            conflicting_usernames=extraction.conflicts,
        )
        reports.append(report)
        collected[kind].extend(extraction.accounts)
        summary = f"{extraction.records_seen} records, {len(extraction.accounts)} accounts"
        discovered.append(
            DiscoveredFile(
                path=path,
                role=kind.value,  # type: ignore[arg-type]
                detected_by=report.detected_by,
                status="processed",
                note=f"{summary} ({extraction.schema}).",
            )
        )
        if extraction.records_seen == 0:
            issues.append(_issue("empty_list", "The file contains no records.", path, "info"))

    unique = {kind: deduplicate(collected[kind]) for kind in _KINDS}
    reports_by_kind = {kind: [r for r in reports if r.kind is kind] for kind in _KINDS}
    totals = {
        kind: _totals(reports_by_kind[kind], collected[kind], unique[kind]) for kind in _KINDS
    }

    issues.extend(_completeness_issues(reports, reports_by_kind, failed_named, totals))

    export_date = detect_export_date(files, source_name)
    issues.extend(detect_date_range_limit({k: totals[k] for k in _KINDS}, export_date))
    status, appears_complete = status_of(issues)

    return ParseResult(
        followers=unique[ConnectionKind.FOLLOWERS],
        following=unique[ConnectionKind.FOLLOWING],
        files=reports,
        issues=issues,
        diagnostics=ParseDiagnostics(
            files=discovered,
            followers=totals[ConnectionKind.FOLLOWERS],
            following=totals[ConnectionKind.FOLLOWING],
            export_date=export_date,
            status=status,  # type: ignore[arg-type]
            appears_complete=appears_complete,
        ),
    )


def _completeness_issues(
    reports: list[FileReport],
    reports_by_kind: dict[ConnectionKind, list[FileReport]],
    failed_named: set[ConnectionKind],
    totals: dict[ConnectionKind, ListTotals],
) -> list[ParseIssue]:
    issues: list[ParseIssue] = []
    present = {kind for kind in _KINDS if reports_by_kind[kind] or kind in failed_named}

    if not present:
        issues.append(
            _issue(
                "no_connection_files",
                "No followers or following files were found in this archive.",
                severity="error",
            )
        )
    else:
        for kind, code in (
            (ConnectionKind.FOLLOWERS, "missing_followers_file"),
            (ConnectionKind.FOLLOWING, "missing_following_file"),
        ):
            if kind not in present:
                issues.append(
                    _issue(
                        code,  # type: ignore[arg-type]
                        f"No {kind.value} file was found, so relationship analytics would be "
                        "incomplete.",
                        severity="error",
                    )
                )

    for kind in _KINDS:
        gaps = missing_parts(reports, kind)
        if gaps:
            found = sorted({r.part for r in reports_by_kind[kind] if r.part is not None})
            names = ", ".join(f"{kind.value}_{n}.json" for n in gaps)
            issues.append(
                _issue(
                    "missing_part",
                    f"{names} {'is' if len(gaps) == 1 else 'are'} missing from the numbered parts "
                    f"(found: {', '.join(map(str, found))}). Some {kind.value} are not in this "
                    "archive.",
                    severity="error",
                )
            )

        rejected = Counter[str]()
        for report in reports_by_kind[kind]:
            rejected.update(report.rejected_by_reason)
        if rejected:
            breakdown = ", ".join(
                f"{reason.replace('_', ' ')}: {n}" for reason, n in sorted(rejected.items())
            )
            lost = sum(rejected.values())
            issues.append(
                _issue(
                    "rejected_records",
                    f"{lost} of {totals[kind].records_seen} {kind.value} records could not be "
                    f"read and are not counted ({breakdown}).",
                )
            )

    conflicts = sum(r.conflicting_usernames for r in reports)
    if conflicts:
        issues.append(
            _issue(
                "conflicting_usernames",
                f"{conflicts} records held two different valid usernames; the profile URL was "
                "used.",
                severity="info",
            )
        )

    for (name, _kind), count in sorted(
        duplicate_sources(reports).items(), key=lambda item: item[0][0]
    ):
        issues.append(
            _issue(
                "duplicate_source_files",
                f"{name} appears in {count} places in the archive; duplicate accounts were merged.",
                severity="info",
            )
        )

    return issues


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


def parse_export_archive(
    source: ArchiveSource,
    limits: ArchiveLimits | None = None,
    *,
    source_name: str | None = None,
) -> ParseResult:
    """Validate a ZIP with :class:`SafeZip` and parse the followers/following files inside it.

    ``source_name`` is the archive's file name (taken from ``source`` when that is a path). Real
    Instagram ZIPs have no dated wrapper folder, so the export date is read from this name.

    Raises :class:`ArchiveError` if the archive violates ``limits``. The archive is never
    extracted to disk.
    """
    limits = limits or ArchiveLimits()
    if source_name is None and isinstance(source, str | os.PathLike):
        source_name = Path(source).name
    with SafeZip(source, limits) as archive:
        # Candidate paths include their folders, so a dated root folder name is still found too.
        return parse_export_files(
            _LazyArchiveFiles(archive, limits.max_json_bytes),
            max_json_bytes=limits.max_json_bytes,
            source_name=source_name,
        )
