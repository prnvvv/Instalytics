import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { computeRelationships } from '@/lib/analytics/relationships'
import { excludeUnavailable, isReason, updateMarks, updateReasons, type Reasons } from '@/lib/analytics/unavailable'
import type { ImportResult } from '@/lib/instagram/importExport'
import type { Account } from '@/lib/instagram/types'
import { SAMPLE_ANALYZED_AT, buildSampleData } from '@/lib/sample'
import {
  createBrowserStore,
  createSnapshot,
  findDuplicate,
  fromStored,
  type Snapshot,
  type SnapshotStore
} from '@/lib/storage/snapshots'

import { AppDataContext, DEFAULT_SETTINGS, type AppData, type SaveOutcome, type Session, type Settings } from './context'

const SETTINGS_KEY = 'inyx.settings'

const loadSettings = (): Settings => {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)

    if (!raw) return DEFAULT_SETTINGS

    const parsed = JSON.parse(raw) as Partial<Settings>

    return {
      rowsPerPage: [25, 50, 100].includes(parsed.rowsPerPage as number) ? (parsed.rowsPerPage as Settings['rowsPerPage']) : 25,
      saveByDefault: parsed.saveByDefault === true
    }
  } catch {
    return DEFAULT_SETTINGS
  }
}

type SessionMeta = Omit<Session, 'analysis' | 'baseFollowers' | 'baseFollowing' | 'unavailable' | 'reasons'>

/** Builds a session whose figures exclude the accounts the user marked as unavailable. */
const buildSession = (
  followers: Account[],
  following: Account[],
  unavailable: string[],
  meta: SessionMeta,
  reasons: Reasons = {}
): Session => {
  const marked = new Set(unavailable)

  return {
    ...meta,
    baseFollowers: followers,
    baseFollowing: following,
    unavailable,
    reasons,
    analysis: computeRelationships(excludeUnavailable(followers, marked), excludeUnavailable(following, marked))
  }
}

const sessionFromSnapshot = (snapshot: Snapshot): Session => {
  const unavailable = [...(snapshot.unavailable ?? [])].sort()
  const marked = new Set(unavailable)
  // Only reasons we recognise, and only for accounts that are still marked.
  const reasons: Reasons = {}

  for (const [username, value] of Object.entries(snapshot.unavailableReasons ?? {})) {
    if (marked.has(username) && isReason(value)) reasons[username] = value
  }

  return buildSession(
    fromStored(snapshot.followers),
    fromStored(snapshot.following),
    unavailable,
    {
      origin: 'snapshot',
      fileName: snapshot.source.fileName,
      fileSize: snapshot.source.fileSize,
      analyzedAt: snapshot.analyzedAt,
      snapshotId: snapshot.id,
      diagnostics: null,
      completeness: snapshot.completeness?.status ?? null,
      issues: snapshot.completeness?.issues ?? []
    },
    reasons
  )
}

const byDate = (a: Snapshot, b: Snapshot) => (a.analyzedAt < b.analyzedAt ? -1 : a.analyzedAt > b.analyzedAt ? 1 : 0)

type PropsDataProvider = {
  children: ReactNode
  /** Injected in tests. Defaults to IndexedDB, or null when the browser has none. */
  store?: SnapshotStore | null
}

