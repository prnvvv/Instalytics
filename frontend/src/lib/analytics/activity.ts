import type { Account } from '../instagram/types'

export type MonthBucket = { key: string; label: string; year: number; month: number; count: number }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const monthKey = (year: number, month: number) => `${year}-${String(month + 1).padStart(2, '0')}`

/**
 * Accounts per calendar month (UTC) over the `months` most recent months with data, ending at the latest
 * timestamp in the list. Uses only timestamps present in the export; returns null if there are none.
 */
export const monthlyActivity = (accounts: readonly Account[], months = 12): MonthBucket[] | null => {
  const stamps = accounts.flatMap(a => (a.followedAt === null ? [] : [a.followedAt]))

  if (stamps.length === 0) return null

  const counts = new Map<string, number>()

  for (const stamp of stamps) {
    const date = new Date(stamp * 1000)

    const key = monthKey(date.getUTCFullYear(), date.getUTCMonth())

    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const last = new Date(Math.max(...stamps) * 1000)
  const buckets: MonthBucket[] = []

  for (let i = months - 1; i >= 0; i--) {
    const date = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() - i, 1))
    const year = date.getUTCFullYear()
    const month = date.getUTCMonth()
    const key = monthKey(year, month)

    buckets.push({ key, label: `${MONTHS[month]} ${year}`, year, month, count: counts.get(key) ?? 0 })
  }

  return buckets
}

/** Share of accounts in the list that carry a usable timestamp, 0-1. */
export const timestampCoverage = (accounts: readonly Account[]) =>
  accounts.length === 0 ? 0 : accounts.filter(a => a.followedAt !== null).length / accounts.length
