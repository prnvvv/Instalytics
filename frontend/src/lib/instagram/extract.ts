/**
 * Schema-aware extraction of accounts from the parsed JSON of a followers/following file
 * (port of backend parser/extract.py).
 *
 * Record layouts understood:
 *  - string_list_data (followers_N.json, following.json):
 *      { title, string_list_data: [{ href, value, timestamp }] }
 *  - label_values (the newer layout used by sibling files such as recent_follow_requests.json):
 *      { timestamp, media: [], label_values: [{ label: 'Username', value }, { label: 'URL', value }] }
 *  - flat records: { href, value, username, title, timestamp }
 *
 * Records are found at the top level (a list, possibly nested lists) or under a wrapper key. A username is never
 * harvested from arbitrary strings: it must come from a known field and pass structural validation (a valid
 * Instagram username, or a profile URL on an Instagram host).
 */

import { WRAPPER_KEYS } from './discovery'
import { buildProfileUrl, normalizeUsername, parseTimestamp } from './normalize'
import type { Account, ConnectionKind } from './types'

const MAX_NESTING = 4
const RECORD_KEYS = ['string_list_data', 'label_values', 'href', 'value', 'username']

/** The JSON is valid but no recognisable list of records could be located in it. */
export class UnexpectedStructureError extends Error {
  constructor() {
    super('Unrecognised file structure.')
    this.name = 'UnexpectedStructureError'
  }
}

export type Extraction = {
  accounts: Account[]
  recordsSeen: number
  rejected: Record<string, number>
  sources: Record<string, number>
  conflicts: number
  schema: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const looksLikeRecord = (value: unknown) => isRecord(value) && RECORD_KEYS.some(key => key in value)

/** Flatten nested lists a few levels deep. Returns the records and whether nesting was found. */
const flatten = (items: unknown[], depth = 0): [unknown[], boolean] => {
  const flat: unknown[] = []
  let nested = false

  for (const item of items) {
    if (Array.isArray(item) && depth < MAX_NESTING) {
      flat.push(...flatten(item, depth + 1)[0])
      nested = true
    } else {
      flat.push(item)
    }
  }

  return [flat, nested]
}

/** Find the list of records in a parsed file and name the layout. Throws if there is none. */
export const locateRecords = (data: unknown, kind: ConnectionKind): [unknown[], string] => {
  if (Array.isArray(data)) {
    const [records, nested] = flatten(data)

    return [records, nested ? 'nested-lists' : 'list']
  }

  if (isRecord(data)) {
    const wrapper = Object.keys(WRAPPER_KEYS).find(key => WRAPPER_KEYS[key] === kind)!

    if (wrapper in data) {
      const value = data[wrapper]

      if (!Array.isArray(value)) throw new UnexpectedStructureError()

      return [flatten(value)[0], `wrapped:${wrapper}`]
    }

    if (looksLikeRecord(data)) return [[data], 'single-record']

    // Unknown wrapper key: accept it only if exactly one list holds record-like items.
    const holders = Object.entries(data).filter(
      ([, value]) => Array.isArray(value) && flatten(value)[0].slice(0, 50).some(looksLikeRecord)
    )

    if (holders.length === 1) return [flatten(holders[0][1] as unknown[])[0], `wrapped:${holders[0][0]}`]
  }

  throw new UnexpectedStructureError()
}

type Resolved = { username: string; source: string; conflict: boolean } | string

/**
 * Pick the username from candidate fields, first valid one wins. The profile URL is listed first because it is
 * the one value that is structurally validated and is what the app links to; a conflict is when another field
 * held a different valid username. Returns a rejection reason when none is valid.
 */
const resolve = (candidates: [string, unknown][]): Resolved => {
  const valid: [string, string][] = []
  let sawText = false

  for (const [source, raw] of candidates) {
    if (typeof raw === 'string' && raw.trim()) sawText = true

    const username = normalizeUsername(raw)

    if (username !== null) valid.push([source, username])
  }

  if (valid.length === 0) return sawText ? 'invalid_username' : 'no_username'

  const [source, username] = valid[0]

  return { username, source, conflict: valid.slice(1).some(([, other]) => other !== username) }
}

const labelValue = (values: unknown[], ...labels: string[]): unknown => {
  for (const item of values) {
    if (isRecord(item) && labels.includes(String(item.label ?? '').trim().toLowerCase())) return item.value
  }

  return null
}

const bump = (counter: Record<string, number>, key: string) => {
  counter[key] = (counter[key] ?? 0) + 1
}

const add = (out: Extraction, candidates: [string, unknown][], timestamp: unknown, sourceName: string) => {
  const resolved = resolve(candidates)

  if (typeof resolved === 'string') {
    bump(out.rejected, resolved)

    return
  }

  bump(out.sources, resolved.source)
  out.conflicts += resolved.conflict ? 1 : 0
  out.accounts.push({
    username: resolved.username,
    profileUrl: buildProfileUrl(resolved.username),
    followedAt: parseTimestamp(timestamp),
    source: sourceName
  })
}

const processRecord = (record: unknown, out: Extraction, sourceName: string) => {
  if (!isRecord(record)) {
    out.recordsSeen++
    bump(out.rejected, 'not_a_record')

    return
  }

  if ('string_list_data' in record) {
    const items = record.string_list_data

    if (!Array.isArray(items) || items.length === 0) {
      out.recordsSeen++
      bump(out.rejected, 'empty_record')

      return
    }

    for (const item of items) {
      out.recordsSeen++

      if (!isRecord(item)) {
        bump(out.rejected, 'malformed_item')
        continue
      }

      add(
        out,
        [
          ['profile_url', item.href],
          ['value', item.value],
          ['title', record.title]
        ],
        'timestamp' in item ? item.timestamp : record.timestamp,
        sourceName
      )
    }

    return
  }

  out.recordsSeen++

  if ('label_values' in record) {
    const values = record.label_values

    if (!Array.isArray(values)) {
      bump(out.rejected, 'malformed_record')

      return
    }

    add(
      out,
      [
        ['label_url', labelValue(values, 'url', 'profile url', 'link')],
        ['label_username', labelValue(values, 'username', 'user name')]
      ],
      record.timestamp,
      sourceName
    )

    return
  }

  if (looksLikeRecord(record)) {
    add(
      out,
      [
        ['profile_url', record.href],
        ['value', 'value' in record ? record.value : record.username],
        ['title', record.title]
      ],
      record.timestamp,
      sourceName
    )

    return
  }

  bump(out.rejected, 'not_a_record')
}

export const extractAccounts = (data: unknown, kind: ConnectionKind, sourceName: string): Extraction => {
  const [records, schema] = locateRecords(data, kind)
  const out: Extraction = { accounts: [], recordsSeen: 0, rejected: {}, sources: {}, conflicts: 0, schema }

  for (const record of records) processRecord(record, out, sourceName)

  return out
}

export const rejectedTotal = (extraction: Extraction) => Object.values(extraction.rejected).reduce((a, b) => a + b, 0)

/**
 * One account per username, in first-seen order. If an account appears more than once, the record with the most
 * recent timestamp is kept; a record with a timestamp always beats one without.
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
