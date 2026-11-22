from __future__ import annotations

import json

from app.modules.parser.models import ConnectionKind
from app.modules.parser.service import parse_export_files
from tests.factories import TS, followers_entry, followers_json, following_entry, following_json


def codes(result) -> list[str]:
    return [i.code for i in result.issues]


def names(accounts: list) -> list[str]:
    return [a.username for a in accounts]


def test_parses_followers_and_following_in_standard_layout() -> None:
    result = parse_export_files(
        {
            "connections/followers_and_following/followers_1.json": followers_json("alice", "bob"),
            "connections/followers_and_following/following.json": following_json("bob", "carol"),
        }
    )
    assert names(result.followers) == ["alice", "bob"]
    assert names(result.following) == ["bob", "carol"]
    assert result.issues == []
    assert {f.kind for f in result.files} == {ConnectionKind.FOLLOWERS, ConnectionKind.FOLLOWING}


def test_account_fields_come_only_from_source() -> None:
    result = parse_export_files({"followers_1.json": followers_json("alice")})
    account = result.followers[0]
    assert account.profile_url == "https://www.instagram.com/alice/"
    assert account.followed_at is not None
    assert int(account.followed_at.timestamp()) == TS
    assert account.source == "followers_1.json"


def test_missing_timestamp_stays_none() -> None:
    data = json.dumps([followers_entry("alice", timestamp=None)]).encode()
    result = parse_export_files({"followers_1.json": data})
    assert result.followers[0].followed_at is None


def test_merges_multiple_follower_files_and_deduplicates() -> None:
    result = parse_export_files(
        {
            "x/followers_1.json": followers_json("alice", "bob"),
            "x/followers_2.json": followers_json("bob", "carol"),
            "x/followers_10.json": followers_json("dave"),
        }
    )
    assert sorted(names(result.followers)) == ["alice", "bob", "carol", "dave"]


def test_case_variants_are_one_account_and_newest_timestamp_wins() -> None:
    data = json.dumps(
        [
            followers_entry("Alice", TS),
            followers_entry("ALICE", TS + 500),
            followers_entry("alice", None),
        ]
    ).encode()
    result = parse_export_files({"followers_1.json": data})
    assert len(result.followers) == 1
    assert int(result.followers[0].followed_at.timestamp()) == TS + 500


def test_username_taken_from_title_when_value_missing() -> None:
    data = json.dumps({"relationships_following": [following_entry("alice")]}).encode()
    assert names(parse_export_files({"following.json": data}).following) == ["alice"]


def test_username_taken_from_href_when_title_and_value_missing() -> None:
    entry = {"title": "", "string_list_data": [{"href": "https://www.instagram.com/_u/zed"}]}
    data = json.dumps({"relationships_following": [entry]}).encode()
    assert names(parse_export_files({"following.json": data}).following) == ["zed"]


def test_older_layout_with_value_in_following() -> None:
    entry = {
        "title": "",
        "string_list_data": [{"href": "https://www.instagram.com/_u/old", "value": "old"}],
    }
    data = json.dumps({"relationships_following": [entry]}).encode()
    assert names(parse_export_files({"following.json": data}).following) == ["old"]


def test_followers_in_wrapper_key_layout() -> None:
    data = json.dumps({"relationships_followers": [followers_entry("alice")]}).encode()
    result = parse_export_files({"followers_and_following/followers.json": data})
    assert names(result.followers) == ["alice"]


def test_discovery_does_not_depend_on_directory_names() -> None:
    result = parse_export_files(
        {
            "my export/anything/followers_1.json": followers_json("alice"),
            "other\\place\\following.json": following_json("bob"),
        }
    )
    assert names(result.followers) == ["alice"]
    assert names(result.following) == ["bob"]


def test_content_inspection_inside_follow_directory() -> None:
    data = json.dumps({"relationships_following": [following_entry("alice")]}).encode()
    result = parse_export_files({"connections/followers_and_following/renamed.json": data})
    assert names(result.following) == ["alice"]


