"""Ingestion pipeline tests: discovery, schema detection, accounting, diagnostics and completeness.

Every fixture is synthetic. Never add real export data here.
"""

from __future__ import annotations

import json
from datetime import UTC, date, datetime

import pytest

from app.modules.parser.completeness import detect_export_date
from app.modules.parser.discovery import kind_from_filename, part_number
from app.modules.parser.models import ConnectionKind
from app.modules.parser.service import parse_export_archive, parse_export_files
from tests.factories import TS, followers_entry, following_entry, make_zip


def epoch(year: int, month: int, day: int) -> int:
    return int(datetime(year, month, day, tzinfo=UTC).timestamp())


def encode(data: object) -> bytes:
    return json.dumps(data).encode()


def followers_file(*names: str, base: int = TS) -> bytes:
    return encode([followers_entry(n, base + i) for i, n in enumerate(names)])


def following_file(*names: str, base: int = TS) -> bytes:
    return encode(
        {"relationships_following": [following_entry(n, base + i) for i, n in enumerate(names)]}
    )


def label_entry(username: str, timestamp: int = TS) -> dict:
    return {
        "timestamp": timestamp,
        "media": [],
        "label_values": [
            {"label": "URL", "value": f"https://www.instagram.com/{username}"},
            {"label": "Name", "value": "Display Name"},
            {"label": "Username", "value": username},
        ],
    }


def names(accounts: list) -> list[str]:
    return [a.username for a in accounts]


def codes(result) -> list[str]:
    return [i.code for i in result.issues]


def users(prefix: str, count: int, start: int = 0) -> list[str]:
    return [f"{prefix}{i:04d}" for i in range(start, start + count)]


# -- discovery by file name ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("path", "kind", "part"),
    [
        ("followers.json", ConnectionKind.FOLLOWERS, None),
        ("followers_1.json", ConnectionKind.FOLLOWERS, 1),
        ("followers_12.json", ConnectionKind.FOLLOWERS, 12),
        ("Followers_2.JSON", ConnectionKind.FOLLOWERS, 2),
        ("FOLLOWING.json", ConnectionKind.FOLLOWING, None),
        ("following_1.json", ConnectionKind.FOLLOWING, 1),
        ("followers-3.json", ConnectionKind.FOLLOWERS, 3),
        ("a/b/c/followers_7.json", ConnectionKind.FOLLOWERS, 7),
        ("a\\b\\following.json", ConnectionKind.FOLLOWING, None),
    ],
)
def test_filename_patterns_that_match(path: str, kind: ConnectionKind, part: int | None) -> None:
    assert kind_from_filename(path) is kind
    assert part_number(path) == part


@pytest.mark.parametrize(
    "path",
    [
        "recent_follow_requests.json",
        "pending_follow_requests.json",
        "follow_requests_you've_received.json",
        "recently_unfollowed_profiles.json",
        "recently_unfollowed_accounts.json",
        "close_friends.json",
        "hide_story_from.json",
        "removed_suggestions.json",
        "following_hashtags.json",
        "followers_and_following.json",
        "followers_backup.json",
        "followers_1.json.bak",
        "followers_1.html",
        "my_followers_1.json",
        "followers_1 (1).json",
        "followers_.json",
    ],
)
def test_lookalike_files_never_match(path: str) -> None:
    assert kind_from_filename(path) is None


def test_every_follower_file_is_aggregated_not_just_the_first() -> None:
    result = parse_export_files(
        {
            "e/followers_1.json": followers_file(*users("a", 3)),
            "e/followers_2.json": followers_file(*users("b", 4)),
            "e/followers_3.json": followers_file(*users("c", 5)),
            "e/followers_4.json": followers_file(*users("d", 2)),
            "e/following.json": following_file(*users("f", 6)),
        }
    )

    assert len(result.followers) == 14
    assert len(result.following) == 6
    assert result.diagnostics.followers.source_files == 4
    parts = sorted(r.part for r in result.files if r.kind is ConnectionKind.FOLLOWERS if r.part)
    assert parts == [1, 2, 3, 4]
    assert result.diagnostics.appears_complete is True


