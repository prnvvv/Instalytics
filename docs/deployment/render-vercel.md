# Deployment: Render (API) and Vercel (frontend)

INYX deploys as two independent pieces:

| Piece | Host | Source | Needs |
| --- | --- | --- | --- |
| API (FastAPI) | Render, Docker web service | `backend/` | nothing else: no database, Redis, disk or worker |
| Frontend (Vite + React) | Vercel | `frontend/` | the API's public URL (optional) |

**Privacy:** the Instagram export is read and analysed in the browser and is never uploaded. The deployed API is
stateless and today only the health check (`GET /api/v1/health/ready`) is called by the app. Nothing is persisted
on either host. The frontend works fully even if the API is down or `VITE_API_URL` is not set.

> Free-tier limits and pricing change. Check Render's and Vercel's current pricing pages before deploying.
> On Render's free plan an idle service spins down and the first request afterwards is slow (the status chip may
> briefly show "API offline" while it wakes).

## 1. Render (backend)

The repo root contains `render.yaml`, a Blueprint that declares the service. You can use it (New > Blueprint) or
create the service by hand with the same values.

| Setting | Value |
| --- | --- |
| Type | Web Service |
| Runtime | Docker |
| Dockerfile path | `./backend/Dockerfile` |
| Docker build context | `./backend` |
| Health check path | `/api/v1/health/live` |
| Auto-deploy | off (deploy deliberately) |
| Start command | leave empty: the image's `CMD` runs uvicorn bound to `0.0.0.0:$PORT` |

Environment variables:

| Name | Value | Notes |
| --- | --- | --- |
| `APP_ENV` | `production` | Disables `/docs`, `/redoc` and `/openapi.json`. |
| `CORS_ORIGINS` | `https://<your-app>.vercel.app` | **Required.** Comma-separated explicit origins; no `*`, no path. Include a custom domain too if you add one. Without it the browser blocks the API status call. |
| `LOG_LEVEL` | `INFO` | Optional. |
| `LOG_JSON` | `true` | Optional (default). |
| `REDIS_URL` | leave unset | Not used yet. |

Do not set `PORT`; Render injects it. There are no secrets to configure.

Verify after deploy:

```bash
curl https://<service>.onrender.com/api/v1/health/live     # {"status":"ok"}
curl https://<service>.onrender.com/api/v1/health/ready    # {"status":"ok","checks":{"redis":"not_configured"}}
curl -i -H "Origin: https://<your-app>.vercel.app" https://<service>.onrender.com/api/v1/health/ready
# the last response must contain: access-control-allow-origin: https://<your-app>.vercel.app
```

## 2. Vercel (frontend)

Import the repository in Vercel and set:

| Setting | Value |
| --- | --- |
| Root Directory | `frontend` |
| Framework Preset | Vite (detected; `frontend/vercel.json` also sets it) |
| Install Command | `npm ci` |
| Build Command | `npm run build` |
| Output Directory | `dist` |
| Node.js version | 22.x or 24.x (see `engines` in `frontend/package.json`) |

Environment variable (Production, and Preview if wanted):

| Name | Value |
| --- | --- |
| `VITE_API_URL` | `https://<service>.onrender.com` (no trailing slash) |

`VITE_*` values are compiled into the public bundle at build time, so **redeploy after changing it** and never put
secrets there. Without it the app builds and runs, and the API status indicator is hidden.

`frontend/vercel.json` adds a catch-all rewrite to `/index.html`, so deep links and refreshes on client-side routes
(for example `/settings`) work, plus basic security headers and long-lived caching for hashed `/assets/*` files.

## 3. Order of deployment

1. Deploy the API on Render with a placeholder `CORS_ORIGINS`, and note its URL.
2. Deploy the frontend on Vercel with `VITE_API_URL` set to that URL, and note its URL.
3. Set `CORS_ORIGINS` on Render to the Vercel origin and let the service restart.
4. Open the Vercel URL: the header chip should read "API online".

Vercel preview deployments get different origins. They will show "API offline" unless you add their origin to
`CORS_ORIGINS`; this does not affect the rest of the app.

## 4. Local checks before deploying

```bash
# backend
cd backend && pip install -r requirements-dev.txt
ruff check . && ruff format --check . && pytest -q
docker build -t instalytics-api backend
docker run --rm -p 8080:10000 -e PORT=10000 -e APP_ENV=production \
  -e CORS_ORIGINS=http://localhost:5173 instalytics-api
curl http://localhost:8080/api/v1/health/live

# frontend
cd frontend && npm ci && npm run lint && npm test
VITE_API_URL=https://<service>.onrender.com npm run build && npm run preview
```

CI (`.github/workflows`) runs Ruff, pytest, a Docker image build with a container smoke test, and the frontend lint,
tests and build on every push.

## 5. Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Header chip says "API offline" in production | Check, in order: `VITE_API_URL` was set before the build (redeploy if not); the Render service is awake (free plan cold start); `CORS_ORIGINS` exactly matches the page origin (scheme and host, no path). |
| Browser console: CORS error | `CORS_ORIGINS` is missing or does not include the Vercel origin. Update it on Render and wait for the restart. |
| Render: "no open ports detected" or failing health check | The service must listen on `$PORT`. Do not override the start command or set `PORT`. Health check path must be `/api/v1/health/live`. |
| Render fails at startup with a validation error | `CORS_ORIGINS` contains `*`, a path, or a value without `http(s)://`. |
| 404 on refresh of `/settings` or other routes | `frontend/vercel.json` is not being used: confirm Root Directory is `frontend`. |
| `/docs` returns 404 | Intended in production (`APP_ENV=production`). Use `APP_ENV=development` locally. |
| API status is "degraded" | A configured dependency is down. Only Redis can cause this, and only when `REDIS_URL` is set. |

Logs contain request metadata only (method, path, status, duration, request ID); never Instagram data. Quote the
`requestId` from an error response when searching Render's logs.
