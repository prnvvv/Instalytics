"""Local-only validation against a real Instagram export.

Skipped unless ``INYX_REFERENCE_DIR`` points at a directory containing an unpacked export. The real data
must never be committed or copied into fixtures. This test deliberately contains no usernames and no
expected totals: it recomputes the totals with an independent, naive traversal of the raw JSON and checks
that the parser agrees with it, so it stays valid for any export and exposes nothing.

    $env:INYX_REFERENCE_DIR = "C:\\path\\to\\reference"; python -m pytest tests/test_reference_export.py -s
"""

from __future__ import annotations

import io
import json
import os
import re
import zipfile
from pathlib import Path

import pytest

from app.modules.parser.models import ConnectionKind
from app.modules.parser.service import parse_export_archive

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
def reference_files() -> list[Path]:
    assert REFERENCE
    return sorted(p for p in Path(REFERENCE).rglob("*") if p.is_file())


@pytest.fixture(scope="module")
def result(reference_files: list[Path]):
    root = Path(REFERENCE or ".")
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in reference_files:
            archive.write(path, path.relative_to(root).as_posix())
    return parse_export_archive(buffer.getvalue())


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

    assert ConnectionKind.FOLLOWERS.value in capsys.readouterr().out
