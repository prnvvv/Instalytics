/**
 * Locating and classifying follower/following files (port of backend parser/discovery.py).
 *
 * Files are found by *file name*, anywhere in the archive, case-insensitively. The directory layout and the
 * ZIP root name are never relied on. The patterns are anchored, so look-alikes such as
 * recent_follow_requests.json, pending_follow_requests.json or following_hashtags.json never match.
 *
 * Inside a followers_and_following folder a differently named JSON file is still inspected, and is used only if
 * its content carries a known followers/following wrapper key.
 */

import type { ConnectionKind } from './types'

export const FOLLOW_DIRECTORY = 'followers_and_following'

// followers.json, followers_1.json, Followers_12.JSON, followers-2.json ...
const FOLLOWERS_NAME = /^followers(?:[_-]?(\d+))?\.json$/i
const FOLLOWING_NAME = /^following(?:[_-]?(\d+))?\.json$/i
const HTML_NAME = /^(followers|following)(?:[_-]?\d+)?\.html?$/i

/** Wrapper keys used by the JSON export. followers_N.json files are usually bare lists instead. */
export const WRAPPER_KEYS: Record<string, ConnectionKind> = {
  relationships_followers: 'followers',
  relationships_following: 'following'
}

export const normalizeMemberPath = (path: string) => path.replaceAll('\\', '/').replace(/^\/+/, '')

const split = (path: string): [string[], string] => {
  const parts = normalizeMemberPath(path).split('/')

  return [parts.slice(0, -1).map(p => p.toLowerCase()), parts[parts.length - 1].toLowerCase()]
}

/** macOS archive metadata is never export data. */
export const isMetadataPath = (path: string) => {
  const [dirs, name] = split(path)

  return dirs.includes('__macosx') || name.startsWith('._') || name === '.ds_store'
}

const nameMatch = (path: string): { kind: ConnectionKind; part: number | null } | null => {
  const [, name] = split(path)

  for (const [kind, pattern] of [
    ['followers', FOLLOWERS_NAME],
    ['following', FOLLOWING_NAME]
  ] as const) {
    const match = pattern.exec(name)

    if (match) return { kind, part: match[1] ? Number(match[1]) : null }
  }

  return null
}

export const kindFromFilename = (path: string): ConnectionKind | null => nameMatch(path)?.kind ?? null

/** The N of followers_N.json; null for followers.json or non-matching names. */
export const partNumber = (path: string): number | null => nameMatch(path)?.part ?? null

export const inFollowDirectory = (path: string) => split(path)[0].some(dir => dir.startsWith(FOLLOW_DIRECTORY))

/** Whether an archive member should be read and considered by the parser. */
export const isCandidatePath = (path: string) => {
  if (isMetadataPath(path)) return false

  if (!split(path)[1].endsWith('.json')) return false

  return kindFromFilename(path) !== null || inFollowDirectory(path)
}

/** True for a followers/following file in the (unsupported) HTML export format. */
export const isHtmlConnectionPath = (path: string) => !isMetadataPath(path) && HTML_NAME.test(split(path)[1])

export const kindFromContent = (data: unknown): ConnectionKind | null => {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, kind] of Object.entries(WRAPPER_KEYS)) if (key in data) return kind
  }

  return null
}

/** Content wrapper keys take precedence over the file name. */
export const classify = (path: string, data: unknown): ConnectionKind | null =>
  kindFromContent(data) ?? kindFromFilename(path)
