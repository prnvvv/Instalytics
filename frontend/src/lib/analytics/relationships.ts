/**
 * Deterministic relationship analytics over followers (F) and following (G), per
 * docs/analytics/definitions.md. Pure set operations on normalized usernames; no network, no randomness.
 *
 *   M = F ∩ G  mutuals            N = G − F  not following back      U = F − G  fans
 *   A = F ∪ G  unique accounts
 */

import { deduplicate } from '../instagram/parse'
import type { Account } from '../instagram/types'

export type RelationshipAnalytics = {
  followersCount: number
  followingCount: number
  uniqueAccountsCount: number
  mutualCount: number
  /** Accounts you follow that do not follow you back (G − F). */
  notFollowingBackCount: number
  /** Followers you do not follow back (F − G). */
  fansCount: number
  /** Percentages 0-100; null when the denominator is zero (undefined, not zero). */
  mutualityRate: number | null
  followBackRate: number | null
  /** Followers / following, not a percentage; null when you follow nobody. */
  followerToFollowingRatio: number | null
  followers: Account[]
  following: Account[]
  mutuals: Account[]
  notFollowingBack: Account[]
  fans: Account[]
}

export type RelationshipKind = 'followers' | 'following' | 'mutuals' | 'not-following-back' | 'fans'

const byUsername = (a: Account, b: Account) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0)

const percentage = (numerator: number, denominator: number) => (denominator === 0 ? null : (numerator * 100) / denominator)

/**
 * Inputs are de-duplicated by username first. For accounts present in both lists the followers-side record
 * is used, because its timestamp says when that account followed you. Output lists are sorted by username.
 */
export const computeRelationships = (
  followersInput: readonly Account[],
  followingInput: readonly Account[]
): RelationshipAnalytics => {
  const followers = deduplicate(followersInput).sort(byUsername)
  const following = deduplicate(followingInput).sort(byUsername)
  const followerNames = new Set(followers.map(a => a.username))
  const followingNames = new Set(following.map(a => a.username))

  const mutuals = followers.filter(a => followingNames.has(a.username))
  const fans = followers.filter(a => !followingNames.has(a.username))
  const notFollowingBack = following.filter(a => !followerNames.has(a.username))
  const unique = mutuals.length + fans.length + notFollowingBack.length

  return {
    followersCount: followers.length,
    followingCount: following.length,
    uniqueAccountsCount: unique,
    mutualCount: mutuals.length,
    notFollowingBackCount: notFollowingBack.length,
    fansCount: fans.length,
    mutualityRate: percentage(mutuals.length, unique),
    followBackRate: percentage(mutuals.length, following.length),
    followerToFollowingRatio: following.length === 0 ? null : followers.length / following.length,
    followers,
    following,
    mutuals,
    notFollowingBack,
    fans
  }
}

export const accountsOfKind = (analytics: RelationshipAnalytics, kind: RelationshipKind): Account[] => {
  switch (kind) {
    case 'followers':
      return analytics.followers
    case 'following':
      return analytics.following
    case 'mutuals':
      return analytics.mutuals
    case 'not-following-back':
      return analytics.notFollowingBack
    case 'fans':
      return analytics.fans
  }
}

export type Relationship = 'mutual' | 'not-following-back' | 'fan'

/** How one account relates to you, for per-account detail views. */
export const relationshipOf = (analytics: RelationshipAnalytics, username: string): Relationship | null => {
  if (analytics.mutuals.some(a => a.username === username)) return 'mutual'
  if (analytics.notFollowingBack.some(a => a.username === username)) return 'not-following-back'
  if (analytics.fans.some(a => a.username === username)) return 'fan'

  return null
}
