import { createContext, useContext } from 'react'

import type { RelationshipAnalytics } from '@/lib/analytics/relationships'
import type { ImportResult } from '@/lib/instagram/importExport'
import type { FileReport, ParseIssue } from '@/lib/instagram/types'
import type { Snapshot } from '@/lib/storage/snapshots'

export type SessionOrigin = 'import' | 'snapshot' | 'sample'

/** The analysis currently on screen. Held in memory only, unless the user chose to save a snapshot. */
export type Session = {
  analysis: RelationshipAnalytics
  origin: SessionOrigin
  fileName: string
  fileSize: number
  analyzedAt: string
  snapshotId: string | null
  files: FileReport[]
  issues: ParseIssue[]
  recordsSeen: { followers: number; following: number }
}

export type Settings = {
  rowsPerPage: 25 | 50 | 100
  /** Pre-ticks "save a snapshot on this device" on the import screen. Never saves anything by itself. */
  saveByDefault: boolean
}

export const DEFAULT_SETTINGS: Settings = { rowsPerPage: 25, saveByDefault: false }

export type SaveOutcome = { saved: Snapshot | null; duplicateOf: Snapshot | null }

export type AppData = {
  session: Session | null
  /** Saved snapshots, oldest first. */
  snapshots: Snapshot[]
  /** False when this browser cannot persist data (for example IndexedDB is blocked). */
  storeAvailable: boolean
  loading: boolean
  storageError: string | null
  settings: Settings
  updateSettings: (patch: Partial<Settings>) => void
  startSession: (result: ImportResult, options: { save: boolean; label: string }) => Promise<SaveOutcome>
  saveCurrent: (label?: string) => Promise<SaveOutcome>
  loadSnapshot: (id: string) => void
  loadSample: () => void
  deleteSnapshot: (id: string) => Promise<void>
  deleteAllSnapshots: () => Promise<void>
  clearSession: () => void
}

export const AppDataContext = createContext<AppData | null>(null)

export const useAppData = (): AppData => {
  const value = useContext(AppDataContext)

  if (value === null) throw new Error('useAppData must be used inside DataProvider')

  return value
}
