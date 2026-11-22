import { describe, expect, it } from 'vitest'

import { toCsv, accountsToCsv } from '../csv'
import { buildProfileUrl } from '../instagram/normalize'
import type { Account } from '../instagram/types'
import { SAMPLE_ANALYZED_AT, buildSampleData } from '../sample'
import { createSnapshot, findDuplicate, fromStored, MemorySnapshotStore } from '../storage/snapshots'
import { monthlyActivity, timestampCoverage } from './activity'
import { compareSnapshots } from './compare'
import { buildInsights } from './insights'
import { accountsOfKind, computeRelationships, relationshipOf } from './relationships'

const acc = (username: string, followedAt: number | null = null): Account => ({
  username,
  profileUrl: buildProfileUrl(username),
  followedAt
})
const accs = (...names: string[]) => names.map(n => acc(n))
const names = (items: Account[]) => items.map(a => a.username)

describe('computeRelationships', () => {
  it('partitions followers and following', () => {
    const result = computeRelationships(accs('a', 'b', 'c'), accs('b', 'c', 'd', 'e'))

    expect(names(result.mutuals)).toEqual(['b', 'c'])
    expect(names(result.notFollowingBack)).toEqual(['d', 'e'])
    expect(names(result.fans)).toEqual(['a'])
    expect(result).toMatchObject({
      followersCount: 3,
      followingCount: 4,
      mutualCount: 2,
      notFollowingBackCount: 2,
      fansCount: 1,
      uniqueAccountsCount: 5
    })
  })

  it('computes the documented rates', () => {
    const result = computeRelationships(accs('a', 'b', 'c'), accs('b', 'c', 'd', 'e'))

    expect(result.mutualityRate).toBeCloseTo((2 / 5) * 100)
    expect(result.followBackRate).toBeCloseTo((2 / 4) * 100)
    expect(result.followerToFollowingRatio).toBeCloseTo(3 / 4)
  })

  it('keeps the partition invariants on a large overlap', () => {
    const result = computeRelationships(accs(...'abcdef'), accs(...'defghi'))

    expect(result.mutualCount + result.fansCount).toBe(result.followersCount)
    expect(result.mutualCount + result.notFollowingBackCount).toBe(result.followingCount)
    expect(result.mutualCount + result.fansCount + result.notFollowingBackCount).toBe(result.uniqueAccountsCount)
  })

  it('returns null, not zero, when a denominator is zero', () => {
    const empty = computeRelationships([], [])

    expect(empty.mutualityRate).toBeNull()
    expect(empty.followBackRate).toBeNull()
    expect(empty.followerToFollowingRatio).toBeNull()

    const noFollowing = computeRelationships(accs('a', 'b'), [])

    expect(noFollowing.followBackRate).toBeNull()
    expect(noFollowing.followerToFollowingRatio).toBeNull()
    expect(noFollowing.mutualityRate).toBe(0)
    expect(names(noFollowing.fans)).toEqual(['a', 'b'])

    const noFollowers = computeRelationships([], accs('a'))

    expect(noFollowers.followerToFollowingRatio).toBe(0)
    expect(noFollowers.followBackRate).toBe(0)
  })

  it('counts duplicates once and is order-independent', () => {
    const result = computeRelationships(accs('a', 'a', 'b'), accs('a', 'a', 'a'))

    expect(result.followersCount).toBe(2)
    expect(result.followingCount).toBe(1)
    expect(computeRelationships(accs('z', 'm', 'a'), accs('m', 'q'))).toEqual(computeRelationships(accs('a', 'm', 'z'), accs('q', 'm')))
  })

  it('uses the followers-side record for mutuals', () => {
    const result = computeRelationships([acc('a', 1_700_000_000)], [acc('a', 1_600_000_000)])

    expect(result.mutuals[0].followedAt).toBe(1_700_000_000)
  })

  it('selects lists by kind and relates single accounts', () => {
    const result = computeRelationships(accs('a', 'b'), accs('b', 'c'))

    expect(names(accountsOfKind(result, 'fans'))).toEqual(['a'])
    expect(names(accountsOfKind(result, 'not-following-back'))).toEqual(['c'])
    expect(relationshipOf(result, 'b')).toBe('mutual')
    expect(relationshipOf(result, 'a')).toBe('fan')
    expect(relationshipOf(result, 'c')).toBe('not-following-back')
    expect(relationshipOf(result, 'zzz')).toBeNull()
  })

  it('handles a large dataset quickly', () => {
    const followers = accs(...Array.from({ length: 60_000 }, (_, i) => `user${i}`))
    const following = accs(...Array.from({ length: 60_000 }, (_, i) => `user${i + 30_000}`))
    const started = performance.now()
    const result = computeRelationships(followers, following)

    expect(result.mutualCount).toBe(30_000)
    expect(performance.now() - started).toBeLessThan(5000)
  })
})

