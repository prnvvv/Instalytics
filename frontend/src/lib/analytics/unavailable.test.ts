import { describe, expect, it } from 'vitest'

import { buildProfileUrl } from '../instagram/normalize'
import type { Account } from '../instagram/types'
import { createSnapshot, effectiveCounts } from '../storage/snapshots'
import { computeRelationships } from './relationships'
import { excludeUnavailable, isReason, unavailableAccounts, updateMarks, updateReasons } from './unavailable'

const acc = (username: string): Account => ({ username, profileUrl: buildProfileUrl(username), followedAt: null })
const accs = (...names: string[]) => names.map(acc)
const names = (items: Account[]) => items.map(a => a.username)

describe('excludeUnavailable', () => {
  it('removes marked accounts and leaves the rest in order', () => {
    expect(names(excludeUnavailable(accs('a', 'b', 'c'), new Set(['b'])))).toEqual(['a', 'c'])
  })

  it('returns a copy when nothing is marked, and ignores marks for accounts that are not there', () => {
    const input = accs('a', 'b')

    expect(excludeUnavailable(input, new Set())).toEqual(input)
    expect(excludeUnavailable(input, new Set())).not.toBe(input)
    expect(names(excludeUnavailable(input, new Set(['zzz'])))).toEqual(['a', 'b'])
  })
})

describe('unavailableAccounts', () => {
  it('lists each marked account once, from either list, sorted', () => {
    const result = unavailableAccounts(accs('b', 'c'), accs('a', 'b', 'd'), new Set(['b', 'a', 'x']))

    expect(names(result)).toEqual(['a', 'b'])
  })
})

describe('updateMarks', () => {
  it('adds and removes without duplicates and keeps the result sorted', () => {
    expect(updateMarks(['b'], ['a', 'b', 'c'], true)).toEqual(['a', 'b', 'c'])
    expect(updateMarks(['a', 'b', 'c'], ['b', 'zzz'], false)).toEqual(['a', 'c'])
    expect(updateMarks([], [], true)).toEqual([])
  })
})

describe('updateReasons', () => {
  const marks = new Set(['a', 'b'])

  it('records a reason for marked accounts and clears it when none is given', () => {
    expect(updateReasons({}, ['a', 'b'], 'deleted', marks)).toEqual({ a: 'deleted', b: 'deleted' })
    expect(updateReasons({ a: 'deleted', b: 'blocked' }, ['a'], undefined, marks)).toEqual({ b: 'blocked' })
  })

  it('drops reasons for accounts that are no longer marked', () => {
    expect(updateReasons({ a: 'deleted', b: 'blocked' }, ['a'], undefined, new Set(['b']))).toEqual({ b: 'blocked' })
    expect(updateReasons({ z: 'suspended' }, [], undefined, marks)).toEqual({})
  })

  it('recognises only known reasons', () => {
    expect(isReason('suspended')).toBe(true)
    expect(isReason('whatever')).toBe(false)
    expect(isReason(undefined)).toBe(false)
  })
})

describe('figures with marks applied', () => {
  it('removes a marked mutual from both lists, so every metric stays consistent', () => {
    const followers = accs('a', 'b', 'c')
    const following = accs('b', 'c', 'd')
    const marked = new Set(['b', 'd'])
    const result = computeRelationships(excludeUnavailable(followers, marked), excludeUnavailable(following, marked))

    expect(result.followersCount).toBe(2)
    expect(result.followingCount).toBe(1)
    expect(names(result.mutuals)).toEqual(['c'])
    expect(result.notFollowingBackCount).toBe(0)
    expect(names(result.fans)).toEqual(['a'])
    expect(result.followBackRate).toBe(100)
  })

  it('can leave a list empty, and rates become undefined rather than zero', () => {
    const result = computeRelationships([], excludeUnavailable(accs('a'), new Set(['a'])))

    expect(result.followBackRate).toBeNull()
    expect(result.followerToFollowingRatio).toBeNull()
  })
})

describe('snapshot marks', () => {
  const base = { analyzedAt: '2026-01-01T00:00:00.000Z', fileName: 'x.zip', fileSize: 1 }

  it('keeps the complete lists and stores the marks beside them', () => {
    const snapshot = createSnapshot({ ...base, followers: accs('a', 'b'), following: accs('b', 'c'), unavailable: ['c'] })

    expect(snapshot.unavailable).toEqual(['c'])
    expect(snapshot.counts).toEqual({ followers: 2, following: 2 })
    expect(snapshot.following).toHaveLength(2)
    expect(effectiveCounts(snapshot)).toEqual({ followers: 2, following: 1 })
  })

  it('omits the field when nothing is marked and reports the stored counts', () => {
    const snapshot = createSnapshot({ ...base, followers: accs('a'), following: accs('b'), unavailable: [] })

    expect('unavailable' in snapshot).toBe(false)
    expect(effectiveCounts(snapshot)).toEqual(snapshot.counts)
  })
})
