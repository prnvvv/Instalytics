from __future__ import annotations

from dataclasses import replace

import pytest

from app.modules.archive.errors import ArchiveError
from app.modules.archive.limits import ArchiveLimits
from app.modules.parser.service import parse_export_archive
from tests.factories import followers_json, following_json, make_zip


def test_parses_followers_and_following_from_zip() -> None:
    data = make_zip(
        {
            "instagram-export/connections/followers_and_following/followers_1.json": followers_json(
                "alice", "bob"
            ),
            "instagram-export/connections/followers_and_following/following.json": following_json(
                "bob", "carol"
            ),
            "instagram-export/media/photo.jpg": b"\xff\xd8",
            "instagram-export/messages/inbox/t/message_1.json": b"{broken but irrelevant",
        }
    )
    result = parse_export_archive(data)
    assert [a.username for a in result.followers] == ["alice", "bob"]
    assert [a.username for a in result.following] == ["bob", "carol"]
    assert result.issues == []


def test_invalid_archive_raises_archive_error() -> None:
    with pytest.raises(ArchiveError):
        parse_export_archive(b"not a zip")


def test_unsafe_archive_is_not_parsed() -> None:
    data = make_zip({"../followers_1.json": followers_json("alice")})
    with pytest.raises(ArchiveError) as exc_info:
        parse_export_archive(data)
    assert exc_info.value.code == "unsafe_path"


def test_oversized_json_member_becomes_issue_and_others_still_parse() -> None:
    big = followers_json(*(f"user{i}" for i in range(200)))
    data = make_zip({"followers_1.json": big, "following.json": following_json("alice")})
    limits = replace(ArchiveLimits(), max_json_bytes=len(big) - 1)
    result = parse_export_archive(data, limits)
    assert [i.code for i in result.issues] == ["file_too_large"]
    assert [a.username for a in result.following] == ["alice"]


def test_archive_without_connection_files_yields_empty_result() -> None:
    result = parse_export_archive(make_zip({"media/photo.jpg": b"\xff"}))
    assert result.followers == [] and result.following == []
    assert result.files == []