def test_multi_digit_parts_are_aggregated_and_gaps_between_them_are_reported() -> None:
    result = parse_export_files(
        {
            "e/followers_1.json": followers_file(*users("a", 2)),
            "e/followers_2.json": followers_file(*users("b", 2)),
            "e/followers_10.json": followers_file(*users("c", 2)),
            "e/following.json": following_file(*users("f", 3)),
        }
    )
    gap = next(i for i in result.issues if i.code == "missing_part")

    assert len(result.followers) == 6  # every file that exists is still counted
    for missing in range(3, 10):
        assert f"followers_{missing}.json" in gap.message
    assert result.diagnostics.status == "incomplete"


def test_lookalike_files_in_the_same_folder_are_not_counted() -> None:
    lookalike = encode([label_entry("zed"), label_entry("yan")])
    result = parse_export_files(
        {
            "c/followers_and_following/followers_1.json": followers_file("alice", "bob"),
            "c/followers_and_following/following.json": following_file("bob"),
            "c/followers_and_following/recent_follow_requests.json": lookalike,
            "c/followers_and_following/pending_follow_requests.json": lookalike,
            "c/followers_and_following/recently_unfollowed_profiles.json": lookalike,
            "c/followers_and_following/close_friends.json": lookalike,
        }
    )

    assert names(result.followers) == ["alice", "bob"]
    assert names(result.following) == ["bob"]
    ignored = [f for f in result.diagnostics.files if f.status == "ignored"]
    assert len(ignored) == 4
    assert all(f.note for f in ignored)


@pytest.mark.parametrize(
    "prefix",
    [
        "",
        "followers_and_following/",
        "connections/followers_and_following/",
        "instagram-someone-2026-01-05-AbCd/connections/followers_and_following/",
        "export/deep/er/nesting/here/",
        "Connections/Followers_And_Following/",
        "your_instagram_activity/connections/followers_and_following/",
        "a b c/d e f/",
    ],
)
def test_folder_names_and_zip_roots_do_not_matter(prefix: str) -> None:
    result = parse_export_archive(
        make_zip(
            {
                f"{prefix}followers_1.json": followers_file("alice", "bob"),
                f"{prefix}following.json": following_file("bob", "carol"),
            }
        )
    )

    assert names(result.followers) == ["alice", "bob"]
    assert names(result.following) == ["bob", "carol"]


def test_archive_with_a_single_wrapping_folder_and_other_content() -> None:
    result = parse_export_archive(
        make_zip(
            {
                "wrapper/connections/followers_and_following/followers_1.json": followers_file(
                    "a1"
                ),
                "wrapper/connections/followers_and_following/following.json": following_file("b1"),
                "wrapper/your_instagram_activity/likes/liked_posts.json": b"{}",
                "wrapper/media/photo.jpg": b"jpeg",
            }
        )
    )

    assert names(result.followers) == ["a1"]
    assert names(result.following) == ["b1"]


# -- schema detection -----------------------------------------------------------------------------


def test_bare_list_schema() -> None:
    result = parse_export_files({"followers_1.json": followers_file("a1", "a2")})

    assert result.files[0].schema_name == "list"


def test_wrapped_schema_with_the_documented_key() -> None:
    result = parse_export_files(
        {"followers_1.json": encode({"relationships_followers": [followers_entry("a1")]})}
    )

    assert names(result.followers) == ["a1"]
    assert result.files[0].schema_name == "wrapped:relationships_followers"


def test_unknown_wrapper_key_is_accepted_when_exactly_one_list_holds_records() -> None:
    data = {
        "version": 2,
        "exported": "x",
        "followers_list": [followers_entry("a1"), followers_entry("a2")],
    }
    result = parse_export_files({"followers_1.json": encode(data)})

    assert names(result.followers) == ["a1", "a2"]
    assert result.files[0].schema_name == "wrapped:followers_list"


def test_ambiguous_wrappers_are_reported_rather_than_guessed() -> None:
    data = {"one": [followers_entry("a1")], "two": [followers_entry("a2")]}
    result = parse_export_files({"followers_1.json": encode(data)})

    assert result.followers == []
    assert "unexpected_structure" in codes(result)


