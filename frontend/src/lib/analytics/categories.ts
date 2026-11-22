/**
 * Facts and plain-language readings for one category of account (followers, mutuals and so on). Everything is
 * derived from the lists and the dates in the export; a date that is not there is never guessed.
 */

import type { Account } from '../instagram/types'
import { KIND_COLOR } from '../palette'
import type { Insight } from './insights'
import type { RelationshipAnalytics, RelationshipKind } from './relationships'

const DAY = 86_400
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export type ListStats = {
  count: number
  /** Accounts that carry a usable date in the export. */
  withDates: number
  newest: number | null
  oldest: number | null
  /** Counted back from the reference time (the export's analysis time). */
  last30: number
  last365: number
  olderThanYear: number
  busiest: { label: string; count: number } | null
  byYear: { year: number; count: number }[]
}

export const listStats = (accounts: readonly Account[], referenceSeconds: number): ListStats => {
  const stamps = accounts.flatMap(a => (a.followedAt === null ? [] : [a.followedAt]))
  const months = new Map<string, { label: string; count: number }>()
  const years = new Map<number, number>()

  for (const stamp of stamps) {
    const date = new Date(stamp * 1000)
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    const month = months.get(key) ?? { label: `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`, count: 0 }

    month.count++
    months.set(key, month)
    years.set(date.getUTCFullYear(), (years.get(date.getUTCFullYear()) ?? 0) + 1)
  }

  let busiest: ListStats['busiest'] = null

  for (const month of months.values()) {
    if (busiest === null || month.count > busiest.count) busiest = month
  }

  return {
    count: accounts.length,
    withDates: stamps.length,
    newest: stamps.length === 0 ? null : stamps.reduce((a, b) => (b > a ? b : a)),
    oldest: stamps.length === 0 ? null : stamps.reduce((a, b) => (b < a ? b : a)),
    last30: stamps.filter(s => referenceSeconds - s <= 30 * DAY && referenceSeconds - s >= 0).length,
    last365: stamps.filter(s => referenceSeconds - s <= 365 * DAY && referenceSeconds - s >= 0).length,
    olderThanYear: stamps.filter(s => referenceSeconds - s > 365 * DAY).length,
    busiest,
    byYear: [...years.entries()].sort((a, b) => a[0] - b[0]).map(([year, count]) => ({ year, count }))
  }
}

export type CompositionPart = { value: number; color: string; label: string }

export type KindSummary = {
  stats: ListStats
  /** What the pixel bar shows: the parts and a sentence that reads it. */
  composition: { parts: CompositionPart[]; total?: number; caption: string }
  insights: Insight[]
}

const n = (value: number) => value.toLocaleString('en-US')

const pct = (part: number, whole: number) => (whole === 0 ? 0 : (part * 100) / whole)

