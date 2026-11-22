# Instagram export format: reference analysis

## Provenance (read this first)

The existing `backend/` files were inspected before the parser was written. They contain **no
sample export data and no parser code**: almost every file was an empty stub. The only substantive
files, now archived under `backend/reference/`, are two route modules
(`legacy_social_routes.py`, `legacy_upload_routes.py`). They tell us:

- The export is consumed as a ZIP of the `connections` folder, with a
  `followers_and_following/` directory located "regardless of nesting depth"
  (`find_followers_and_following_dir`).
- The relationship categories the product wanted: `followers`, `following`, `mutuals`,
  `non_followers`, `not_followed_back`, `recently_unfollowed`, `recent_follow_requests`,
  `pending_follow_requests`, `received_follow_requests`, `close_friends`, `hidden_story_from`.

The structures for `followers_N.json` and `following.json` were first written from Instagram's
commonly observed **JSON export** format and have since been **verified against a real export**
(kept outside Git, never committed; see "Verified against a real export" below). The sibling files
in the table that are marked "no" turned out to use a different layout from the one first
assumed, so the parser stays deliberately tolerant (see "Variations handled").

## Layout

Current exports place the data under `connections/followers_and_following/`; older exports use
`followers_and_following/` at the archive root. A full export is wrapped in a top-level folder
whose name varies. The parser does not depend on any of these prefixes.

| File | Content | Top-level JSON | Handled |
| --- | --- | --- | --- |
| `followers_1.json`, `followers_2.json`, ... | People who follow the user (split into numbered files for large lists) | bare **list** | yes |
| `following.json` | Accounts the user follows | object, key `relationships_following` | yes |
| `pending_follow_requests.json` | Requests the user sent | list of `label_values` records | no (future) |
| `recent_follow_requests.json` | Recent follow requests | list of `label_values` records | no (future) |
| `recently_unfollowed_profiles.json` (older: `recently_unfollowed_accounts.json`) | Accounts the user unfollowed | list of `label_values` records | no (future) |
| `close_friends.json` | Close friends | list of `label_values` records | no (future) |
| `hide_story_from.json`, `removed_suggestions.json`, `follow_requests_you've_received.json` | Smaller lists | single `label_values` object | no (future) |

These files are found, read and **explicitly ignored** (they appear as `ignored` in the diagnostics):
they must never be counted as followers or following. Their names only partly resemble the two
files that are parsed, which is why file names are matched with anchored patterns.

## Entry structure

Every entry has the same shape:

```json
{
  "title": "",
  "media_list_data": [],
  "string_list_data": [
    { "href": "https://www.instagram.com/<username>", "value": "<username>", "timestamp": 1700000000 }
  ]
}
```

| Field | Followers | Following |
| --- | --- | --- |
| `title` | empty string | the **username** |
| `string_list_data[].value` | the username | usually absent in newer exports |
| `string_list_data[].href` | `https://www.instagram.com/<username>` | `https://www.instagram.com/_u/<username>` |
| `string_list_data[].timestamp` | Unix seconds; when the account followed the user | Unix seconds; when the user followed the account |

Consequences for the parser:

- The username source differs by file and export version, so candidates are tried in this order and the
  first that validates wins: the profile URL (`href`, which is structurally validated and is what the
  app links to), then `value`, then `title`. If two candidates are both valid but different, the URL is
  used and the record is counted as a conflict. Display names such as "Jane Doe" never validate, so they
  can never become accounts.
- Followers are a bare list; following is wrapped. Both layouts, plus a `relationships_followers`
  wrapper, are accepted.
- Timestamps are optional. A missing, non-numeric or implausible (outside 2010-2100) timestamp
  becomes `null`; it is never guessed.
- No display names are exported in these files, so `InstagramAccount` has no display name field.

## Variations handled

**Discovery** (by file name, anywhere in the archive, case-insensitively):

- `followers.json`, `followers_1.json`, `followers_2.json`, ..., `following.json` (also `followers-2.json`,
  `Followers_3.JSON`). Every matching file is aggregated, never just `followers_1.json`.
- The patterns are anchored, so `recent_follow_requests.json`, `pending_follow_requests.json`,
  `following_hashtags.json`, `followers_and_following.json`, `followers_1.json.bak` and similar never match.
- Any ZIP root, any folder names, backslash or forward slash separators; `__MACOSX/` and `._*` ignored.
- A differently named JSON file inside a `followers_and_following*` folder is inspected and used only if
  its content has a `relationships_followers` / `relationships_following` wrapper key.

