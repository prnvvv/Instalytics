/**
 * Deciding whether an extraction looks complete, and saying why not (port of backend parser/completeness.py).
 *
 * Nothing here can know an account's true follower count. It can only notice signals in the export itself: files
 * that are missing or unreadable, gaps in numbered parts, records that were rejected, and lists whose dates look
 * cut off by a date range chosen when the export was requested. Each signal becomes an issue so partial data is
 * never reported as a clean success.
 */

import { normalizeMemberPath } from './discovery'
import type { CompletenessStatus, ConnectionKind, FileReport, ListTotals, ParseIssue } from './types'

// Export date range presets Instagram offers, in days (last week, month, 3 months, year).
const WINDOWS_DAYS = [7, 30, 90, 365]
// Too few dated accounts say nothing about a date window.
const MIN_DATED_ACCOUNTS = 10
// Slack around the window edge: the export date is approximate and the first account lands a few days in.
const EDGE_SLACK_DAYS = 7
// A list is only suspected of being cut when the other list reaches back at least this far beyond the window.
const CORROBORATION_DAYS = 14
const DAY_MS = 86_400_000

const EXPORT_FOLDER_DATE = /^instagram-.*?-(\d{4}-\d{2}-\d{2})(?:-[^/]*)?$/i

/** True only for a real calendar date. Date.parse alone would roll 2026-02-30 over to March 2. */
const isRealDate = (iso: string) => {
  const [year, month, day] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** The date in an instagram-<name>-YYYY-MM-DD-<id> folder name (only the date is read), as YYYY-MM-DD. */
export const detectExportDate = (paths: Iterable<string>): string | null => {
  for (const path of paths) {
    for (const part of normalizeMemberPath(path).split('/').slice(0, -1)) {
      const match = EXPORT_FOLDER_DATE.exec(part)

      if (match && isRealDate(match[1])) return match[1]
    }
  }

  return null
}

/** Numbers absent from the sequence of <kind>_N.json parts (numbering starts at 1). */
export const missingParts = (reports: readonly FileReport[], kind: ConnectionKind): number[] => {
  const numbers = new Set(reports.filter(r => r.kind === kind && r.part !== null).map(r => r.part as number))

  if (numbers.size === 0) return []

  const gaps: number[] = []

  for (let n = 1; n <= Math.max(...numbers); n++) if (!numbers.has(n)) gaps.push(n)

  return gaps
}

/** File names processed from more than one place (for example the export unpacked twice). */
export const duplicateSources = (reports: readonly FileReport[]): [string, number][] => {
  const counts = new Map<string, number>()

  for (const r of reports) {
    const key = `${r.path.split('/').pop()!.toLowerCase()}\u0000${r.kind}`

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return [...counts.entries()].filter(([, count]) => count > 1).map(([key, count]) => [key.split('\u0000')[0], count])
}

/**
 * Flag a list that starts just inside a preset date window while the other goes further back. Example: followers
 * start 360 days before the export while following goes back four years. That pattern is what an export limited to
 * "last year" produces. It is a heuristic and is reported as a warning, never as a certainty.
 */
export const detectDateRangeLimit = (
  totals: Record<ConnectionKind, ListTotals>,
  exportDate: string | null
): ParseIssue[] => {
  const spans = new Map<ConnectionKind, [number, number]>()

  for (const kind of ['followers', 'following'] as const) {
    const t = totals[kind]

    if (t.earliest !== null && t.latest !== null && t.withTimestamp >= MIN_DATED_ACCOUNTS) {
      spans.set(kind, [t.earliest * 1000, t.latest * 1000])
    }
  }

  if (spans.size < 2) return []

  // The day after the export date, at midnight UTC; otherwise the latest dated account.
  const reference = exportDate
    ? Date.parse(`${exportDate}T00:00:00Z`) + DAY_MS
    : Math.max(...[...spans.values()].map(([, latest]) => latest))
  const issues: ParseIssue[] = []

  for (const [kind, otherKind] of [
    ['followers', 'following'],
    ['following', 'followers']
  ] as const) {
    const mine = spans.get(kind)![0]
    const other = spans.get(otherKind)![0]
    const age = Math.floor((reference - mine) / DAY_MS)
    const otherAge = Math.floor((reference - other) / DAY_MS)

    for (const window of WINDOWS_DAYS) {
      if (window * 0.85 <= age && age <= window + EDGE_SLACK_DAYS && otherAge > window + CORROBORATION_DAYS) {
        issues.push({
          code: 'possible_date_range_limit',
          severity: 'warning',
          message:
            `The ${kind} list only reaches back about ${age} days from the export date, while the ${otherKind} ` +
            `list goes back ${otherAge} days. That is what an export limited to a date range (for example the ` +
            `last ${window} days) looks like, so older ${kind} may be missing and counts incomplete. Compare the ` +
            'total with your Instagram profile, or request the export again with the date range set to All time.'
        })
        break
      }
    }
  }

  return issues
}

export const statusOf = (issues: readonly ParseIssue[]): { status: CompletenessStatus; appearsComplete: boolean } => {
  if (issues.some(i => i.severity === 'error')) return { status: 'incomplete', appearsComplete: false }
  if (issues.some(i => i.severity === 'warning')) return { status: 'warning', appearsComplete: false }

  return { status: 'complete', appearsComplete: true }
}
