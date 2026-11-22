"""Local-only validation against a real Instagram export.

Skipped unless ``INYX_REFERENCE_DIR`` points at a directory holding an unpacked export (a folder named like
``instagram-<name>-YYYY-MM-DD-<id>``) and, optionally, the original ``.zip`` beside it. The real data must never
be committed or copied into fixtures. This file contains no usernames and no expected totals: it recomputes
the totals with an independent, naive traversal of the raw JSON and checks that the parser agrees, so it stays
valid for any export and exposes nothing.

    $env:INYX_REFERENCE_DIR = "C:\\path\\to\\reference"; python -m pytest tests/test_reference_export.py -s
"""

from __future__ import annotations

import io
import json
import os
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.modules.parser.service import parse_export_archive, parse_export_files

REFERENCE = os.environ.get("INYX_REFERENCE_DIR")

pytestmark = pytest.mark.skipif(not REFERENCE, reason="INYX_REFERENCE_DIR is not set")

_FOLLOWERS = re.compile(r"followers(_\d+)?\.json", re.IGNORECASE)
_FOLLOWING = re.compile(r"following(_\d+)?\.json", re.IGNORECASE)
_URL_USER = re.compile(r"instagram\.com/(?:_u/)?([^/?#]+)")


def _raw_usernames(path: Path) -> list[str]:
    """A deliberately naive extraction, independent of the parser under test."""
    data = json.loads(path.read_text("utf-8-sig"))
    if isinstance(data, dict):
        data = next(v for v in data.values() if isinstance(v, list))
    found: list[str] = []
    for entry in data:
        for item in entry["string_list_data"]:
            href = item.get("href") or ""
            match = _URL_USER.search(href)
            found.append((match.group(1) if match else item.get("value") or entry["title"]).lower())
    return found


@pytest.fixture(scope="module")
def export_root() -> Path:
    assert REFERENCE
    folders = sorted(p for p in Path(REFERENCE).iterdir() if p.is_dir())
    assert folders, "no unpacked export folder found in INYX_REFERENCE_DIR"
    return folders[0]


@pytest.fixture(scope="module")
def reference_files(export_root: Path) -> list[Path]:
    return sorted(p for p in export_root.rglob("*") if p.is_file())


@pytest.fixture(scope="module")
def real_zip() -> Path | None:
    assert REFERENCE
    return next(iter(sorted(Path(REFERENCE).glob("*.zip"))), None)


@pytest.fixture(scope="module")
def result(export_root: Path, reference_files: list[Path]):
    # Zip the export folder's contents the way Instagram does: paths start at connections/..., no wrapper.
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        for path in reference_files:
            archive.write(path, path.relative_to(export_root).as_posix())
    return parse_export_archive(buffer.getvalue(), source_name=export_root.name + ".zip")


def _raw(reference_files: list[Path], pattern: re.Pattern[str]) -> list[str]:
    names: list[str] = []
    for path in reference_files:
        if pattern.fullmatch(path.name):
            names.extend(_raw_usernames(path))
    return names


def test_totals_match_an_independent_count_of_the_raw_files(reference_files, result) -> None:
    raw_followers = _raw(reference_files, _FOLLOWERS)
    raw_following = _raw(reference_files, _FOLLOWING)

    assert raw_followers and raw_following, "the reference export has no followers/following files"

    followers, following = result.diagnostics.followers, result.diagnostics.following

    assert followers.records_seen == len(raw_followers)
    assert following.records_seen == len(raw_following)
    assert followers.valid_records == len(raw_followers)
    assert following.valid_records == len(raw_following)
    assert followers.rejected_records == following.rejected_records == 0
    assert followers.unique_accounts == len(set(raw_followers)) == len(result.followers)
    assert following.unique_accounts == len(set(raw_following)) == len(result.following)
    assert {a.username for a in result.followers} == set(raw_followers)
    assert {a.username for a in result.following} == set(raw_following)


