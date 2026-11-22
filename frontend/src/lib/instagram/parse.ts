/**
 * Discovery, extraction and de-duplication of followers/following files
 * (port of backend app/modules/parser/{discovery,extract,service}.py). Pure: no DOM, no I/O.
 */

import { buildProfileUrl, normalizeUsername, parseTimestamp } from './normalize'
import type { Account, ConnectionKind, FileReport, ParseIssue, ParsedExport } from './types'

const FOLLOW_DIRECTORY = 'followers_and_following'
const FOLLOWERS_NAME = /^followers(_\d+)?\.json$/
const FOLLOWING_NAME = /^following(_\d+)?\.json$/
const HTML_NAME = /^(followers|following)(_\d+)?\.html?$/

const WRAPPER_KEYS: Record<string, ConnectionKind> = {
  relationships_followers: 'followers',
  relationships_following: 'following'
}

export const DEFAULT_MAX_JSON_BYTES = 50 * 1024 * 1024

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

const kindFromFilename = (path: string): ConnectionKind | null => {
  const [, name] = split(path)

  if (FOLLOWERS_NAME.test(name)) return 'followers'
  if (FOLLOWING_NAME.test(name)) return 'following'

  return null
}

/** Whether an archive member should be read: a followers/following-looking JSON file anywhere. */
export const isCandidatePath = (path: string) => {
  if (isMetadataPath(path)) return false

  const [dirs, name] = split(path)

  if (!name.endsWith('.json')) return false

  return kindFromFilename(path) !== null || dirs.includes(FOLLOW_DIRECTORY)
}

/** True for a followers/following file in the (unsupported) HTML export format. */
export const isHtmlConnectionPath = (path: string) => !isMetadataPath(path) && HTML_NAME.test(split(path)[1])

const kindFromContent = (data: unknown): ConnectionKind | null => {
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    for (const [key, kind] of Object.entries(WRAPPER_KEYS)) if (key in data) return kind
  }

  return null
}

const entriesOf = (data: unknown, kind: ConnectionKind): unknown[] | null => {
  if (Array.isArray(data)) return data

  if (data !== null && typeof data === 'object') {
    const key = Object.keys(WRAPPER_KEYS).find(k => WRAPPER_KEYS[k] === kind)!
    const entries = (data as Record<string, unknown>)[key]

    if (Array.isArray(entries)) return entries
  }

  return null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const usernameFor = (entry: Record<string, unknown>, item: Record<string, unknown>) => {
  for (const candidate of [item.value, entry.title, item.href]) {
    const username = normalizeUsername(candidate)

    if (username !== null) return username
  }

  return null
}

type Extraction = { accounts: Account[]; entriesSeen: number; invalidEntries: number }

const extractAccounts = (entries: unknown[], source: string): Extraction => {
  const result: Extraction = { accounts: [], entriesSeen: 0, invalidEntries: 0 }

  for (const entry of entries) {
    const items = isRecord(entry) ? entry.string_list_data : undefined

    if (!Array.isArray(items) || items.length === 0) {
      result.entriesSeen++
      result.invalidEntries++
      continue
    }

    for (const item of items) {
      result.entriesSeen++

      const username = isRecord(entry) && isRecord(item) ? usernameFor(entry, item) : null

      if (username === null || !isRecord(item)) {
        result.invalidEntries++
        continue
      }

      result.accounts.push({
        username,
        profileUrl: buildProfileUrl(username),
        followedAt: parseTimestamp(item.timestamp),
        source
      })
    }
  }

  return result
}

/**
 * One account per username, in first-seen order. If an account appears more than once, the record with
 * the most recent timestamp is kept; a record with a timestamp always beats one without.
 */
export const deduplicate = (accounts: readonly Account[]): Account[] => {
  const best = new Map<string, Account>()

  for (const account of accounts) {
    const current = best.get(account.username)

    if (
      current === undefined ||
      (account.followedAt !== null && (current.followedAt === null || account.followedAt > current.followedAt))
    ) {
      best.set(account.username, account)
    }
  }

  return [...best.values()]
}

const decode = (content: Uint8Array | string) =>
  typeof content === 'string' ? content : new TextDecoder('utf-8', { fatal: true }).decode(content)

/**
 * Parse every followers/following file in `files` (path to bytes or text). Multiple files of one kind are
 * merged and de-duplicated; malformed files become issues instead of aborting the parse.
 */
export const parseExportFiles = (
  files: ReadonlyMap<string, Uint8Array | string> | Record<string, Uint8Array | string>,
  maxJsonBytes = DEFAULT_MAX_JSON_BYTES
): ParsedExport => {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files)
  const collected: Record<ConnectionKind, Account[]> = { followers: [], following: [] }
  const seen = { followers: 0, following: 0 }
  const reports: FileReport[] = []
  const issues: ParseIssue[] = []

  for (const [rawPath, content] of entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const path = normalizeMemberPath(rawPath)

    if (!isCandidatePath(path)) continue

    if ((typeof content === 'string' ? content.length : content.byteLength) > maxJsonBytes) {
      issues.push({ code: 'file_too_large', path, message: 'File exceeds the size limit.' })
      continue
    }

    let data: unknown

    try {
      // A UTF-8 byte order mark is tolerated.
      data = JSON.parse(decode(content).replace(/^﻿/, ''))
    } catch {
      issues.push({ code: 'invalid_json', path, message: 'File is not valid UTF-8 JSON.' })
      continue
    }

    const kind = kindFromContent(data) ?? kindFromFilename(path)

    // A JSON file in the connections folder that is not followers/following (for example close friends).
    if (kind === null) continue

    const list = entriesOf(data, kind)

    if (list === null) {
      issues.push({ code: 'unexpected_structure', path, message: 'Unrecognised file structure.' })
      continue
    }

    const extracted = extractAccounts(list, path.split('/').pop()!)

    collected[kind].push(...extracted.accounts)
    seen[kind] += extracted.accounts.length
    reports.push({ path, kind, entriesSeen: extracted.entriesSeen, invalidEntries: extracted.invalidEntries })
  }

  // The generic message is only for archives where nothing at all explains the absence.
  if (reports.length === 0 && issues.length === 0) {
    issues.push({
      code: 'no_connection_files',
      message: 'No followers or following files were found in this archive.'
    })
  }

  return {
    followers: deduplicate(collected.followers),
    following: deduplicate(collected.following),
    files: reports,
    issues,
    recordsSeen: seen
  }
}
