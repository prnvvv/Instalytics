# Instalytics backend

FastAPI modular monolith for Instalytics, a privacy-first Instagram analytics app. The backend
**never** asks for Instagram credentials, cookies or tokens. By default raw exports stay in the
user's browser; this backend currently offers a stateless analytics API plus parsing and ZIP
validation libraries.

## What is implemented

| Area | Status |
| --- | --- |
| App foundation (config, JSON logging, request IDs, error envelope, CORS, security headers, body-size limit) | Implemented |
| `GET /api/v1/health/live`, `GET /api/v1/health/ready` | Implemented. Readiness pings Redis only when `REDIS_URL` is set |
| `POST /api/v1/analytics/relationships` | Implemented, stateless (nothing stored or logged) |
| `app.modules.parser` (followers/following JSON, username/URL normalization) | Implemented as a library, not exposed over HTTP |
| `app.modules.archive` (secure ZIP validation, bounded in-memory reads) | Implemented as a library, not exposed over HTTP |
| Redis | Client + readiness check only (`app/core/redis.py`). No caching, queue or rate limiting yet |
| Database, migrations, Celery, auth, rate limiting, upload endpoint | **Not implemented** (not approved/needed yet) |

There is deliberately **no ZIP upload endpoint**: the export is parsed client-side. If one is ever
approved, build it on `parse_export_archive`.

## Layout

```
backend/
  app/
    main.py            create_app(), lifespan, middleware wiring
    api/               versioned router registration, shared dependencies
    core/              config, logging, exceptions, middleware, redis
    schemas/           shared base models (camelCase JSON)
    modules/
      health/          liveness/readiness
      archive/         SafeZip, limits, path safety
      parser/          discovery, normalization, extraction, models
      analytics/       relationship analytics + router
  tests/               pytest suite (synthetic data only)
  reference/           archived legacy files, excluded from lint/Docker
```

## Local setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1           # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
copy .env.example .env                  # optional
uvicorn app.main:app --reload
```

OpenAPI docs: <http://localhost:8000/docs> (disabled when `APP_ENV=production`).

## Checks

```powershell
ruff check .
ruff format --check .
python -m pytest
```

## Docker

```powershell
docker build -t instalytics-backend backend
docker run --rm -p 8000:8000 instalytics-backend
```

The image is multi-stage, runs as a non-root user (uid 10001), sets `APP_ENV=production` and has a
`HEALTHCHECK` on the liveness endpoint.

## Configuration

All settings are environment variables; see `.env.example`. Wildcard CORS origins are rejected.
Dependencies are pinned in `requirements.txt` (runtime) and `requirements-dev.txt`; keep
`pyproject.toml` in sync.

## Conventions

- Errors: `{"error": {"code", "message", "requestId", "details?"}}`. Validation errors never
  echo submitted values.
- JSON is camelCase to match the canonical TypeScript models.
- Never log Instagram data. Request logs contain method, path, status and duration only.
- Tests use synthetic data; never commit real exports.

See `docs/parser/instagram-export-format.md` and `docs/analytics/definitions.md`.