describe('compareSnapshots', () => {
  it('finds gained and lost followers and new and removed follows', () => {
    const comparison = compareSnapshots(
      { followers: accs('a', 'b', 'c'), following: accs('x', 'y') },
      { followers: accs('b', 'c', 'd', 'e'), following: accs('y', 'z') }
    )

    expect(names(comparison.gainedFollowers)).toEqual(['d', 'e'])
    expect(names(comparison.lostFollowers)).toEqual(['a'])
    expect(names(comparison.newFollowing)).toEqual(['z'])
    expect(names(comparison.unfollowed)).toEqual(['x'])
    expect(comparison.netFollowers).toBe(1)
    expect(comparison.netFollowing).toBe(0)
  })

  it('reports no change for identical snapshots', () => {
    const lists = { followers: accs('a'), following: accs('b') }
    const comparison = compareSnapshots(lists, lists)

    expect(comparison.gainedFollowers).toEqual([])
    expect(comparison.lostFollowers).toEqual([])
    expect(comparison.netFollowers).toBe(0)
  })
})

describe('activity and insights', () => {
  it('buckets by month using only timestamps that exist', () => {
    const t = (y: number, m: number) => Date.UTC(y, m, 10) / 1000
    const buckets = monthlyActivity([acc('a', t(2026, 5)), acc('b', t(2026, 5)), acc('c', t(2026, 3)), acc('d')], 4)!

    expect(buckets.map(b => b.label)).toEqual(['Mar 2026', 'Apr 2026', 'May 2026', 'Jun 2026'])
    expect(buckets.map(b => b.count)).toEqual([0, 1, 0, 2])
  })

  it('returns null when no account has a timestamp', () => {
    expect(monthlyActivity(accs('a', 'b'))).toBeNull()
    expect(timestampCoverage(accs('a'))).toBe(0)
    expect(timestampCoverage([acc('a', 1_700_000_000), acc('b')])).toBe(0.5)
  })

  it('writes only supported insights', () => {
    const insights = buildInsights(computeRelationships(accs('a', 'b'), accs('b', 'c', 'd')))
    const ids = insights.map(i => i.id)

    expect(ids).toEqual(['follow-back', 'not-following-back', 'fans', 'ratio'])
    expect(insights[0].text).toContain('1 account of the 3 you follow follow you back')
    expect(buildInsights(computeRelationships([], []))).toEqual([])
  })
})

describe('csv', () => {
  it('quotes cells and neutralises spreadsheet formulas', () => {
    const csv = toCsv([{ v: 'a,b' }, { v: '=HYPERLINK("x")' }, { v: 'say "hi"' }, { v: '@evil' }], [{ header: 'v', value: r => r.v }])

    expect(csv.split('\r\n')).toEqual(['v', '"a,b"', `"'=HYPERLINK(""x"")"`, '"say ""hi"""', "'@evil", ''])
  })

  it('exports accounts with ISO dates and a relationship column', () => {
    const csv = accountsToCsv([acc('alice', 1_700_000_000), acc('bob')], 'mutual')

    expect(csv.split('\r\n').slice(0, 3)).toEqual([
      'username,profile_url,followed_at,relationship',
      'alice,https://www.instagram.com/alice/,2023-11-14T22:13:20.000Z,mutual',
      'bob,https://www.instagram.com/bob/,,mutual'
    ])
  })
})

describe('snapshots', () => {
  const lists = { followers: [acc('a', 1_700_000_000), acc('b')], following: accs('b', 'c') }
  const make = (label = '') => createSnapshot({ ...lists, analyzedAt: '2026-01-01T00:00:00.000Z', fileName: 'export.zip', fileSize: 10, label })

  it('stores only derived lists and restores them', () => {
    const snapshot = make('  first  ')

    expect(snapshot.label).toBe('first')
    expect(snapshot.counts).toEqual({ followers: 2, following: 2 })
    expect(JSON.stringify(snapshot)).not.toMatch(/zip data|base64/i)

    const restored = fromStored(snapshot.followers)

    expect(restored[0]).toMatchObject({ username: 'a', followedAt: 1_700_000_000, profileUrl: 'https://www.instagram.com/a/' })
    expect(restored[1].followedAt).toBeNull()
  })

  it('detects an identical export regardless of order', () => {
    const existing = make()

    expect(findDuplicate([existing], [...lists.followers].reverse(), lists.following)).toBe(existing)
    expect(findDuplicate([existing], accs('a'), lists.following)).toBeUndefined()
  })

  it('round-trips through the in-memory store, copying on write', async () => {
    const store = new MemorySnapshotStore()
    const snapshot = make()

    await store.put(snapshot)
    snapshot.label = 'mutated afterwards'
    expect((await store.list())[0].label).toBe('')
    await store.delete(snapshot.id)
    expect(await store.list()).toEqual([])
  })
})

describe('sample data', () => {
  it('is synthetic, deterministic and internally consistent', () => {
    const first = buildSampleData()
    const second = buildSampleData()

    expect(first).toEqual(second)
    expect(SAMPLE_ANALYZED_AT).toMatch(/^2026/)
    expect(first.followers.every(a => a.username.startsWith('sample_user_'))).toBe(true)

    const result = computeRelationships(first.followers, first.following)

    expect(result.mutualCount).toBe(120)
    expect(result.fansCount).toBe(120)
    expect(result.notFollowingBackCount).toBe(80)
  })
})
