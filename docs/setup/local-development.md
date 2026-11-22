# Local development

Backend (FastAPI) and frontend (Vite + React) run side by side. **Your Instagram export is read and analysed in
the browser and is never sent to the backend.** The two are connected for health only today: the app shows the
API's status and the backend is ready for future endpoints. See `docs/frontend/architecture.md`.

## One command (Windows)

```powershell
.\scripts\dev.ps1
```

It creates `backend\.venv` and installs dependencies on first run, runs `npm ci` in `frontend\`, starts
uvicorn on `:8000` and Vite on `:5173`, and waits for the backend before printing the URLs. Ctrl+C stops both.
It refuses to start if a port is taken (for example by a stale dev server) and tells you which process holds it.
Use `-ApiPort` / `-WebPort` to choose other ports.

- App: <http://localhost:5173>
- API docs: <http://localhost:8000/docs>

## Starting them yourself (any OS)

```bash
# terminal 1: backend
cd backend
python -m venv .venv && . .venv/bin/activate        # Windows: .\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# terminal 2: frontend
cd frontend
npm ci
npm run dev
```

## How the two connect

| Mode | When | How |
| --- | --- | --- |
| Dev proxy (default) | `npm run dev` | The browser calls `/api/...` on the Vite origin and Vite forwards it to `http://127.0.0.1:8000`. No CORS is involved. Change the target with `VITE_DEV_API_TARGET` in `frontend/.env.local`. |
| Direct | `VITE_API_URL` is set (for example a deployed frontend) | The browser calls that origin. The backend must list the frontend's origin in `CORS_ORIGINS` (comma-separated, no wildcards). |
| None | production build without `VITE_API_URL` | No backend is configured; the status indicator is hidden and everything else works. |

The status chip in the app header and the Backend card in Settings call `GET /api/v1/health/ready` every
30 seconds while the tab is visible: `API online`, `API degraded` (a dependency such as Redis is down) or
`API offline`. An offline backend never blocks the app.

## Checks

```powershell
.\scripts\check.ps1                       # everything CI runs, with a PASS/FAIL summary
node scripts\e2e-smoke.mjs --web http://localhost:5173 --api online
```

`check.ps1` runs Ruff (lint and format), pytest, `tsc`, the frontend lint, vitest, the production build and the
data-validation script. `e2e-smoke.mjs` drives a real browser against the **running** servers over the DevTools
protocol (no extra dependencies; Edge by default, or pass `--browser <path>` / set `$BROWSER`). It generates a
synthetic ZIP shaped like a "last year" export and checks the whole path: landing page, Get started, the API
indicator, the import preview and its date-range warning, analysis, the exact dashboard figures, Settings, and
that the only network calls are body-less health checks. Use `--api offline` to test with the backend down.

## Parser parity

The backend and the frontend each have a parser and analytics engine. `docs/parser/parity-cases.json` holds
hand-written synthetic cases that `backend/tests/test_parity_cases.py` and
`frontend/src/lib/instagram/parity.test.ts` both run, so the two cannot drift apart. Change a rule in one
place and a test fails in the other until it is ported.

## Real exports

To check the pipelines against a real export, put the unpacked export folder **and ideally the original `.zip`
beside it** in `reference/` (git-ignored; never commit it). The tests recompute the totals independently from the
raw JSON and never print or store a username.

```powershell
$env:INYX_REFERENCE_DIR = (Resolve-Path reference).Path
cd backend;  .\.venv\Scripts\python -m pytest tests/test_reference_export.py -s
cd ..\frontend; npm test -- src/lib/instagram/reference.test.ts
```

To import the real ZIP through the live app in a browser, with the expected figures computed independently:

```powershell
node scripts\e2e-smoke.mjs --web http://localhost:5173 --zip (Get-ChildItem reference -Filter *.zip).FullName --warning no
```

Use `--warning yes` for an export you expect to be flagged, or `--warning any` to just report it.

## Troubleshooting

- **Blank page, `500` for `/src/App.tsx`, or "Failed to resolve import" in the overlay:** a stale Vite dev server,
  usually one started before dependencies were installed or branches were switched. Stop it (Ctrl+C) and run
  `npm run dev` again; `npx vite --force` rebuilds Vite's dependency cache.
- **"API offline" while the backend is running:** the proxy target is wrong. Check `VITE_DEV_API_TARGET` and the
  backend port, or open <http://127.0.0.1:8000/api/v1/health/ready> directly.
- **CORS errors with `VITE_API_URL`:** add the exact frontend origin to the backend's `CORS_ORIGINS`.
- **Port already in use:** `dev.ps1` names the process; stop it or pass `-ApiPort` / `-WebPort`.