def test_every_followers_and_following_file_was_processed_and_nothing_else(
    reference_files, result
) -> None:
    expected = {
        p.name.lower()
        for p in reference_files
        if _FOLLOWERS.fullmatch(p.name) or _FOLLOWING.fullmatch(p.name)
    }
    processed = {f.path.rsplit("/", 1)[-1].lower() for f in result.files}

    assert processed == expected
    assert all(f.status == "processed" for f in result.diagnostics.files if f.role != "ignored")
    # Look-alikes such as recent_follow_requests.json were seen but contributed nothing.
    ignored = {
        f.path.rsplit("/", 1)[-1].lower() for f in result.diagnostics.files if f.status == "ignored"
    }
    assert ignored.isdisjoint(expected)


def test_no_file_failed_and_no_records_were_silently_lost(result) -> None:
    assert not [f for f in result.diagnostics.files if f.status == "failed"]
    assert not [i for i in result.issues if i.severity == "error"]
    assert not [i for i in result.issues if i.code == "rejected_records"]


def test_the_export_date_is_read_from_the_archive_name(result, export_root: Path) -> None:
    expected = re.search(r"(\d{4}-\d{2}-\d{2})", export_root.name)

    if expected:
        assert result.diagnostics.export_date is not None
        assert result.diagnostics.export_date.isoformat() == expected.group(1)


def test_the_original_zip_gives_exactly_the_same_result_as_the_unpacked_folder(
    real_zip, result
) -> None:
    if real_zip is None:
        pytest.skip("no original .zip beside the unpacked export")

    direct = parse_export_archive(real_zip)

    assert {a.username for a in direct.followers} == {a.username for a in result.followers}
    assert {a.username for a in direct.following} == {a.username for a in result.following}
    assert direct.diagnostics.status == result.diagnostics.status
    assert [i.code for i in direct.issues] == [i.code for i in result.issues]
    assert direct.diagnostics.export_date == result.diagnostics.export_date


def test_a_date_limited_copy_of_the_real_data_would_be_flagged(
    reference_files, result, export_root: Path
) -> None:
    """Re-create a "last year" export from the real data in memory and check the warning fires."""
    followers_file = next(p for p in reference_files if _FOLLOWERS.fullmatch(p.name))
    following_file = next(p for p in reference_files if _FOLLOWING.fullmatch(p.name))
    export_date = result.diagnostics.export_date

    if export_date is None or result.diagnostics.followers.earliest is None:
        pytest.skip("the reference export has no export date or no dated followers")

    cutoff = datetime(export_date.year, export_date.month, export_date.day, tzinfo=UTC).timestamp()
    cutoff -= 365 * 86400
    earliest_following = result.diagnostics.following.earliest

    if earliest_following is None or earliest_following.timestamp() > cutoff - 60 * 86400:
        pytest.skip("following does not reach back far enough to simulate the truncation")

    followers = json.loads(followers_file.read_text("utf-8-sig"))
    limited = [e for e in followers if e["string_list_data"][0]["timestamp"] >= cutoff]

    if len(limited) < 10 or len(limited) == len(followers):
        pytest.skip("the reference followers cannot be meaningfully truncated")

    truncated = parse_export_files(
        {
            "connections/followers_and_following/followers_1.json": json.dumps(limited).encode(),
            "connections/followers_and_following/following.json": following_file.read_bytes(),
        },
        source_name=export_root.name + ".zip",
    )

    assert "possible_date_range_limit" in [i.code for i in truncated.issues]
    assert truncated.diagnostics.status == "warning"
    # The untouched real data must not trigger the same warning.
    assert "possible_date_range_limit" not in [i.code for i in result.issues]


def test_a_summary_is_printed_without_any_usernames(result, capsys) -> None:
    d = result.diagnostics
    for name, totals in (("followers", d.followers), ("following", d.following)):
        print(
            f"{name}: files={totals.source_files} records={totals.records_seen} "
            f"unique={totals.unique_accounts} duplicates={totals.duplicates_removed} "
            f"rejected={totals.rejected_records} dated={totals.with_timestamp}"
        )
    print(f"status={d.status} appears_complete={d.appears_complete} export_date={d.export_date}")
    for issue in result.issues:
        print(f"[{issue.severity}] {issue.code}")

    assert "followers" in capsys.readouterr().out
