/**
 * Typed client for the existing backend. The app works fully without it: analytics run in the browser, so
 * no Instagram data is sent here. Today it is used for the status indicator (GET /api/v1/health/ready);
 * future endpoints belong in this module.
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

export const apiBaseUrl = (): string | null => {
  const url = import.meta.env.VITE_API_URL as string | undefined

  return url ? url.replace(/\/+$/, '') : null
}

export const getBackendStatus = async (signal?: AbortSignal): Promise<BackendStatus> => {
  const base = apiBaseUrl()

  if (base === null) return { state: 'not_configured' }

  try {
    const response = await fetch(`${base}/api/v1/health/ready`, { signal, headers: { Accept: 'application/json' } })
    const body = (await response.json()) as ReadinessResponse

    if (response.ok) return { state: 'online', readiness: body }

    return response.status === 503 ? { state: 'degraded', readiness: body } : { state: 'offline' }
  } catch {
    return { state: 'offline' }
  }
}
