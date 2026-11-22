from __future__ import annotations

import io
import warnings
import zipfile
from dataclasses import replace
from pathlib import Path

import pytest

from app.core.config import Settings
from app.modules.archive.errors import ArchiveError
from app.modules.archive.limits import ArchiveLimits
from app.modules.archive.safe_zip import SafeZip, validate_archive
from tests.factories import followers_json, make_zip

LIMITS = ArchiveLimits()


def code_of(source: bytes, limits: ArchiveLimits = LIMITS) -> str:
    with pytest.raises(ArchiveError) as exc_info:
        validate_archive(source, limits)
    return exc_info.value.code


def zip_with_info(name: str, content: bytes = b"[]", **attrs: int) -> bytes:
    info = zipfile.ZipInfo(name)
    for key, value in attrs.items():
        setattr(info, key, value)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(info, content)
    return buffer.getvalue()


# -- happy path ---------------------------------------------------------------------------------


def test_valid_archive_reports_members() -> None:
    data = make_zip(
        {
            "connections/followers_and_following/followers_1.json": followers_json("alice"),
            "connections/followers_and_following/": b"",
            "media/photo.JPG": b"\xff\xd8",
        }
    )
    report = validate_archive(data)
    assert report.entry_count == 3
    assert {m.path for m in report.members} == {
        "connections/followers_and_following/followers_1.json",
        "media/photo.JPG",
    }


def test_macos_metadata_is_tolerated() -> None:
    data = make_zip({"__MACOSX/._followers_1.json": b"x", ".DS_Store": b"x", "a.json": b"[]"})
    assert validate_archive(data).entry_count == 3


def test_accepts_path_and_file_object_sources(tmp_path: Path) -> None:
    data = make_zip({"followers_1.json": followers_json("alice")})
    archive_path = tmp_path / "export.zip"
    archive_path.write_bytes(data)

    assert validate_archive(archive_path).entry_count == 1
    assert validate_archive(str(archive_path)).entry_count == 1
    stream = io.BytesIO(data)
    assert validate_archive(stream).entry_count == 1
    assert not stream.closed  # caller-owned streams are not closed


def test_read_returns_member_bytes() -> None:
    payload = followers_json("alice")
    with SafeZip(make_zip({"dir/followers_1.json": payload})) as archive:
        assert archive.read("dir/followers_1.json") == payload


# -- malformed archives -------------------------------------------------------------------------


@pytest.mark.parametrize(
    "data", [b"", b"not a zip at all", b"PK\x03\x04" + b"\x00" * 10, b"PK\x05\x06" + b"\x00" * 5]
)
def test_not_a_zip(data: bytes) -> None:
    assert code_of(data) == "not_a_zip"


def test_truncated_archive() -> None:
    data = make_zip({"followers_1.json": followers_json("alice")})
    assert code_of(data[: len(data) // 2]) in {"not_a_zip", "corrupted_archive"}


def test_missing_file_path(tmp_path: Path) -> None:
    with pytest.raises(ArchiveError) as exc_info:
        validate_archive(tmp_path / "missing.zip")
    assert exc_info.value.code == "not_a_zip"


def test_crc_corruption_detected_on_read() -> None:
    data = bytearray(
        make_zip({"a.json": b'["payload-payload-payload"]'}, compression=zipfile.ZIP_STORED)
    )
    data[data.find(b"payload")] ^= 0xFF
    with SafeZip(bytes(data)) as archive, pytest.raises(ArchiveError) as exc_info:
        archive.read("a.json")
    assert exc_info.value.code == "corrupted_archive"


# -- unsafe paths -------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    [
        "../evil.json",
        "a/../../evil.json",
        "/abs/evil.json",
        "C:/evil.json",
        "c:evil.json",
        "a/./b.json",
        "a//b.json",
        "a/\x01b.json",
        "a/b\x7f.json",
        "a/" + "x/" * 25 + "f.json",
        "n" * 300 + ".json",
    ],
)
def test_unsafe_paths_rejected(name: str) -> None:
    assert code_of(zip_with_info(name)) == "unsafe_path"


def test_backslash_traversal_rejected() -> None:
    # Constructed after ZipInfo's own normalisation so the backslashes survive.
    info = zipfile.ZipInfo("placeholder.json")
    info.filename = "..\\..\\evil.json"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(info, b"[]")
    assert code_of(buffer.getvalue()) == "unsafe_path"


def test_duplicate_paths_rejected_case_insensitively() -> None:
    assert code_of(make_zip({"A/b.json": b"[]", "a/B.json": b"[]"})) == "duplicate_entry"


def test_exact_duplicate_entries_rejected() -> None:
    buffer = io.BytesIO()
    with warnings.catch_warnings(), zipfile.ZipFile(buffer, "w") as archive:
        warnings.simplefilter("ignore")
        archive.writestr("a.json", b"[]")
        archive.writestr("a.json", b"[1]")
    assert code_of(buffer.getvalue()) == "duplicate_entry"


