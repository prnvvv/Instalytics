import { describe, expect, it } from 'vitest'

import { followersEntry, followingEntry } from '../test-helpers'
import { detectExportDate } from './completeness'
import { parseExportFiles } from './parse'

const DAY = 86_400
const epoch = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 1000

const dated = (kind: 'followers' | 'following', count: number, first: number, stepDays: number) => {
  const entries = Array.from({ length: count }, (_, i) =>
    kind === 'followers'
      ? followersEntry(`g${String(i).padStart(4, '0')}`, Math.floor(first + i * stepDays * DAY))
      : followingEntry(`f${String(i).padStart(4, '0')}`, Math.floor(first + i * stepDays * DAY))
  )

  return JSON.stringify(kind === 'following' ? { relationships_following: entries } : entries)
}

const ROOT = 'instagram-someone-2026-11-22-AbCdEf/connections/followers_and_following/'
const codes = (result: { issues: { code: string }[] }) => result.issues.map(i => i.code)

describe('detectExportDate', () => {
  it.each([
    ['instagram-someone-2026-11-22-AbCdEf/connections/x.json', '2026-11-22'],
    ['Instagram-Some_One.99-2026-01-05/a/b.json', '2026-01-05'],
    ['instagram-x-2026-02-30-abc/a.json', null],
    ['connections/followers_and_following/x.json', null],
    ['my-export-2026-11-22/x.json', null]
  ])('%s', (path, expected) => {
    expect(detectExportDate([path])).toBe(expected)
  })
})

describe('the date-range heuristic', () => {
  it('flags followers cut to the last year while following goes back years', () => {
    const result = parseExportFiles({
      [`${ROOT}followers_1.json`]: dated('followers', 120, epoch(2025, 11, 27), 2.8),
      [`${ROOT}following.json`]: dated('following', 300, epoch(2022, 6, 7), 5)
    })
    const issue = result.issues.find(i => i.code === 'possible_date_range_limit')

    expect(issue?.severity).toBe('warning')
    expect(issue?.message).toMatch(/followers/)
    expect(issue?.message).toMatch(/All time/)
    expect(result.diagnostics.exportDate).toBe('2026-11-22')
    expect(result.diagnostics.status).toBe('warning')
    expect(result.diagnostics.appearsComplete).toBe(false)
  })

  it.each([30, 90])('detects the %i day preset', window => {
    const start = Date.UTC(2026, 10, 22) / 1000 - (window - 2) * DAY
    const result = parseExportFiles({
      [`${ROOT}followers_1.json`]: dated('followers', 60, start, (window - 3) / 60),
      [`${ROOT}following.json`]: dated('following', 200, epoch(2023, 1, 1), 10)
    })

    expect(codes(result)).toContain('possible_date_range_limit')
  })

  it('falls back to the latest timestamp when there is no export date', () => {
    const result = parseExportFiles({
      'followers_1.json': dated('followers', 120, epoch(2025, 11, 27), 2.8),
      'following.json': dated('following', 300, epoch(2022, 6, 7), 5)
    })

    expect(result.diagnostics.exportDate).toBeNull()
    expect(codes(result)).toContain('possible_date_range_limit')
  })

  it.each([
    ['lists that start together', epoch(2022, 6, 10), 7, 200, epoch(2022, 6, 7), 7, 200],
    ['a young account whose lists both start recently', epoch(2025, 12, 1), 4, 80, epoch(2025, 11, 25), 2.5, 120],
    ['too few dated accounts', epoch(2025, 11, 27), 30, 5, epoch(2022, 6, 7), 5, 300],
    ['followers that are not window-shaped', epoch(2026, 5, 6), 1.8, 100, epoch(2022, 6, 7), 5, 300]
  ])('does not flag %s', (_name, fFirst, fStep, fCount, gFirst, gStep, gCount) => {
    const result = parseExportFiles({
      [`${ROOT}followers_1.json`]: dated('followers', fCount, fFirst, fStep),
      [`${ROOT}following.json`]: dated('following', gCount, gFirst, gStep)
    })

    expect(codes(result)).not.toContain('possible_date_range_limit')
  })
})

describe('numbered parts', () => {
  const file = (name: string) => JSON.stringify([followersEntry(name)])
  const following = JSON.stringify({ relationships_following: [followingEntry('x')] })

  it('reports a gap and names the missing file', () => {
    const result = parseExportFiles({ 'followers_1.json': file('a'), 'followers_3.json': file('c'), 'following.json': following })
    const gap = result.issues.find(i => i.code === 'missing_part')

    expect(gap?.message).toContain('followers_2.json')
    expect(gap?.severity).toBe('error')
    expect(result.diagnostics.status).toBe('incomplete')
    expect(result.followers).toHaveLength(2)
  })

  it('treats starting at part two as part one missing', () => {
    const result = parseExportFiles({ 'followers_2.json': file('a'), 'following.json': following })

    expect(result.issues.find(i => i.code === 'missing_part')?.message).toContain('followers_1.json')
  })

  it('aggregates multi-digit parts and reports every gap between them', () => {
    const result = parseExportFiles({
      'e/followers_1.json': file('a'),
      'e/followers_2.json': file('b'),
      'e/followers_10.json': file('c'),
      'e/following.json': following
    })
    const message = result.issues.find(i => i.code === 'missing_part')?.message ?? ''

    expect(result.followers).toHaveLength(3)
    for (let n = 3; n <= 9; n++) expect(message).toContain(`followers_${n}.json`)
  })

  it('has no gap issue for contiguous parts', () => {
    const result = parseExportFiles({
      'followers_1.json': file('a'),
      'followers_2.json': file('b'),
      'following.json': following
    })

    expect(codes(result)).not.toContain('missing_part')
  })
})

describe('diagnostics never leak usernames', () => {
  it('keeps usernames and contents out of issues and diagnostics', () => {
    const secret = 'very_secret_person'
    const result = parseExportFiles({
      'followers_1.json': JSON.stringify([followersEntry(secret), { title: 'private display name', string_list_data: [{ value: 'bad name' }] }]),
      'followers_3.json': `{broken ${secret}`,
      'following.json': JSON.stringify({ relationships_following: [followingEntry('another_secret')] })
    })
    const dump = JSON.stringify({ issues: result.issues, diagnostics: result.diagnostics, files: result.files })

    expect(dump).not.toContain(secret)
    expect(dump).not.toContain('another_secret')
    expect(dump).not.toContain('private display name')
  })
})
