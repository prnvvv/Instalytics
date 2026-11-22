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

## One set of rules on both sides

`lib/instagram` and `lib/analytics` are a TypeScript port of the backend's parser, completeness diagnostics and
relationship analytics. `docs/parser/parity-cases.json` is a shared set of hand-written synthetic cases that the
backend (pytest) and the frontend (vitest) both run, so a rule changed on one side fails a test on the other
until it is ported. The import preview shows the same diagnostics the backend produces (files found, per-list
totals, missing parts, rejected records, a possible date-range limit) and asks for an acknowledgement before
analysing an export that looks incomplete; saved snapshots keep their warning.

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
  components/dots/      dot-matrix numerals and pixel charts (DotText, DotBar, DotGrid, DotColumns)
  features/             upload, dashboard, lists, history, settings
  app/                  shell, routes, shared page pieces
  styles/app.css        theme, continuing the landing page (ix- classes)
```

`lib/instagram` is a TypeScript port of the backend parser and archive validator (same rules, limits and
definitions; see `docs/parser/instagram-export-format.md` and `docs/analytics/definitions.md`), so the two stay
interchangeable. `lib/analytics/relationships.ts` implements the same set definitions as the backend.

## Safety limits (ZIP)

Archive 250 MB, 10,000 entries, 200 MB per entry, 1 GB expanded in total, compression ratio 100 (above 1 MB),
50 MB per JSON file, path length 255 and depth 20. The central directory is checked before it is parsed, member
names are only lookup keys (nothing is ever written to disk), unknown file types are rejected, and only the few
followers/following JSON files are ever inflated. Parsing runs on the main thread, which is fine for these file
sizes; move it to a Web Worker if profiling shows jank on very large exports.

## Persistence

Nothing is saved by default. If the user ticks "Save a snapshot on this device", only derived data is stored in
IndexedDB: follower and following usernames with timestamps and counts. The ZIP is never stored. Settings has
"delete everything". Preferences (rows per page, pre-tick save) live in `localStorage`.

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