const percent = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)}%`

const noun = (count: number, one: string, many: string) => `${n(count)} ${count === 1 ? one : many}`

/** Summarises one category of the analysis: its dated facts, how it splits, and a few plain readings. */
export const summarizeKind = (
  kind: RelationshipKind,
  analysis: RelationshipAnalytics,
  accounts: readonly Account[],
  referenceSeconds: number
): KindSummary => {
  const stats = listStats(accounts, referenceSeconds)
  const insights: Insight[] = []
  const a = analysis
  const recent = (text: string) => {
    if (stats.last30 > 0) insights.push({ id: 'recent', text })
  }

  switch (kind) {
    case 'followers': {
      insights.push({
        id: 'split',
        text: `${n(a.mutualCount)} of your ${n(a.followersCount)} followers (${percent(pct(a.mutualCount, a.followersCount))}) are mutuals; the other ${n(a.fansCount)} are fans you do not follow back.`
      })
      recent(`${noun(stats.last30, 'account', 'accounts')} started following you in the 30 days before this export.`)
      if (stats.busiest) insights.push({ id: 'busiest', text: `${stats.busiest.label} was your busiest month for new followers (${n(stats.busiest.count)}).` })

      return {
        stats,
        composition: {
          parts: [
            { value: a.mutualCount, color: KIND_COLOR.mutuals, label: 'Mutuals' },
            { value: a.fansCount, color: KIND_COLOR.fans, label: 'Fans' }
          ],
          caption: `${n(a.mutualCount)} mutual · ${n(a.fansCount)} fans`
        },
        insights
      }
    }

    case 'following': {
      if (a.followingCount > 0) {
        insights.push({
          id: 'split',
          text: `${n(a.mutualCount)} of the ${n(a.followingCount)} accounts you follow (${percent(pct(a.mutualCount, a.followingCount))}) follow you back.`
        })
      }
      recent(`You followed ${noun(stats.last30, 'account', 'accounts')} in the 30 days before this export.`)
      if (stats.busiest) insights.push({ id: 'busiest', text: `${stats.busiest.label} was the month you followed the most accounts (${n(stats.busiest.count)}).` })

      return {
        stats,
        composition: {
          parts: [
            { value: a.mutualCount, color: KIND_COLOR.mutuals, label: 'Follow back' },
            { value: a.notFollowingBackCount, color: KIND_COLOR['not-following-back'], label: 'Do not' }
          ],
          caption: `${n(a.mutualCount)} follow back · ${n(a.notFollowingBackCount)} do not`
        },
        insights
      }
    }

    case 'mutuals': {
      insights.push({
        id: 'share',
        text: `${n(a.mutualCount)} accounts follow you and are followed by you: ${percent(a.mutualityRate ?? 0)} of everyone in your network.`
      })
      recent(`${noun(stats.last30, 'mutual', 'mutuals')} followed you in the 30 days before this export.`)
      if (stats.busiest) insights.push({ id: 'busiest', text: `${stats.busiest.label} brought the most mutuals (${n(stats.busiest.count)}).` })

      return {
        stats,
        composition: {
          parts: [{ value: a.mutualCount, color: KIND_COLOR.mutuals, label: 'Mutual' }],
          total: a.uniqueAccountsCount,
          caption: `of ${n(a.uniqueAccountsCount)} unique accounts`
        },
        insights
      }
    }

    case 'not-following-back': {
      insights.push({
        id: 'share',
        text: `${n(a.notFollowingBackCount)} of the ${n(a.followingCount)} accounts you follow (${percent(pct(a.notFollowingBackCount, a.followingCount))}) do not follow you back.`
      })
      if (stats.olderThanYear > 0) {
        insights.push({ id: 'old', text: `You have followed ${noun(stats.olderThanYear, 'of them', 'of them')} for more than a year.` })
      }
      recent(`You followed ${noun(stats.last30, 'of them', 'of them')} in the last 30 days, so they may not have had time to follow back.`)

      return {
        stats,
        composition: {
          parts: [{ value: a.notFollowingBackCount, color: KIND_COLOR['not-following-back'], label: 'Not following back' }],
          total: a.followingCount,
          caption: `of the ${n(a.followingCount)} you follow`
        },
        insights
      }
    }

    case 'fans': {
      insights.push({
        id: 'share',
        text: `${n(a.fansCount)} of your ${n(a.followersCount)} followers (${percent(pct(a.fansCount, a.followersCount))}) are accounts you do not follow back.`
      })
      recent(`${noun(stats.last30, 'fan', 'fans')} followed you in the 30 days before this export.`)
      if (stats.busiest) insights.push({ id: 'busiest', text: `${stats.busiest.label} brought the most fans (${n(stats.busiest.count)}).` })

      return {
        stats,
        composition: {
          parts: [{ value: a.fansCount, color: KIND_COLOR.fans, label: 'Fans' }],
          total: a.followersCount,
          caption: `of your ${n(a.followersCount)} followers`
        },
        insights
      }
    }
  }
}