**Record layouts** (`schemaName` in the diagnostics):

- `list`: a bare list of records. `nested-lists`: lists inside the list, flattened.
- `wrapped:<key>`: the documented `relationships_*` key, or an unknown key when it is the only list
  in the file that holds record-like items (an ambiguous file is reported, not guessed).
- `single-record`: one record at the top level.
- Records themselves: `string_list_data` items, `label_values` records (a `Username` and a `URL` label,
  timestamp on the record), or flat `{href, value, username, title, timestamp}` objects.

**Values and accounting**

- UTF-8 with BOM; mixed case, `@handle`, trailing slashes, `/_u/` URLs, query strings.
- Every record is accounted for: seen, valid, rejected (with a reason: `empty_record`, `no_username`,
  `invalid_username`, `malformed_item`, `not_a_record`), and duplicates removed. Totals come from the full
  extracted lists, never from previews.
- Malformed files become `issues` and do not abort parsing of other files.

## Verified against a real export

A real export (kept outside Git, never committed) was inspected structurally. Findings that shaped the
parser, with no personal data:

- `followers_1.json` is a bare list; each record has an empty `title`, one `string_list_data` item with
  `href`, `value` and `timestamp`. `following.json` is wrapped in `relationships_following`; the username is
  in `title`, the item has no `value`, and `href` uses `/_u/<username>`.
- Within each file, `value`, `title` and `href` agreed for every record, there were no duplicates, no case
  variants and no invalid usernames. Files are ordered newest first.
- Sibling files (`recent_follow_requests.json` and others) use a completely different `label_values`
  layout. They were ignored correctly and must stay ignored.
- **Date-limited exports.** In the reference, the follower timestamps began almost exactly one year before
  the export date (taken from the export folder name), while the following timestamps reached back more than
  four years. That is the signature of an export requested with a date range such as "Last year": the followers
  list is a subset, so mutual and not-following-back figures derived from it are unreliable. The parser
  cannot know the true follower count, so it raises a `possible_date_range_limit` warning instead of
  reporting success. This was the real cause of misleading results: extraction was exact for what the files
  contained, but nothing told the user the files were probably incomplete.

## Diagnostics and completeness

`ParseResult.diagnostics` reports, without usernames or contents:

- `files`: every file considered, as `processed`, `ignored` (not follower data) or `failed`, with a note.
- `followers` / `following` totals: source files, records seen, valid, rejected, duplicates removed, unique
  accounts, how many carry a timestamp, and the earliest and latest date.
- `exportDate` when the root folder is named `instagram-<name>-YYYY-MM-DD-<id>`.
- `status` (`complete`, `warning`, `incomplete`) and `appearsComplete`, derived from issue severities.

| Severity | Issue codes | Effect |
| --- | --- | --- |
| error | `invalid_json`, `unexpected_structure`, `file_too_large` (for a named followers/following file), `no_connection_files`, `missing_followers_file`, `missing_following_file`, `missing_part` | `incomplete` |
| warning | `rejected_records`, `possible_date_range_limit`, and the same file errors for an unnamed file | `warning` |
| info | `empty_list`, `conflicting_usernames`, `duplicate_source_files` | none |

`missing_part` fires when numbered parts have a gap (for example `followers_1` and `followers_3` without
`followers_2`). `possible_date_range_limit` is a heuristic: a list starts just inside a preset window (7, 30,
90 or 365 days before the export) while the other list reaches clearly further back, and both have at least
10 dated accounts. It is a warning, not a verdict.

## API changes

`ParseResult` gained `diagnostics`; `FileReport` gained `detectedBy`, `schemaName`, `part`,
`accountsExtracted`, `rejectedByReason`, `usernameSources` and `conflictingUsernames`; `ParseIssue` gained
`severity` and its `path` is now optional (issues such as a missing file have no path). All additions are
backward compatible; `entriesSeen` and `invalidEntries` keep their meaning (records seen and records rejected).
The only behaviour change is deliberate: an archive with no followers/following files now returns a
`no_connection_files` error instead of an empty result with no issues.

## Not supported yet

- The HTML export format (CLAUDE.md: add after JSON is reliable).
- Interaction data (likes, comments, messages, saved posts).
- Mojibake: Instagram JSON often double-encodes non-ASCII text. It does not affect usernames
  (ASCII only) but will matter when display names or message text are parsed.