def test_nested_lists_are_flattened() -> None:
    data = [
        [followers_entry("a1"), followers_entry("a2")],
        [followers_entry("a3")],
        followers_entry("a4"),
    ]
    result = parse_export_files({"followers_1.json": encode(data)})

    assert names(result.followers) == ["a1", "a2", "a3", "a4"]
    assert result.files[0].schema_name == "nested-lists"


def test_label_values_schema_in_a_followers_named_file() -> None:
    result = parse_export_files(
        {
            "followers_1.json": encode([label_entry("a1", TS), label_entry("a2", TS + 5)]),
            "following.json": following_file("a2"),
        }
    )

    assert names(result.followers) == ["a1", "a2"]
    assert result.followers[0].followed_at is not None
    assert result.files[0].username_sources == {"label_url": 2}


def test_flat_records_and_a_single_record() -> None:
    flat = encode([{"href": "https://www.instagram.com/a1", "timestamp": TS}, {"username": "a2"}])
    single = encode({"href": "https://www.instagram.com/_u/solo", "timestamp": TS})
    result = parse_export_files({"followers_1.json": flat, "following.json": single})

    assert names(result.followers) == ["a1", "a2"]
    assert names(result.following) == ["solo"]
    assert result.files[1].schema_name == "single-record"


def test_multiple_items_per_record() -> None:
    entry = {
        "title": "",
        "string_list_data": [
            {"href": "https://www.instagram.com/a1", "value": "a1", "timestamp": TS},
            {"href": "https://www.instagram.com/a2", "value": "a2", "timestamp": TS},
        ],
    }
    result = parse_export_files({"followers_1.json": encode([entry])})

    assert names(result.followers) == ["a1", "a2"]
    assert result.files[0].entries_seen == 2


def test_wrapper_without_list_is_an_unexpected_structure() -> None:
    result = parse_export_files({"following.json": encode({"relationships_following": "oops"})})

    assert "unexpected_structure" in codes(result)


# -- username extraction --------------------------------------------------------------------------


def test_username_sources_value_title_and_href() -> None:
    entries = [
        # value only, no href
        {"title": "", "string_list_data": [{"value": "from_value", "timestamp": TS}]},
        # title only
        {"title": "from_title", "string_list_data": [{"timestamp": TS}]},
        # href only, with and without the /_u/ prefix
        {"title": "", "string_list_data": [{"href": "https://www.instagram.com/_u/from_href_u"}]},
        {"title": "", "string_list_data": [{"href": "https://instagram.com/from_href/?hl=en"}]},
        # empty value falls through to the title
        {"title": "after_empty", "string_list_data": [{"value": "", "timestamp": TS}]},
    ]
    result = parse_export_files({"followers_1.json": encode(entries)})

    assert names(result.followers) == [
        "from_value",
        "from_title",
        "from_href_u",
        "from_href",
        "after_empty",
    ]
    sources = result.files[0].username_sources

    assert sources == {"value": 1, "title": 2, "profile_url": 2}


def test_display_names_are_never_mistaken_for_usernames() -> None:
    entries = [
        {"title": "Jane Doe", "string_list_data": [{"value": "Jane Doe"}]},
        {
            "title": "Jane Doe",
            "string_list_data": [
                {"value": "Jane Doe", "href": "https://www.instagram.com/jane.doe"}
            ],
        },
    ]
    result = parse_export_files({"followers_1.json": encode(entries)})

    assert names(result.followers) == ["jane.doe"]
    assert result.files[0].rejected_by_reason == {"invalid_username": 1}


def test_profile_url_wins_when_fields_disagree_and_the_conflict_is_reported() -> None:
    entry = {
        "title": "old_name",
        "string_list_data": [{"href": "https://www.instagram.com/new_name", "value": "old_name"}],
    }
    result = parse_export_files({"followers_1.json": encode([entry])})

    assert names(result.followers) == ["new_name"]
    assert result.files[0].conflicting_usernames == 1
    assert "conflicting_usernames" in codes(result)


