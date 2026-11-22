/**
 * Snapshot comparison. Differences are between the contents of two exports. Snapshot timestamps record when
 * an export was analysed, not when a relationship actually changed, and the UI says so.
 */

import type { Account } from '../instagram/types'

export type SnapshotLists = { followers: readonly Account[]; following: readonly Account[] }

export type SnapshotComparison = {
  /** Now follow you, and did not in the older export. */
  gainedFollowers: Account[]
  /** Followed you in the older export and no longer appear. */
  lostFollowers: Account[]
  /** Accounts you now follow that you did not before. */
  newFollowing: Account[]
  /** Accounts you followed before that you no longer follow. */
  unfollowed: Account[]
  netFollowers: number
  netFollowing: number
}

const names = (accounts: readonly Account[]) => new Set(accounts.map(a => a.username))

const minus = (from: readonly Account[], remove: Set<string>) => from.filter(a => !remove.has(a.username))

export const compareSnapshots = (older: SnapshotLists, newer: SnapshotLists): SnapshotComparison => {
  const oldFollowers = names(older.followers)
  const newFollowers = names(newer.followers)
  const oldFollowing = names(older.following)
  const newFollowing = names(newer.following)

  return {
    gainedFollowers: minus(newer.followers, oldFollowers),
    lostFollowers: minus(older.followers, newFollowers),
    newFollowing: minus(newer.following, oldFollowing),
    unfollowed: minus(older.following, newFollowing),
    netFollowers: newFollowers.size - oldFollowers.size,
    netFollowing: newFollowing.size - oldFollowing.size
  }
}

export type ComparisonKind = 'gainedFollowers' | 'lostFollowers' | 'newFollowing' | 'unfollowed'