# -- file types / entry kinds ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "name",
    ["run.exe", "script.py", "nested.zip", "payload.js", "noextension", ".hidden", "x.json.exe"],
)
def test_unexpected_file_types_rejected(name: str) -> None:
    assert code_of(make_zip({name: b"x"})) == "unsupported_file_type"


def test_encrypted_entries_rejected() -> None:
    data = bytearray(make_zip({"a.json": b"[]"}))
    central = data.find(b"PK\x01\x02")
    data[central + 8] |= 0x1  # general-purpose flag bit 0 = encrypted
    assert code_of(bytes(data)) == "encrypted_entry"


def test_symlinks_rejected() -> None:
    data = zip_with_info("link.json", b"/etc/passwd", create_system=3, external_attr=0o120777 << 16)
    assert code_of(data) == "symlink_entry"


# -- resource limits ----------------------------------------------------------------------------


def test_archive_size_limit() -> None:
    data = make_zip({"a.json": b"[]"})
    assert code_of(data, replace(LIMITS, max_archive_bytes=len(data) - 1)) == "archive_too_large"
    assert validate_archive(data, replace(LIMITS, max_archive_bytes=len(data))).entry_count == 1


def test_entry_count_limit() -> None:
    data = make_zip({f"f{i}.json": b"[]" for i in range(6)})
    assert code_of(data, replace(LIMITS, max_entries=5)) == "too_many_entries"
    assert validate_archive(data, replace(LIMITS, max_entries=6)).entry_count == 6


def test_forged_entry_count_rejected_before_parsing_directory() -> None:
    data = bytearray(make_zip({"a.json": b"[]"}))
    eocd = data.rfind(b"PK\x05\x06")
    data[eocd + 10 : eocd + 12] = b"\xff\xff"  # claim 65535 / ZIP64 entries
    assert code_of(bytes(data)) == "too_many_entries"


def test_forged_central_directory_size_rejected() -> None:
    data = bytearray(make_zip({"a.json": b"[]"}))
    eocd = data.rfind(b"PK\x05\x06")
    data[eocd + 12 : eocd + 16] = (500 * 1024 * 1024).to_bytes(4, "little")
    assert code_of(bytes(data)) == "too_many_entries"


def test_single_entry_size_limit() -> None:
    data = make_zip({"a.json": b"x" * 5000})
    assert code_of(data, replace(LIMITS, max_entry_bytes=4999)) == "entry_too_large"


def test_total_size_limit() -> None:
    data = make_zip({"a.json": b"x" * 3000, "b.json": b"y" * 3000})
    assert code_of(data, replace(LIMITS, max_total_bytes=5000)) == "total_too_large"


def test_zip_bomb_detected_by_compression_ratio() -> None:
    bomb = make_zip({"bomb.json": b"\x00" * 5_000_000})
    limits = replace(LIMITS, ratio_check_min_bytes=1_000_000)
    assert code_of(bomb, limits) == "suspicious_compression"


def test_zip_bomb_blocked_by_default_total_limit() -> None:
    bomb = make_zip({"bomb.json": b"\x00" * 5_000_000})
    assert code_of(bomb, replace(LIMITS, max_total_bytes=1_000_000)) == "total_too_large"


def test_many_small_highly_compressible_files_are_not_flagged() -> None:
    data = make_zip({f"f{i}.json": b"[]" * 200 for i in range(20)})
    assert validate_archive(data).entry_count == 20


def test_read_enforces_member_cap() -> None:
    with SafeZip(make_zip({"a.json": b"x" * 5000})) as archive:
        with pytest.raises(ArchiveError) as exc_info:
            archive.read("a.json", max_bytes=100)
        assert exc_info.value.code == "entry_too_large"


def test_read_enforces_cumulative_budget() -> None:
    limits = replace(LIMITS, max_total_bytes=7000)
    with SafeZip(make_zip({"a.json": b"x" * 4000, "b.json": b"y" * 3000}), limits) as archive:
        archive.read("a.json")
        archive.read("b.json")
        with pytest.raises(ArchiveError) as exc_info:
            archive.read("a.json")
    assert exc_info.value.code == "total_too_large"


def test_read_unknown_member() -> None:
    with SafeZip(make_zip({"a.json": b"[]"})) as archive:
        with pytest.raises(ArchiveError) as exc_info:
            archive.read("nope.json")
        assert exc_info.value.code == "member_not_found"


def test_read_after_close_raises() -> None:
    archive = SafeZip(make_zip({"a.json": b"[]"}))
    with archive:
        pass
    with pytest.raises(RuntimeError):
        archive.read("a.json")


def test_error_messages_do_not_echo_member_names() -> None:
    with pytest.raises(ArchiveError) as exc_info:
        validate_archive(make_zip({"secret-user-name.exe": b"x"}))
    assert "secret-user-name" not in exc_info.value.message


def test_limits_from_settings() -> None:
    settings = Settings(_env_file=None, archive_max_entries=7, archive_max_json_bytes=123)
    limits = ArchiveLimits.from_settings(settings)
    assert limits.max_entries == 7
    assert limits.max_json_bytes == 123
