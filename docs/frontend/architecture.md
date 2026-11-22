# Frontend architecture

React 19, TypeScript, Vite, Tailwind v4 (landing page) and a small dedicated stylesheet for the app. Routes:
`/` is the landing page; everything under `/app` is the application, loaded lazily.

## Where data is processed

**In the browser, and nowhere else.** An export ZIP is read, validated, parsed and analysed in the tab. There is
no network call anywhere on that path, and the backend never receives Instagram data. This is a deliberate
choice for this build (CLAUDE.md 5.2: local-first), not a limitation to be worked around.

The backend is reached only through `src/lib/api/client.ts` for `GET /api/v1/health/ready`. It drives the status
chip in the app header and the Backend card in Settings (online, degraded, offline), in development through the
Vite proxy and otherwise through `VITE_API_URL`; see `docs/setup/local-development.md`. The backend's
`POST /api/v1/analytics/relationships` is intentionally not used: it would send follower and following
usernames to a server. A test (`src/app/backend.test.tsx`) and the end-to-end script
(`scripts/e2e-smoke.mjs`) both assert that the only network calls are body-less health checks.

## Export versus Instagram's live counts

An export is a snapshot of files; the counts on Instagram's profile are live and only include accounts that are
active right now, so they rarely match exactly. The dashboard has an optional **Check against Instagram** panel
(`features/dashboard/ReconcilePanel.tsx`, logic in `lib/analytics/reconcile.ts`): the user types the two counts
the app shows and sees whether the export matches (a few accounts of drift is normal), lists more accounts than
Instagram shows (accounts since deactivated or deleted can still appear in an export, and would all be among "not
following back" or "fans"), or lists fewer (changes after exporting, a date-range limit, a missing file). The
explanations are hedged on purpose: an export carries no per-account status, so nothing claims to know which
accounts are inactive. What the user types is computed locally and never stored or sent.

### Marking unavailable accounts

Because the export cannot say which accounts are gone, the user can set them aside themselves
(`lib/analytics/unavailable.ts`). In the lists, each row has an **Unavailable** tick and each page a "Mark these N"
button; an optional reason (deactivated, suspended, deleted, blocked me) is a label the user chooses, never
something INYX detects. A marked account is removed from **both** lists before any metric is computed
(`DataProvider` builds the session from the complete lists plus the marks), so followers, following, mutuals and
every rate stay consistent. Marked accounts appear under the **Unavailable** tab, where the reason can be changed
or the account restored, and in that tab's CSV (with a `reason` column). Marks live in memory for an unsaved
import; for a saved snapshot they are stored with it (`unavailable`, `unavailableReasons`) in this browser's
IndexedDB, while the snapshot keeps the complete lists untouched. Settings can clear all marks. Nothing here
contacts Instagram: INYX never looks accounts up.

## One set of rules on both sides

`lib/instagram` and `lib/analytics` are a TypeScript port of the backend's parser, completeness diagnostics and
relationship analytics. `docs/parser/parity-cases.json` is a shared set of hand-written synthetic cases that the
backend (pytest) and the frontend (vitest) both run, so a rule changed on one side fails a test on the other
until it is ported. Importing opens the overview straight away. The same diagnostics the backend produces (files
found, per-list totals, missing parts, rejected records, a possible date-range limit) are kept: an export that
looks incomplete shows a one-line warning on the overview and lists what may be missing in a dialog, the full
file-by-file report is under **Import details**, and saved snapshots keep their warning. An export without both a
followers and a following list is not analysed, and the import page says why.

## Layers

```
src/
  lib/                  framework-free, unit-tested logic
    instagram/          normalize, parse (discovery + extraction), zip (safe reader), importExport
    analytics/          relationships, compare (snapshots), activity, insights
    storage/snapshots   SnapshotStore interface, IndexedDB and in-memory implementations
    csv.ts              CSV writer with spreadsheet-formula neutralisation
    api/client.ts       typed backend client (health only)
  data/                 DataProvider and useAppData: the current session, snapshots, preferences
  components/dots/      dot-matrix numerals and pixel charts (DotText, DotBar, DotGrid, DotColumns, PixelStrip)
  components/ui/        Dialog (focus-trapped modal)
  hooks/                useFit: the fixed-layout query and element size
  features/             upload, dashboard, lists, history, settings
  app/                  shell, routes, shared page pieces
  styles/app.css        theme, continuing the landing page (ix- classes)
```

`lib/instagram` is a TypeScript port of the backend parser and archive validator (same rules, limits and
definitions; see `docs/parser/instagram-export-format.md` and `docs/analytics/definitions.md`), so the two stay
interchangeable. `lib/analytics/relationships.ts` implements the same set definitions as the backend.

## Layout: one screen per page

On screens at least 1000px wide and 600px tall (`FIT_QUERY` in `hooks/useFit.ts`, mirrored in
`styles/app.css`) the app is a fixed shell and the page itself never scrolls. Each page is a header row plus a
body that is split into tiles, and every tile manages its own overflow:

- **Lists** are card grids. `features/lists/AccountBrowser.tsx` measures its grid and works out how many cards
  fit, so a page always fills its tile exactly and the rest is reached with the pager. Selecting an account opens
  its details in a dialog.
- **Longer content** is not squeezed in: it opens in a `Dialog` behind a "Read more" or "Details" button
  (insights, import details, the Instagram check, what may be missing).
- **Short windows** (up to 779px tall, a typical laptop) switch on a compact mode: tighter spacing, and secondary
  text marked `ix-hide-short` steps aside.
- **Phones and smaller windows** keep the same pages but stack and scroll normally, since fitting everything is not
  possible there. Lists then use the "cards per page" preference.

The theme continues the landing page: light tiles with dotted edges and a small coloured pixel tab, the heat
ramp (`lib/palette.ts`), dot-matrix numerals and pixel charts. Each category page (`lib/analytics/categories.ts`)
shows the headline number, how it splits, a months-or-years chart and a few readings next to its accounts.
`scripts/e2e-smoke.mjs` asserts that the import, overview, category, History and Settings pages fit the window
without scrolling and without clipping.

## Safety limits (ZIP)

Archive 250 MB, 10,000 entries, 200 MB per entry, 1 GB expanded in total, compression ratio 100 (above 1 MB),
50 MB per JSON file, path length 255 and depth 20. The central directory is checked before it is parsed, member
names are only lookup keys (nothing is ever written to disk), unknown file types are rejected, and only the few
followers/following JSON files are ever inflated. Parsing runs on the main thread, which is fine for these file
sizes; move it to a Web Worker if profiling shows jank on very large exports.

## Persistence

Nothing is saved by default. If the user ticks "Save a snapshot on this device", only derived data is stored in
IndexedDB: follower and following usernames with timestamps and counts. The ZIP is never stored. Settings has
"delete everything". Preferences (cards per page for scrolling layouts, pre-tick save) live in `localStorage`.

## Extending it (planned work)

- **Activity data (likes, comments, saved posts):** add another extractor next to `parse.ts` and another
  derived collection in the snapshot schema (bump the schema version and migrate in `snapshots.ts`). Candidate
  files are already chosen by `isCandidatePath`, so the reader inflates only what a feature needs.
- **RAG / chat over your own data:** must stay on-device. CLAUDE.md forbids sending exports to external LLM APIs,
  so this needs an approved in-browser or local model and its own privacy review before any work starts.
- **Cleanup assistance:** assistive only. The Not-following-back list gives profile links so the user acts
  manually. CLAUDE.md forbids automating follows, unfollows or messages, so no automation is planned.

## Deployment note

The app uses client-side routing, so the host must serve `index.html` for unknown paths (for example a Vercel
rewrite of `/(.*)` to `/index.html`).
