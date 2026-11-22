import { useCallback, useEffect, useState } from 'react'

import { getBackendStatus, type BackendStatus } from '@/lib/api/client'

const POLL_MS = 30_000

/**
 * The backend's health, checked on mount and every 30 seconds while the tab is visible. `null` means the first
 * check has not finished. The check carries no user data. Call `refresh` to check straight away.
 */
export const useBackendStatus = (): { status: BackendStatus | null; refresh: () => void } => {
  const [status, setStatus] = useState<BackendStatus | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    let timer: number | undefined

    const check = async () => {
      const next = await getBackendStatus(controller.signal)

      if (controller.signal.aborted) return

      setStatus(next)

      // A backend that was never configured will not appear on its own, so it is not polled.
      if (next.state !== 'not_configured') timer = window.setTimeout(schedule, POLL_MS)
    }

    // Skip checks while the tab is hidden; they resume when it becomes visible again.
    const schedule = () => {
      if (document.hidden) timer = window.setTimeout(schedule, POLL_MS)
      else void check()
    }

    void check()

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [tick])

  const refresh = useCallback(() => {
    setStatus(null)
    setTick(value => value + 1)
  }, [])

  return { status, refresh }
}
