/**
 * Typed client for the existing backend.
 *
 * The app works fully without it: analysis runs in the browser, so no Instagram data is ever sent here. Today it is
 * used for the status indicator (GET /api/v1/health/ready); future endpoints belong in this module.
 *
 * Where requests go:
 *  - VITE_API_URL set: that origin (the backend must allow this origin in CORS_ORIGINS).
 *  - development: the same origin; the Vite dev server proxies /api to the backend (see vite.config.ts).
 *  - production without VITE_API_URL: no backend is configured, and the indicator is hidden.
 */

export type ReadinessResponse = {
  status: 'ok' | 'unavailable'
  checks: Record<string, 'ok' | 'unavailable' | 'not_configured'>
}

export type BackendStatus =
  | { state: 'not_configured' }
  | { state: 'online'; readiness: ReadinessResponse }
  | { state: 'degraded'; readiness: ReadinessResponse }
  | { state: 'offline' }

/** The base URL for API requests: '' means same origin, null means no backend is configured. */
export const apiBaseUrl = (): string | null => {
  const configured = import.meta.env.VITE_API_URL as string | undefined

  if (configured) return configured.replace(/\/+$/, '')

  return import.meta.env.DEV ? '' : null
}

/** How the base URL was chosen, for the settings page. */
export const apiMode = (): 'direct' | 'proxy' | 'none' => {
  if (import.meta.env.VITE_API_URL) return 'direct'

  return import.meta.env.DEV ? 'proxy' : 'none'
}

const isReadiness = (value: unknown): value is ReadinessResponse =>
  typeof value === 'object' &&
  value !== null &&
  'status' in value &&
  'checks' in value &&
  typeof (value as ReadinessResponse).checks === 'object'

export const getBackendStatus = async (signal?: AbortSignal): Promise<BackendStatus> => {
  const base = apiBaseUrl()

  if (base === null) return { state: 'not_configured' }

  try {
    const response = await fetch(`${base}/api/v1/health/ready`, {
      signal,
      headers: { Accept: 'application/json' },
      // A health check carries nothing about the user, and must never send cookies or credentials.
      credentials: 'omit',
      cache: 'no-store'
    })
    const body: unknown = await response.json()

    // The dev proxy answers 5xx with a non-JSON body when the backend is down; that is "offline", not "degraded".
    if (!isReadiness(body)) return { state: 'offline' }

    if (response.ok) return { state: 'online', readiness: body }

    return response.status === 503 ? { state: 'degraded', readiness: body } : { state: 'offline' }
  } catch {
    return { state: 'offline' }
  }
}
