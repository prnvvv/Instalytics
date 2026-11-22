/**
 * Clearly synthetic preview data (fictional usernames, generated timestamps). Used only for the
 * "Try with sample data" preview and never saved, so it can't be mistaken for a real analysis.
 */

import { buildProfileUrl } from './instagram/normalize'
import type { Account } from './instagram/types'

// Small deterministic generator so the sample looks the same on every load.
const mulberry32 = (seed: number) => () => {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0

  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)

  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t

  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const account = (index: number, followedAt: number): Account => {
  const username = `sample_user_${String(index).padStart(3, '0')}`

  return { username, profileUrl: buildProfileUrl(username), followedAt, source: 'sample' }
}

export const SAMPLE_ANALYZED_AT = '2026-06-30T12:00:00.000Z'

export const buildSampleData = () => {
  const random = mulberry32(7)
  const end = Date.UTC(2026, 5, 28) / 1000
  const year = 365 * 24 * 3600
  const stamp = () => Math.floor(end - random() * year)

  // 0-119: mutuals, 120-239: fans (follow you), 240-319: you follow, they do not follow back.
  const followers: Account[] = []
  const following: Account[] = []

  for (let i = 0; i < 240; i++) followers.push(account(i, stamp()))
  for (let i = 0; i < 120; i++) following.push(account(i, stamp()))
  for (let i = 240; i < 320; i++) following.push(account(i, stamp()))

  return { followers, following }
}
