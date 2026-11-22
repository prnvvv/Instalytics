/**
 * Local, opt-in snapshot persistence.
 *
 * Only derived data is ever stored: the follower and following lists (username and timestamp) and counts.
 * The uploaded ZIP is never stored. Everything stays in this browser (IndexedDB) until the user deletes it.
 */

import { buildProfileUrl } from '../instagram/normalize'
import { PARSER_VERSION, type Account } from '../instagram/types'

/** Compact stored form of an account: [username, followedAt or 0]. */
export type StoredAccount = [string, number]

export type Snapshot = {
  id: string
  /** When the export was analysed (ISO). Not the time any relationship changed. */
  analyzedAt: string
  label: string
  parserVersion: string
  source: { fileName: string; fileSize: number }
  counts: { followers: number; following: number }
  followers: StoredAccount[]
  following: StoredAccount[]
}

export type SnapshotMeta = Omit<Snapshot, 'followers' | 'following'>

export interface SnapshotStore {
  list(): Promise<Snapshot[]>
  put(snapshot: Snapshot): Promise<void>
  delete(id: string): Promise<void>
  clear(): Promise<void>
}

const toStored = (accounts: readonly Account[]): StoredAccount[] => accounts.map(a => [a.username, a.followedAt ?? 0])

export const fromStored = (stored: readonly StoredAccount[]): Account[] =>
  stored.map(([username, timestamp]) => ({
    username,
    profileUrl: buildProfileUrl(username),
    followedAt: timestamp > 0 ? timestamp : null
  }))

export const createSnapshot = (input: {
  followers: readonly Account[]
  following: readonly Account[]
  analyzedAt: string
  fileName: string
  fileSize: number
  label?: string
}): Snapshot => ({
  id: crypto.randomUUID(),
  analyzedAt: input.analyzedAt,
  label: input.label?.trim() || '',
  parserVersion: PARSER_VERSION,
  source: { fileName: input.fileName, fileSize: input.fileSize },
  counts: { followers: input.followers.length, following: input.following.length },
  followers: toStored(input.followers),
  following: toStored(input.following)
})

/** A stable fingerprint of the two lists, to detect re-importing an identical export. */
export const fingerprint = (followers: readonly { username: string }[], following: readonly { username: string }[]) => {
  const part = (items: readonly { username: string }[]) =>
    items
      .map(a => a.username)
      .sort()
      .join(',')

  return `${followers.length}:${following.length}:${part(followers)}|${part(following)}`
}

export const findDuplicate = (
  snapshots: readonly Snapshot[],
  followers: readonly Account[],
  following: readonly Account[]
) => {
  const target = fingerprint(followers, following)

  return snapshots.find(
    s =>
      s.counts.followers === followers.length &&
      s.counts.following === following.length &&
      fingerprint(
        s.followers.map(([username]) => ({ username })),
        s.following.map(([username]) => ({ username }))
      ) === target
  )
}

/** Approximate bytes used by saved snapshots, for the settings page. */
export const approximateSize = (snapshots: readonly Snapshot[]) =>
  snapshots.reduce((sum, s) => sum + JSON.stringify(s).length, 0)

export class MemorySnapshotStore implements SnapshotStore {
  private items = new Map<string, Snapshot>()

  async list() {
    return [...this.items.values()]
  }

  async put(snapshot: Snapshot) {
    this.items.set(snapshot.id, structuredClone(snapshot))
  }

  async delete(id: string) {
    this.items.delete(id)
  }

  async clear() {
    this.items.clear()
  }
}

const DB_NAME = 'inyx'
const STORE = 'snapshots'

const request = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })

export class IndexedDbSnapshotStore implements SnapshotStore {
  private dbPromise: Promise<IDBDatabase> | null = null

  private open() {
    this.dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)

      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' })
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })

    return this.dbPromise
  }

  private async store(mode: IDBTransactionMode) {
    return (await this.open()).transaction(STORE, mode).objectStore(STORE)
  }

  async list() {
    return request((await this.store('readonly')).getAll() as IDBRequest<Snapshot[]>)
  }

  async put(snapshot: Snapshot) {
    await request((await this.store('readwrite')).put(snapshot))
  }

  async delete(id: string) {
    await request((await this.store('readwrite')).delete(id))
  }

  async clear() {
    await request((await this.store('readwrite')).clear())
  }
}

/** The real store when IndexedDB exists, otherwise null (saving is then unavailable). */
export const createBrowserStore = (): SnapshotStore | null =>
  typeof indexedDB === 'undefined' ? null : new IndexedDbSnapshotStore()