def test_urls_that_are_not_profiles_are_rejected() -> None:
    entries = [
        {"title": "", "string_list_data": [{"href": "https://www.instagram.com/p/ABC123/"}]},
        {"title": "", "string_list_data": [{"href": "https://evil.example/alice"}]},
        {"title": "", "string_list_data": [{"href": "javascript:alert(1)"}]},
        {"title": "", "string_list_data": [{"href": "https://www.instagram.com/ok_user"}]},
    ]
    result = parse_export_files({"followers_1.json": encode(entries)})

    assert names(result.followers) == ["ok_user"]
    assert result.files[0].rejected_by_reason == {"invalid_username": 3}


def test_rejection_reasons_are_tracked() -> None:
    entries = [
        followers_entry("good"),
        {"title": "", "string_list_data": []},
        {"title": "", "string_list_data": [{}]},
        {"title": "", "string_list_data": ["not-a-dict"]},
        {"title": "bad name!", "string_list_data": [{"value": "bad name!"}]},
        {"unrelated": True},
        "string",
        None,
        42,
    ]
    result = parse_export_files(
        {"followers_1.json": encode(entries), "following.json": following_file("x")}
    )
    report = result.files[0]

    assert report.accounts_extracted == 1
    assert report.entries_seen == 9
    assert report.invalid_entries == 8
    assert report.rejected_by_reason == {
        "empty_record": 1,
        "no_username": 1,
        "malformed_item": 1,
        "invalid_username": 1,
        "not_a_record": 4,
    }
    assert "rejected_records" in codes(result)
    assert result.diagnostics.appears_complete is False


# -- accounting -----------------------------------------------------------------------------------


def test_totals_track_raw_valid_duplicate_and_rejected_records() -> None:
    entries = [
        followers_entry("Alice", TS),
        followers_entry("ALICE", TS + 10),
        followers_entry("bob"),
        {"title": "", "string_list_data": []},
    ]
    result = parse_export_files(
        {
            "followers_1.json": encode(entries),
            "followers_2.json": followers_file("bob", "carol"),
            "following.json": following_file("alice"),
        }
    )
    totals = result.diagnostics.followers

    assert totals.records_seen == 6
    assert totals.valid_records == 5
    assert totals.rejected_records == 1
    assert totals.duplicates_removed == 2
    assert totals.unique_accounts == 3
    assert totals.valid_records - totals.duplicates_removed == len(result.followers)
    assert totals.with_timestamp == 3


def test_deduplication_keeps_the_newest_timestamp_and_never_drops_distinct_accounts() -> None:
    result = parse_export_files(
        {
            "followers_1.json": encode([followers_entry("dup", TS), followers_entry("only_a", TS)]),
            "followers_2.json": encode(
                [followers_entry("dup", TS + 99), followers_entry("only_b", None)]
            ),
            "following.json": following_file("x"),
        }
    )

    assert sorted(names(result.followers)) == ["dup", "only_a", "only_b"]
    dup = next(a for a in result.followers if a.username == "dup")
    assert dup.followed_at is not None
    assert int(dup.followed_at.timestamp()) == TS + 99


def test_a_wrong_looking_but_legitimate_username_is_kept() -> None:
    names_ = ["a", "a.b_c", "x" * 30, "user.name.1", "_underscore_", "9digits"]
    result = parse_export_files(
        {"followers_1.json": followers_file(*names_), "following.json": following_file("z")}
    )

    assert sorted(names(result.followers)) == sorted(names_)


# -- malformed and unexpected input -----------------------------------------------------------------


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        (b"", "invalid_json"),
        (b"   ", "invalid_json"),
        (b"{not json", "invalid_json"),
        (b"\xff\xfe\x00", "invalid_json"),
        (b'"a string"', "unexpected_structure"),
        (b"12345", "unexpected_structure"),
        (b"null", "unexpected_structure"),
        (b'{"unrelated": {"a": 1}}', "unexpected_structure"),
    ],
)
def test_unreadable_followers_files_fail_loudly(content: bytes, expected: str) -> None:
    result = parse_export_files(
        {"followers_1.json": content, "following.json": following_file("x")}
    )

    assert expected in codes(result)
    error = next(i for i in result.issues if i.code == expected)
    assert error.severity == "error"
    assert error.path == "followers_1.json"
    assert result.diagnostics.status == "incomplete"
    assert result.diagnostics.appears_complete is False
    failed = [f for f in result.diagnostics.files if f.status == "failed"]
    assert [f.role for f in failed] == ["followers"]


