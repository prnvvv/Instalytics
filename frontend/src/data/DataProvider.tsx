import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import { computeRelationships } from '@/lib/analytics/relationships'
import type { ImportResult } from '@/lib/instagram/importExport'
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

const sessionFromSnapshot = (snapshot: Snapshot): Session => ({
  analysis: computeRelationships(fromStored(snapshot.followers), fromStored(snapshot.following)),
  origin: 'snapshot',
  fileName: snapshot.source.fileName,
  fileSize: snapshot.source.fileSize,
  analyzedAt: snapshot.analyzedAt,
  snapshotId: snapshot.id,
  files: [],
  issues: [],
  recordsSeen: { followers: snapshot.counts.followers, following: snapshot.counts.following }
})

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

      const duplicateOf = findDuplicate(snapshots, current.analysis.followers, current.analysis.following) ?? null

      if (duplicateOf) return { saved: null, duplicateOf }

      const snapshot = createSnapshot({
        followers: current.analysis.followers,
        following: current.analysis.following,
        analyzedAt: current.analyzedAt,
        fileName: current.fileName,
        fileSize: current.fileSize,
        label
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
      const next: Session = {
        analysis: computeRelationships(result.parsed.followers, result.parsed.following),
        origin: 'import',
        fileName: result.fileName,
        fileSize: result.fileSize,
        analyzedAt: result.analyzedAt,
        snapshotId: null,
        files: result.parsed.files,
        issues: result.parsed.issues,
        recordsSeen: result.parsed.recordsSeen
      }

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

    setSession({
      analysis: computeRelationships(followers, following),
      origin: 'sample',
      fileName: 'sample-data (synthetic)',
      fileSize: 0,
      analyzedAt: SAMPLE_ANALYZED_AT,
      snapshotId: null,
      files: [],
      issues: [],
      recordsSeen: { followers: followers.length, following: following.length }
    })
  }, [])

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
      deleteSnapshot,
      deleteAllSnapshots,
      clearSession
    ]
  )

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}
