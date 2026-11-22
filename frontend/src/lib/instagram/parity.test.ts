/**
 * Runs the shared parser parity cases (docs/parser/parity-cases.json) against the frontend parser.
 *
 * The backend runs the very same file in backend/tests/test_parity_cases.py, so the two ports of the parser cannot
 * silently drift apart. All data in the file is synthetic.
 */

/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { computeRelationships } from '../analytics/relationships'
import { buildProfileUrl } from './normalize'
import { parseExportFiles } from './parse'

type Totals = Partial<Record<'recordsSeen' | 'validRecords' | 'rejectedRecords' | 'duplicatesRemoved' | 'uniqueAccounts' | 'sourceFiles', number>>

type Case = {
  name: string
  files: Record<string, unknown>
  expect: {
    followers: string[]
    following: string[]
    issues: string[]
    status: string
    totals?: { followers?: Totals; following?: Totals }
  }
}

type AnalyticsCase = {
  name: string
  followers: string[]
  following: string[]
  expect: {
    followersCount: number
    followingCount: number
    mutualCount: number
    notFollowingBackCount: number
    fansCount: number
    uniqueAccountsCount: number
    mutualityRate: number | null
    followBackRate: number | null
    followerToFollowingRatio: number | null
    mutuals: string[]
    notFollowingBack: string[]
    fans: string[]
  }
}

// The tests run with the frontend folder as the working directory; the shared file lives in the repo's docs.
const file = JSON.parse(readFileSync(join(process.cwd(), '..', 'docs', 'parser', 'parity-cases.json'), 'utf-8')) as {
  cases: Case[]
  analytics: AnalyticsCase[]
}
const cases = file.cases
const analytics = file.analytics

const encode = (value: unknown) =>
  value !== null && typeof value === 'object' && Object.keys(value).join() === '__raw'
    ? String((value as { __raw: unknown }).__raw)
    : JSON.stringify(value)

describe('parser parity with the backend', () => {
  it.each(cases.map(c => [c.name, c] as const))('%s', (_name, c) => {
    const result = parseExportFiles(Object.fromEntries(Object.entries(c.files).map(([path, value]) => [path, encode(value)])))

    expect(result.followers.map(a => a.username).sort()).toEqual([...c.expect.followers].sort())
    expect(result.following.map(a => a.username).sort()).toEqual([...c.expect.following].sort())
    expect(result.issues.map(i => i.code).sort()).toEqual([...c.expect.issues].sort())
    expect(result.diagnostics.status).toBe(c.expect.status)
    expect(result.diagnostics.appearsComplete).toBe(c.expect.status === 'complete')

    for (const kind of ['followers', 'following'] as const) {
      for (const [key, want] of Object.entries(c.expect.totals?.[kind] ?? {})) {
        expect(result.diagnostics[kind][key as keyof Totals], `${kind}.${key}`).toBe(want)
      }
    }
  })

  it.each(analytics.map(c => [c.name, c] as const))('analytics: %s', (_name, c) => {
    const account = (username: string) => ({ username, profileUrl: buildProfileUrl(username), followedAt: null })
    const result = computeRelationships(c.followers.map(account), c.following.map(account))
    const e = c.expect

    expect(result.followersCount).toBe(e.followersCount)
    expect(result.followingCount).toBe(e.followingCount)
    expect(result.mutualCount).toBe(e.mutualCount)
    expect(result.notFollowingBackCount).toBe(e.notFollowingBackCount)
    expect(result.fansCount).toBe(e.fansCount)
    expect(result.uniqueAccountsCount).toBe(e.uniqueAccountsCount)

    for (const key of ['mutualityRate', 'followBackRate', 'followerToFollowingRatio'] as const) {
      if (e[key] === null) expect(result[key]).toBeNull()
      else expect(result[key]).toBeCloseTo(e[key] as number)
    }

    expect(result.mutuals.map(a => a.username)).toEqual(e.mutuals)
    expect(result.notFollowingBack.map(a => a.username)).toEqual(e.notFollowingBack)
    expect(result.fans.map(a => a.username)).toEqual(e.fans)
  })

  it('has unique names and covers the main scenarios', () => {
    const names = cases.map(c => c.name)

    expect(cases.length).toBeGreaterThanOrEqual(15)
    expect(new Set(names).size).toBe(names.length)
    for (const needle of ['aggregated', 'gap in numbered parts', 'look-alike', 'label_values', 'malformed']) {
      expect(names.some(name => name.includes(needle)), needle).toBe(true)
    }
  })
})