def test_an_unknown_file_that_fails_to_parse_is_only_a_warning() -> None:
    result = parse_export_files(
        {
            "c/followers_and_following/followers_1.json": followers_file("a1"),
            "c/followers_and_following/following.json": following_file("b1"),
            "c/followers_and_following/mystery.json": b"{broken",
        }
    )
    issue = next(i for i in result.issues if i.code == "invalid_json")

    assert issue.severity == "warning"
    assert result.diagnostics.status == "warning"


def test_empty_list_files_are_reported_but_not_an_error() -> None:
    result = parse_export_files({"followers_1.json": b"[]", "following.json": following_file("x")})

    assert result.diagnostics.followers.unique_accounts == 0
    assert "empty_list" in codes(result)
    assert next(i for i in result.issues if i.code == "empty_list").severity == "info"


# -- completeness -----------------------------------------------------------------------------------


def test_missing_files_make_the_extraction_incomplete() -> None:
    only_followers = parse_export_files({"followers_1.json": followers_file("a1")})
    only_following = parse_export_files({"following.json": following_file("a1")})
    neither = parse_export_files({"media/photo.jpg": b"x"})

    assert "missing_following_file" in codes(only_followers)
    assert "missing_followers_file" in codes(only_following)
    assert codes(neither) == ["no_connection_files"]
    for result in (only_followers, only_following, neither):
        assert result.diagnostics.status == "incomplete"
        assert result.diagnostics.appears_complete is False


def test_a_gap_in_numbered_parts_is_an_error() -> None:
    result = parse_export_files(
        {
            "followers_1.json": followers_file("a1"),
            "followers_3.json": followers_file("a3"),
            "following.json": following_file("b1"),
        }
    )
    issue = next(i for i in result.issues if i.code == "missing_part")

    assert "followers_2.json" in issue.message
    assert issue.severity == "error"
    assert result.diagnostics.status == "incomplete"


def test_starting_at_part_two_means_part_one_is_missing() -> None:
    result = parse_export_files(
        {"followers_2.json": followers_file("a"), "following.json": following_file("b")}
    )

    assert "followers_1.json" in next(i for i in result.issues if i.code == "missing_part").message


def test_contiguous_parts_and_unnumbered_files_have_no_gap_issue() -> None:
    result = parse_export_files(
        {
            "followers_1.json": followers_file("a"),
            "followers_2.json": followers_file("b"),
            "following.json": following_file("c"),
        }
    )

    assert "missing_part" not in codes(result)


def test_the_same_part_in_two_places_is_merged_and_noted() -> None:
    result = parse_export_files(
        {
            "copy1/followers_1.json": followers_file("a", "b"),
            "copy2/followers_1.json": followers_file("a", "b"),
            "copy1/following.json": following_file("a"),
        }
    )

    assert len(result.followers) == 2
    assert result.diagnostics.followers.duplicates_removed == 2
    assert "duplicate_source_files" in codes(result)
    assert result.diagnostics.appears_complete is True


def test_a_clean_export_is_reported_complete() -> None:
    result = parse_export_files(
        {"followers_1.json": followers_file("a", "b"), "following.json": following_file("b", "c")}
    )

    assert result.issues == []
    assert result.diagnostics.status == "complete"
    assert result.diagnostics.appears_complete is True


# -- the date-range heuristic -----------------------------------------------------------------------


def dated_following(count: int, first: int, step_days: float) -> bytes:
    return encode(
        {
            "relationships_following": [
                following_entry(f"f{i:04d}", int(first + i * step_days * 86400))
                for i in range(count)
            ]
        }
    )


def dated_followers(count: int, first: int, step_days: float) -> bytes:
    return encode(
        [followers_entry(f"g{i:04d}", int(first + i * step_days * 86400)) for i in range(count)]
    )


EXPORT_ROOT = "instagram-someone-2026-11-22-AbCdEf/connections/followers_and_following/"


