/** Deterministic, template-based insight sentences. Each is derived from counts; none is invented. */

import { monthlyActivity } from './activity'
import type { RelationshipAnalytics } from './relationships'

export type Insight = { id: string; text: string }

const plural = (count: number, one: string, many: string) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`

const percent = (value: number) => `${value.toFixed(value >= 10 ? 0 : 1)}%`

export const buildInsights = (analytics: RelationshipAnalytics): Insight[] => {
  const insights: Insight[] = []

  if (analytics.followingCount > 0 && analytics.followBackRate !== null) {
    insights.push({
      id: 'follow-back',
      text: `${plural(analytics.mutualCount, 'account', 'accounts')} of the ${analytics.followingCount.toLocaleString('en-US')} you follow follow you back (${percent(analytics.followBackRate)}).`
    })
  }

  if (analytics.notFollowingBackCount > 0) {
    insights.push({
      id: 'not-following-back',
      text: `You follow ${plural(analytics.notFollowingBackCount, 'account', 'accounts')} that ${analytics.notFollowingBackCount === 1 ? 'does' : 'do'} not follow you back.`
    })
  }

  if (analytics.fansCount > 0) {
    insights.push({
      id: 'fans',
      text: `${plural(analytics.fansCount, 'follower is', 'followers are')} accounts you do not follow back.`
    })
  }

  const ratio = analytics.followerToFollowingRatio

  if (ratio !== null && analytics.followersCount > 0 && analytics.followersCount !== analytics.followingCount) {
    insights.push({
      id: 'ratio',
      text:
        ratio > 1
          ? `You have ${ratio.toFixed(2)} times as many followers as accounts you follow.`
          : `You follow ${(1 / (ratio || Number.EPSILON)).toFixed(2)} times as many accounts as follow you.`
    })
  }

  const activity = monthlyActivity(analytics.followers, 12)
  const busiest = activity?.reduce((best, bucket) => (bucket.count > best.count ? bucket : best))

  if (busiest && busiest.count > 0) {
    insights.push({
      id: 'busiest-month',
      text: `${busiest.label} brought the most new followers in the last 12 months of the export (${busiest.count.toLocaleString('en-US')}).`
    })
  }

  return insights
}
