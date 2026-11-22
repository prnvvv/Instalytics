import { describe, expect, it } from 'vitest'

import { buildProfileUrl } from '../instagram/normalize'
import type { Account } from '../instagram/types'
import { listStats, summarizeKind } from './categories'
import { accountsOfKind, computeRelationships } from './relationships'

const DAY = 86_400
const REF = Date.UTC(2026, 5, 30) / 1000

const acc = (username: string, followedAt: number | null = null): Account => ({ username, profileUrl: buildProfileUrl(username), followedAt })

describe('listStats', () => {
  it('is empty and honest about missing dates', () => {
    const stats = listStats([acc('a'), acc('b')], REF)

    expect(stats).toMatchObject({ count: 2, withDates: 0, newest: null, oldest: null, last30: 0, busiest: null, byYear: [] })
  })

  it('counts recent and old accounts back from the reference time', () => {
    const stats = listStats([acc('a', REF - 5 * DAY), acc('b', REF - 29 * DAY), acc('c', REF - 100 * DAY), acc('d', REF - 400 * DAY), acc('e')], REF)

    expect(stats.count).toBe(5)
    expect(stats.withDates).toBe(4)
    expect(stats.last30).toBe(2)
    expect(stats.last365).toBe(3)
    expect(stats.olderThanYear).toBe(1)
    expect(stats.newest).toBe(REF - 5 * DAY)
    expect(stats.oldest).toBe(REF - 400 * DAY)
  })

  it('ignores dates after the reference time for the recent counts', () => {
    expect(listStats([acc('a', REF + 5 * DAY)], REF).last30).toBe(0)
  })

  it('finds the busiest month and groups by year in order', () => {
    const march = Date.UTC(2025, 2, 10) / 1000
    const stats = listStats([acc('a', march), acc('b', march + DAY), acc('c', Date.UTC(2026, 0, 5) / 1000)], REF)

    expect(stats.busiest).toEqual({ label: 'Mar 2025', count: 2 })
    expect(stats.byYear).toEqual([
      { year: 2025, count: 2 },
      { year: 2026, count: 1 }
    ])
  })
})

describe('summarizeKind', () => {
  const followers = [acc('m1', REF - 3 * DAY), acc('m2', REF - 200 * DAY), acc('fan1', REF - 10 * DAY)]
  const following = [acc('m1', REF - 50 * DAY), acc('m2', REF - 60 * DAY), acc('ghost1', REF - 500 * DAY), acc('ghost2', REF - 2 * DAY)]
  const analysis = computeRelationships(followers, following)
  const of = (kind: Parameters<typeof accountsOfKind>[1]) => summarizeKind(kind, analysis, accountsOfKind(analysis, kind), REF)

  it('splits followers into mutuals and fans', () => {
    const summary = of('followers')

    expect(summary.composition.parts.map(p => p.value)).toEqual([2, 1])
    expect(summary.insights[0].text).toContain('2 of your 3 followers')
    expect(summary.insights.some(i => i.id === 'recent')).toBe(true)
  })

  it('reports the follow-back share for following', () => {
    expect(of('following').insights[0].text).toBe('2 of the 4 accounts you follow (50%) follow you back.')
  })

  it('points at accounts followed for over a year and recent ones among those not following back', () => {
    const texts = of('not-following-back').insights.map(i => i.text)

    expect(texts[0]).toContain('2 of the 4 accounts you follow (50%) do not follow you back')
    expect(texts.some(t => t.includes('for more than a year'))).toBe(true)
    expect(texts.some(t => t.includes('may not have had time'))).toBe(true)
  })

  it('describes fans and mutuals against the right whole', () => {
    expect(of('fans').composition).toMatchObject({ total: 3, caption: 'of your 3 followers' })
    expect(of('mutuals').composition).toMatchObject({ total: 5, caption: 'of 5 unique accounts' })
  })

  it('makes no claim about dates the export does not have', () => {
    const bare = computeRelationships([acc('a'), acc('b')], [acc('a'), acc('c')])
    const summary = summarizeKind('not-following-back', bare, bare.notFollowingBack, REF)

    expect(summary.stats.withDates).toBe(0)
    expect(summary.insights.map(i => i.id)).toEqual(['share'])
  })

  it('handles an empty network', () => {
    const empty = computeRelationships([], [])

    for (const kind of ['followers', 'following', 'mutuals', 'not-following-back', 'fans'] as const) {
      expect(() => summarizeKind(kind, empty, [], REF)).not.toThrow()
    }
  })
})