def test_utf8_bom_is_tolerated() -> None:
    result = parse_export_files({"followers_1.json": b"\xef\xbb\xbf" + followers_json("alice")})
    assert names(result.followers) == ["alice"]


def test_unrelated_files_are_ignored_and_the_absence_is_reported() -> None:
    result = parse_export_files(
        {
            "connections/followers_and_following/close_friends.json": json.dumps(
                {"relationships_close_friends": [following_entry("alice")]}
            ).encode(),
            "messages/inbox/thread/message_1.json": b"{not parsed}",
            "followers_1.json.bak": b"nope",
            "__MACOSX/followers_1.json": b"garbage",
            "x/._followers_1.json": b"garbage",
            "following_hashtags.json": b"[]",
        }
    )
    assert result.followers == []
    assert result.following == []
    # Nothing usable was found. This must be loud: silently returning zero would look like success.
    assert codes(result) == ["no_connection_files"]
    assert result.diagnostics.status == "incomplete"
    assert result.files == []


def test_malformed_json_reports_issue_and_continues() -> None:
    result = parse_export_files(
        {"followers_1.json": b"{not json", "followers_2.json": followers_json("alice")}
    )
    assert names(result.followers) == ["alice"]
    assert "invalid_json" in codes(result)
    assert "not json" not in result.issues[0].message
    assert result.diagnostics.status == "incomplete"


def test_invalid_encoding_reports_issue() -> None:
    result = parse_export_files({"followers_1.json": b"\xff\xfe\x00bad"})
    assert "invalid_json" in codes(result)


def test_deeply_nested_json_is_rejected_not_crashed() -> None:
    nested = b"[" * 100_000 + b"]" * 100_000
    result = parse_export_files({"followers_1.json": nested})
    assert "invalid_json" in codes(result)


def test_unexpected_structure_reports_issue() -> None:
    result = parse_export_files({"following.json": b'{"something_else": []}'})
    assert "unexpected_structure" in codes(result)
    result = parse_export_files({"followers_1.json": b'"just a string"'})
    assert "unexpected_structure" in codes(result)


def test_oversized_file_is_skipped_with_issue() -> None:
    result = parse_export_files({"followers_1.json": followers_json("alice")}, max_json_bytes=10)
    assert result.followers == []
    assert "file_too_large" in codes(result)


def test_invalid_entries_are_counted_not_fabricated() -> None:
    entries = [
        followers_entry("alice"),
        {"title": "", "string_list_data": []},
        {
            "title": "",
            "string_list_data": [{"href": "https://evil.example/x", "value": "bad name"}],
        },
        "not-a-dict",
        {"string_list_data": ["not-a-dict"]},
        None,
    ]
    result = parse_export_files({"followers_1.json": json.dumps(entries).encode()})
    assert names(result.followers) == ["alice"]
    report = result.files[0]
    assert report.entries_seen == 6
    assert report.invalid_entries == 5


def test_empty_lists_parse_cleanly() -> None:
    result = parse_export_files(
        {"followers_1.json": b"[]", "following.json": b'{"relationships_following": []}'}
    )
    assert result.followers == [] and result.following == []
    # Empty lists are legitimate data: informational only, so the extraction still counts as complete.
    assert codes(result) == ["empty_list", "empty_list"]
    assert result.diagnostics.appears_complete is True


def test_malicious_usernames_never_become_urls() -> None:
    entries = [
        followers_entry("alice", href="javascript:alert(1)"),
        {"title": "", "string_list_data": [{"value": "<img src=x onerror=alert(1)>"}]},
        {"title": "", "string_list_data": [{"value": "javascript:alert(1)"}]},
    ]
    result = parse_export_files({"followers_1.json": json.dumps(entries).encode()})
    assert names(result.followers) == ["alice"]
    assert result.followers[0].profile_url == "https://www.instagram.com/alice/"


def test_result_serialises_to_camel_case() -> None:
    result = parse_export_files({"followers_1.json": followers_json("alice")})
    dumped = result.model_dump(mode="json", by_alias=True)
    assert set(dumped["followers"][0]) == {"username", "profileUrl", "followedAt", "source"}
    assert "entriesSeen" in dumped["files"][0]
