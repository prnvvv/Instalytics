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

The JSON structures below come from Instagram's documented/commonly observed **JSON export**
format, not from files in this repository. They have not been verified against a live export in
this work, so the parser is deliberately tolerant (see "Variations handled"). Verify against a real
export (kept outside Git) before relying on edge cases.

## Layout

Current exports place the data under `connections/followers_and_following/`; older exports use
`followers_and_following/` at the archive root. A full export is wrapped in a top-level folder
whose name varies. The parser does not depend on any of these prefixes.

| File | Content | Top-level JSON | Handled |
| --- | --- | --- | --- |
| `followers_1.json`, `followers_2.json`, ... | People who follow the user (split into numbered files for large lists) | bare **list** | yes |
| `following.json` | Accounts the user follows | object, key `relationships_following` | yes |
| `pending_follow_requests.json` | Requests the user sent | object, `relationships_follow_requests_sent` | no (future) |
| `recent_follow_requests.json` | Recent follow requests | object, `relationships_permanent_follow_requests` | no (future) |
| `recently_unfollowed_accounts.json` | Accounts the user unfollowed | object, `relationships_unfollowed_users` | no (future) |
| `close_friends.json` | Close friends | object, `relationships_close_friends` | no (future) |
| `hide_story_from.json` | Hidden-story list | object, `relationships_hide_stories_from` | no (future) |

Wrapper-key names for the unhandled files are from memory of the format and are listed only as
guidance for future work.

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

- The username source differs by file and export version, so it is taken from `value`, else
  `title`, else `href` (first that normalizes to a valid username).
- Followers are a bare list; following is wrapped. Both layouts, plus a `relationships_followers`
  wrapper, are accepted.
- Timestamps are optional. A missing, non-numeric or implausible (outside 2010-2100) timestamp
  becomes `null`; it is never guessed.
- No display names are exported in these files, so `InstagramAccount` has no display name field.

## Variations handled

- Multiple `followers_N.json` files merged and de-duplicated.
- Any directory prefix, backslash or forward slash separators, `__MACOSX/` and `._*` ignored.
- Files in `followers_and_following/` with unexpected names are classified by their wrapper key.
- UTF-8 with BOM.
- Mixed case, `@handle`, trailing slashes, `/_u/` URLs, query strings.
- Malformed entries are counted (`invalidEntries`) and skipped; malformed files become `issues`
  and do not abort parsing of other files.

## Not supported yet

- The HTML export format (CLAUDE.md: add after JSON is reliable).
- Interaction data (likes, comments, messages, saved posts).
- Mojibake: Instagram JSON often double-encodes non-ASCII text. It does not affect usernames
  (ASCII only) but will matter when display names or message text are parsed.