export const DataProvider = ({ children, store: injected }: PropsDataProvider) => {
  const store = useMemo(() => (injected !== undefined ? injected : createBrowserStore()), [injected])

  const [session, setSession] = useState<Session | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [loading, setLoading] = useState(store !== null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(loadSettings)

  // The first load may auto-open the latest saved snapshot, but never replaces an analysis opened since.
  const sessionRef = useRef(session)

  useEffect(() => {
    sessionRef.current = session
  }, [session])

  useEffect(() => {
    if (store === null) return

    let cancelled = false

    store
      .list()
      .then(items => {
        if (cancelled) return

        const sorted = [...items].sort(byDate)

        setSnapshots(sorted)

        if (sessionRef.current === null && sorted.length > 0) setSession(sessionFromSnapshot(sorted[sorted.length - 1]))
      })
      .catch(() => {
        if (!cancelled) setStorageError('Saved snapshots could not be read in this browser.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [store])

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings(current => {
      const next = { ...current, ...patch }

      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        // Settings still apply for this visit if storage is blocked.
      }

      return next
    })
  }, [])

  const persist = useCallback(
    async (current: Session, label: string): Promise<SaveOutcome> => {
      if (store === null || current.origin === 'sample' || current.snapshotId !== null) {
        return { saved: null, duplicateOf: null }
      }

      // The snapshot keeps the complete lists; the user's unavailable marks are stored beside them.
      const duplicateOf = findDuplicate(snapshots, current.baseFollowers, current.baseFollowing) ?? null

      if (duplicateOf) return { saved: null, duplicateOf }

      const snapshot = createSnapshot({
        followers: current.baseFollowers,
        following: current.baseFollowing,
        analyzedAt: current.analyzedAt,
        fileName: current.fileName,
        fileSize: current.fileSize,
        label,
        unavailable: current.unavailable,
        unavailableReasons: current.reasons,
        completeness:
          current.completeness === null
            ? undefined
            : {
                status: current.completeness,
                // Messages and codes only: issues never contain usernames or file contents.
                issues: current.issues.map(({ code, severity, message }) => ({ code, severity, message }))
              }
      })

      try {
        await store.put(snapshot)
      } catch {
        setStorageError('The snapshot could not be saved in this browser.')

        return { saved: null, duplicateOf: null }
      }

      setStorageError(null)
      setSnapshots(items => [...items, snapshot].sort(byDate))
      setSession(s => (s === current ? { ...s, snapshotId: snapshot.id } : s))

      return { saved: snapshot, duplicateOf: null }
    },
    [snapshots, store]
  )

  const startSession = useCallback<AppData['startSession']>(
    async (result: ImportResult, options) => {
      const next = buildSession(result.parsed.followers, result.parsed.following, [], {
        origin: 'import',
        fileName: result.fileName,
        fileSize: result.fileSize,
        analyzedAt: result.analyzedAt,
        snapshotId: null,
        diagnostics: result.parsed.diagnostics,
        completeness: result.parsed.diagnostics.status,
        issues: result.parsed.issues
      })

      setSession(next)

      return options.save ? persist(next, options.label) : { saved: null, duplicateOf: null }
    },
    [persist]
  )

  const saveCurrent = useCallback<AppData['saveCurrent']>(
    async label => (sessionRef.current ? persist(sessionRef.current, label ?? '') : { saved: null, duplicateOf: null }),
    [persist]
  )

  const loadSnapshot = useCallback(
    (id: string) => {
      const snapshot = snapshots.find(s => s.id === id)

      if (snapshot) setSession(sessionFromSnapshot(snapshot))
    },
    [snapshots]
  )

  const loadSample = useCallback(() => {
    const { followers, following } = buildSampleData()

    setSession(
      buildSession(followers, following, [], {
        origin: 'sample',
        fileName: 'sample-data (synthetic)',
        fileSize: 0,
        analyzedAt: SAMPLE_ANALYZED_AT,
        snapshotId: null,
        diagnostics: null,
        completeness: null,
        issues: []
      })
    )
  }, [])

  const setUnavailable = useCallback<AppData['setUnavailable']>(
    async (usernames, marked, reason) => {
      const current = sessionRef.current

      if (!current) return

      const unavailable = updateMarks(current.unavailable, usernames, marked)
      const reasons = updateReasons(current.reasons, usernames, marked ? reason : undefined, new Set(unavailable))
      const sameMarks = unavailable.length === current.unavailable.length && unavailable.every((u, i) => u === current.unavailable[i])
      const sameReasons = JSON.stringify(Object.entries(reasons).sort()) === JSON.stringify(Object.entries(current.reasons).sort())

      if (sameMarks && sameReasons) return

      const { analysis: _analysis, baseFollowers, baseFollowing, unavailable: _unavailable, reasons: _reasons, ...meta } = current
      const next = buildSession(baseFollowers, baseFollowing, unavailable, meta, reasons)

      // Updated at once so rapid consecutive ticks never start from a stale session.
      sessionRef.current = next
      setSession(next)

      // A saved analysis keeps the marks with its snapshot, in this browser only. Anything else is kept in memory.
      const snapshot = current.snapshotId ? snapshots.find(s => s.id === current.snapshotId) : undefined

      if (store !== null && snapshot) {
        const { unavailable: _old, unavailableReasons: _oldReasons, ...rest } = snapshot
        const updated: Snapshot =
          unavailable.length === 0
            ? rest
            : { ...rest, unavailable, ...(Object.keys(reasons).length > 0 ? { unavailableReasons: reasons } : {}) }

        try {
          await store.put(updated)
          setSnapshots(items => items.map(s => (s.id === updated.id ? updated : s)))
          setStorageError(null)
        } catch {
          setStorageError('Your marks could not be saved with the snapshot in this browser.')
        }
      }
    },
    [snapshots, store]
  )

  const clearUnavailable = useCallback(
    async () => setUnavailable(sessionRef.current?.unavailable ?? [], false),
    [setUnavailable]
  )

  const deleteSnapshot = useCallback(
    async (id: string) => {
      await store?.delete(id)
      setSnapshots(items => items.filter(s => s.id !== id))
      setSession(s => (s?.snapshotId === id ? { ...s, snapshotId: null } : s))
    },
    [store]
  )

  const deleteAllSnapshots = useCallback(async () => {
    await store?.clear()
    setSnapshots([])
    setSession(s => (s?.origin === 'snapshot' ? null : s ? { ...s, snapshotId: null } : s))
  }, [store])

  const clearSession = useCallback(() => setSession(null), [])

  const value = useMemo<AppData>(
    () => ({
      session,
      snapshots,
      storeAvailable: store !== null,
      loading,
      storageError,
      settings,
      updateSettings,
      startSession,
      saveCurrent,
      loadSnapshot,
      loadSample,
      setUnavailable,
      clearUnavailable,
      deleteSnapshot,
      deleteAllSnapshots,
      clearSession
    }),
    [
      session,
      snapshots,
      store,
      loading,
      storageError,
      settings,
      updateSettings,
      startSession,
      saveCurrent,
      loadSnapshot,
      loadSample,
      setUnavailable,
      clearUnavailable,
      deleteSnapshot,
      deleteAllSnapshots,
      clearSession
    ]
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
