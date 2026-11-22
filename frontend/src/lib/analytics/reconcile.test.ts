import { describe, expect, it } from 'vitest'

import { parseReported, reconcile, tolerance } from './reconcile'

const context = { notFollowingBack: 100, fans: 80, dateLimited: false }

describe('tolerance', () => {
  it('is half a percent of the count, but never less than two accounts', () => {
    expect(tolerance(100)).toBe(2)
    expect(tolerance(800)).toBe(4)
    expect(tolerance(10_000)).toBe(50)
  })
})

describe('reconcile', () => {
  it('treats a difference of one follower as a match (live count against a snapshot)', () => {
    const result = reconcile('followers', 799, 800, context)

    expect(result.verdict).toBe('match')
    expect(result.difference).toBe(-1)
    expect(result.title).toBe('Followers match')
    expect(result.detail).toMatch(/live/)
  })

  it('says so when the numbers are identical', () => {
    const result = reconcile('following', 750, 750, context)

    expect(result.verdict).toBe('match')
    expect(result.title).toBe('Following match exactly')
  })

  it('explains an export that lists more accounts than Instagram shows, without claiming to know why', () => {
    const result = reconcile('following', 780, 750, context)

    expect(result.verdict).toBe('export-has-more')
    expect(result.difference).toBe(30)
    expect(result.title).toBe('The export lists 30 more accounts than Instagram shows')
    expect(result.detail).toMatch(/deactivated or deleted/)
    expect(result.detail).toMatch(/cannot say which ones/)
    // If the surplus is inactive accounts, "not following back" would shrink by exactly that much.
    expect(result.detail).toContain('closer to 70 than 100')
    expect(result.detail).toMatch(/not following back/)
  })

  it('never lets the estimate go below zero', () => {
    const result = reconcile('following', 200, 100, { ...context, notFollowingBack: 30 })

    expect(result.detail).toContain('closer to 0 than 30')
  })

  it('uses fans for a surplus of followers', () => {
    const result = reconcile('followers', 1000, 950, context)

    expect(result.verdict).toBe('export-has-more')
    expect(result.detail).toContain('"fans"')
    expect(result.detail).toContain('closer to 30 than 80')
  })

  it('treats a shortfall as a possibly incomplete export and points at the date range', () => {
    const result = reconcile('followers', 400, 900, { ...context, dateLimited: true })

    expect(result.verdict).toBe('export-has-fewer')
    expect(result.title).toBe('The export lists 500 fewer accounts than Instagram shows')
    expect(result.detail).toMatch(/already flagged as possibly limited to a date range/)
    expect(result.detail).toMatch(/All time/)
  })

  it('suggests checking the warnings when the shortfall has no flag yet', () => {
    const result = reconcile('following', 900, 950, context)

    expect(result.verdict).toBe('export-has-fewer')
    expect(result.detail).toMatch(/Check the warnings above/)
  })

  it('keeps small differences as a match at every size, and reports the first difference beyond tolerance', () => {
    expect(reconcile('following', 751, 750, context).verdict).toBe('match')
    expect(reconcile('following', 10_000, 9_999, context).verdict).toBe('match')
    expect(reconcile('following', 5, 1, context).title).toBe('The export lists 4 more accounts than Instagram shows')
    // 800 followers: tolerance is 4, so 5 more is the first difference that is reported.
    expect(reconcile('followers', 804, 800, context).verdict).toBe('match')
    expect(reconcile('followers', 805, 800, context).verdict).toBe('export-has-more')
  })
})

describe('parseReported', () => {
  it.each([
    ['800', 800],
    [' 1,204 ', 1204],
    ['1 204', 1204],
    ['0', 0]
  ])('reads %j', (text, expected) => {
    expect(parseReported(text)).toBe(expected)
  })

  it.each(['', '  ', 'abc', '-5', '1.5', '12abc', '9999999999', '1e3'])('rejects %j as not entered', text => {
    expect(parseReported(text)).toBeNull()
  })
})