def test_followers_cut_to_the_last_year_while_following_goes_back_years_is_flagged() -> None:
    result = parse_export_files(
        {
            f"{EXPORT_ROOT}followers_1.json": dated_followers(120, epoch(2025, 11, 27), 2.8),
            f"{EXPORT_ROOT}following.json": dated_following(300, epoch(2022, 6, 7), 5),
        }
    )
    issue = next(i for i in result.issues if i.code == "possible_date_range_limit")

    assert issue.severity == "warning"
    assert "followers" in issue.message and "All time" in issue.message
    assert result.diagnostics.export_date == date(2026, 11, 22)
    assert result.diagnostics.status == "warning"
    assert result.diagnostics.appears_complete is False


@pytest.mark.parametrize("window", [30, 90])
def test_other_preset_windows_are_detected(window: int) -> None:
    export = datetime(2026, 11, 22, tzinfo=UTC)
    start = int(export.timestamp()) - (window - 2) * 86400
    result = parse_export_files(
        {
            f"{EXPORT_ROOT}followers_1.json": dated_followers(60, start, (window - 3) / 60),
            f"{EXPORT_ROOT}following.json": dated_following(200, epoch(2023, 1, 1), 10),
        }
    )

    assert "possible_date_range_limit" in codes(result)


def test_it_also_works_without_an_export_date_by_using_the_latest_timestamp() -> None:
    result = parse_export_files(
        {
            "followers_1.json": dated_followers(120, epoch(2025, 11, 27), 2.8),
            "following.json": dated_following(300, epoch(2022, 6, 7), 5),
        }
    )

    assert result.diagnostics.export_date is None
    assert "possible_date_range_limit" in codes(result)


def test_lists_that_start_together_are_not_flagged() -> None:
    result = parse_export_files(
        {
            f"{EXPORT_ROOT}followers_1.json": dated_followers(200, epoch(2022, 6, 10), 7),
            f"{EXPORT_ROOT}following.json": dated_following(200, epoch(2022, 6, 7), 7),
        }
    )

    assert "possible_date_range_limit" not in codes(result)
    assert result.diagnostics.appears_complete is True


def test_a_young_account_whose_both_lists_start_recently_is_not_flagged() -> None:
    result = parse_export_files(
        {
            f"{EXPORT_ROOT}followers_1.json": dated_followers(80, epoch(2025, 12, 1), 4),
            f"{EXPORT_ROOT}following.json": dated_following(120, epoch(2025, 11, 25), 2.5),
        }
    )

    assert "possible_date_range_limit" not in codes(result)


def test_too_few_dated_accounts_say_nothing() -> None:
    result = parse_export_files(
        {
            f"{EXPORT_ROOT}followers_1.json": dated_followers(5, epoch(2025, 11, 27), 30),
            f"{EXPORT_ROOT}following.json": dated_following(300, epoch(2022, 6, 7), 5),
        }
    )

    assert "possible_date_range_limit" not in codes(result)


def test_following_older_but_followers_not_window_shaped_is_not_flagged() -> None:
    # Followers begin 200 days before the export: not near any preset window edge.
    result = parse_export_files(
        {
            f"{EXPORT_ROOT}followers_1.json": dated_followers(100, epoch(2026, 5, 6), 1.8),
            f"{EXPORT_ROOT}following.json": dated_following(300, epoch(2022, 6, 7), 5),
        }
    )

    assert "possible_date_range_limit" not in codes(result)


@pytest.mark.parametrize(
    ("path", "expected"),
    [
        ("instagram-someone-2026-11-22-AbCdEf/connections/x.json", date(2026, 11, 22)),
        ("Instagram-Some_One.99-2026-01-05/a/b.json", date(2026, 1, 5)),
        ("instagram-x-2026-02-30-abc/a.json", None),  # not a real calendar date
        ("connections/followers_and_following/x.json", None),
        ("my-export-2026-11-22/x.json", None),
    ],
)
def test_export_date_is_read_from_the_root_folder_name(path: str, expected: date | None) -> None:
    # The frontend runs the same cases (completeness.test.ts); both must agree.
    assert detect_export_date([path]) == expected


# -- diagnostics never leak usernames ---------------------------------------------------------------


