# Relationship analytics definitions

Let **F** be the set of followers and **G** the set of accounts the user follows, both as sets of
normalized (lowercase) usernames. Duplicates are removed before any calculation.

| Metric | Definition | Meaning |
| --- | --- | --- |
| Mutuals | `M = F ∩ G` | Follow each other |
| Following only | `N = G − F` | The user follows them; they do not follow back |
| Followers only | `U = F − G` | They follow the user; the user does not follow back |
| Unique accounts | `A = F ∪ G` | Distinct accounts across both lists |
| Mutuality rate | `|M| / |A| × 100` | Percentage of all known accounts that are mutual |
| Follow-back rate | `|M| / |G| × 100` | Percentage of followed accounts that follow back |
| Follower-to-following ratio | `|F| / |G|` | Not a percentage |

## Edge cases

- A rate or ratio with a zero denominator is `null` (undefined), never `0` or infinity. The UI
  should render it as "n/a".
- Usernames compare case-insensitively; `Alice` and `alice` are one account.
- For mutuals, the **followers-side** record is returned (its timestamp is when that account
  followed the user). Following-only uses the following-side record, followers-only the
  followers-side record.
- Lists are sorted by username so results are deterministic and reproducible.
- Timestamps describe when Instagram recorded the follow in the export, not when a relationship
  changed. Nothing here claims "recently followed/unfollowed" without comparing two exports.