def test_diagnostics_and_issues_contain_no_usernames_or_contents() -> None:
    secret = "very_secret_person"
    entries = [
        followers_entry(secret),
        {"title": "private display name", "string_list_data": [{"value": "bad name"}]},
    ]
    result = parse_export_files(
        {
            "followers_1.json": encode(entries),
            "following.json": following_file("another_secret"),
            "followers_3.json": b"{broken " + secret.encode(),
        }
    )
    dump = json.dumps(
        {
            "issues": [i.model_dump(mode="json") for i in result.issues],
            "diagnostics": result.diagnostics.model_dump(mode="json"),
            "files": [f.model_dump(mode="json") for f in result.files],
        }
    )

    assert secret not in dump
    assert "another_secret" not in dump
    assert "private display name" not in dump


def test_result_serialises_to_camel_case_with_diagnostics() -> None:
    result = parse_export_files(
        {"followers_1.json": followers_file("a"), "following.json": following_file("b")}
    )
    dumped = result.model_dump(mode="json", by_alias=True)

    assert set(dumped) == {"followers", "following", "files", "issues", "diagnostics"}
    assert {"files", "followers", "following", "exportDate", "status", "appearsComplete"} <= set(
        dumped["diagnostics"]
    )
    assert {"validRecords", "duplicatesRemoved", "uniqueAccounts", "rejectedRecords"} <= set(
        dumped["diagnostics"]["followers"]
    )
    assert {"schemaName", "detectedBy", "usernameSources", "rejectedByReason"} <= set(
        dumped["files"][0]
    )


# -- large datasets -----------------------------------------------------------------------------------


def test_large_export_is_counted_exactly_across_many_files() -> None:
    followers = users("fan", 950)
    following = users("fol", 1200)
    # 150 mutuals: the first 150 followers are also followed.
    following[:150] = followers[:150]
    chunk = 400
    files = {
        f"export/connections/followers_and_following/followers_{n + 1}.json": followers_file(
            *followers[i : i + chunk]
        )
        for n, i in enumerate(range(0, len(followers), chunk))
    }
    files["export/connections/followers_and_following/following.json"] = following_file(*following)

    result = parse_export_files(files)

    assert len(result.followers) == 950
    assert len(result.following) == 1200
    assert result.diagnostics.followers.source_files == 3
    assert result.diagnostics.followers.records_seen == 950
    assert result.diagnostics.following.records_seen == 1200
    assert result.diagnostics.followers.duplicates_removed == 0
    assert result.diagnostics.appears_complete is True


def test_large_export_with_duplicates_and_junk_keeps_exact_accounting() -> None:
    base = users("u", 1000)
    entries = [followers_entry(n, TS + i) for i, n in enumerate(base)]
    entries += [
        followers_entry(n.upper(), TS + 5000) for n in base[:100]
    ]  # case-variant duplicates
    entries += [{"title": "", "string_list_data": []} for _ in range(25)]  # rejected
    result = parse_export_files(
        {"followers_1.json": encode(entries), "following.json": following_file("x")}
    )
    totals = result.diagnostics.followers

    assert totals.records_seen == 1125
    assert totals.valid_records == 1100
    assert totals.rejected_records == 25
    assert totals.duplicates_removed == 100
    assert totals.unique_accounts == len(result.followers) == 1000


# -- the zip pipeline end to end ----------------------------------------------------------------------


def test_zip_pipeline_returns_complete_diagnostics_with_the_export_date_from_the_root_folder() -> (
    None
):
    result = parse_export_archive(
        make_zip(
            {
                f"{EXPORT_ROOT}followers_1.json": dated_followers(120, epoch(2025, 11, 27), 2.8),
                f"{EXPORT_ROOT}following.json": dated_following(300, epoch(2022, 6, 7), 5),
                f"{EXPORT_ROOT}recent_follow_requests.json": encode([label_entry("zzz")]),
                "instagram-someone-2026-11-22-AbCdEf/media/photo.jpg": b"jpeg",
            }
        )
    )

    assert len(result.followers) == 120
    assert len(result.following) == 300
    assert result.diagnostics.export_date == date(2026, 11, 22)
    assert "possible_date_range_limit" in codes(result)
    assert [f.status for f in result.diagnostics.files].count("ignored") == 1
