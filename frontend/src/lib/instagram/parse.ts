/**
 * Parse followers/following data from already-obtained export files (port of backend parser/service.py).
 *
 * Pure: no DOM, no I/O. Files are found by name anywhere in the input; every file of one kind
 * (followers_1.json, followers_2.json...) is aggregated and de-duplicated. Anything that cannot be read becomes an
 * issue instead of being silently dropped, and the diagnostics say whether the extraction looks complete. Nothing
 * in the diagnostics or issues echoes a username.
 */

import {
  detectDateRangeLimit,
  detectExportDate,
  duplicateSources,
  missingParts,
  statusOf
} from './completeness'
import { classify, isCandidatePath, kindFromFilename, normalizeMemberPath, partNumber } from './discovery'
import { deduplicate, extractAccounts, rejectedTotal, UnexpectedStructureError } from './extract'
import type {
  Account,
  ConnectionKind,
  DiscoveredFile,
  FileReport,
  ListTotals,
  ParseIssue,
  ParseIssueCode,
  ParsedExport
} from './types'

export { deduplicate } from './extract'
export { isCandidatePath, isHtmlConnectionPath, isMetadataPath, normalizeMemberPath } from './discovery'

export const DEFAULT_MAX_JSON_BYTES = 50 * 1024 * 1024

const KINDS: ConnectionKind[] = ['followers', 'following']

const totalsOf = (reports: FileReport[], collected: Account[], unique: Account[]): ListTotals => {
  const stamps = unique.flatMap(a => (a.followedAt === null ? [] : [a.followedAt]))

  return {
    sourceFiles: reports.length,
    recordsSeen: reports.reduce((sum, r) => sum + r.entriesSeen, 0),
    validRecords: collected.length,
    rejectedRecords: reports.reduce((sum, r) => sum + r.invalidEntries, 0),
    duplicatesRemoved: collected.length - unique.length,
    uniqueAccounts: unique.length,
    earliest: stamps.length ? Math.min(...stamps) : null,
    latest: stamps.length ? Math.max(...stamps) : null,
    withTimestamp: stamps.length
  }
}

const decode = (content: Uint8Array | string) =>
  typeof content === 'string' ? content : new TextDecoder('utf-8', { fatal: true }).decode(content)

export type ParseOptions = {
  maxJsonBytes?: number
  /** The archive's file name; used only to read the export date when no folder carries it. */
  sourceName?: string
  /** Candidate files the archive reader skipped for exceeding the size limit. */
  oversized?: readonly string[]
}

/**
 * Parse every followers/following file found in `files` (path to bytes or text).
 * Malformed files become issues and do not abort the parse of the others.
 */
export const parseExportFiles = (
  files: ReadonlyMap<string, Uint8Array | string> | Record<string, Uint8Array | string>,
  options: ParseOptions | number = {}
): ParsedExport => {
  const { maxJsonBytes = DEFAULT_MAX_JSON_BYTES, oversized = [], sourceName } =
    typeof options === 'number' ? { maxJsonBytes: options } : options
  const entries = (files instanceof Map ? [...files.entries()] : Object.entries(files)).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0
  )

  const collected: Record<ConnectionKind, Account[]> = { followers: [], following: [] }
  const reports: FileReport[] = []
  const discovered: DiscoveredFile[] = []
  const issues: ParseIssue[] = []
  const failedNamed = new Set<ConnectionKind>()

  // A named followers/following file that fails costs real data (error). An unknown file in the folder might never
  // have been follower data (warning).
  const fail = (path: string, byName: ConnectionKind | null, code: ParseIssueCode, message: string, note: string) => {
    issues.push({ code, path, message, severity: byName ? 'error' : 'warning' })
    discovered.push({
      path,
      role: byName ?? 'ignored',
      detectedBy: byName ? 'filename' : 'none',
      status: 'failed',
      note
    })

    if (byName) failedNamed.add(byName)
  }

  for (const path of oversized) {
    fail(normalizeMemberPath(path), kindFromFilename(path), 'file_too_large', 'File exceeds the size limit.', 'Skipped: too large.')
  }

  for (const [rawPath, content] of entries) {
    const path = normalizeMemberPath(rawPath)

    if (!isCandidatePath(path)) continue

    const byName = kindFromFilename(path)

    if ((typeof content === 'string' ? content.length : content.byteLength) > maxJsonBytes) {
      fail(path, byName, 'file_too_large', 'File exceeds the size limit.', 'Skipped: too large.')
      continue
    }

    let data: unknown

    try {
      // A UTF-8 byte order mark is tolerated.
      data = JSON.parse(decode(content).replace(/^﻿/, ''))
    } catch {
      fail(path, byName, 'invalid_json', 'File is not valid UTF-8 JSON.', 'Could not be parsed.')
      continue
    }

    const kind = classify(path, data)

    // A JSON file in the connections folder that is not followers or following data.
    if (kind === null) {
      discovered.push({ path, role: 'ignored', detectedBy: 'none', status: 'ignored', note: 'Not followers or following data.' })
      continue
    }

    let extraction

    try {
      extraction = extractAccounts(data, kind, path.split('/').pop()!)
    } catch (error) {
      if (!(error instanceof UnexpectedStructureError)) throw error

      fail(path, byName, 'unexpected_structure', 'Unrecognised file structure.', 'Layout not recognised.')
      continue
    }

    const report: FileReport = {
      path,
      kind,
      detectedBy: byName === kind ? 'filename' : 'content',
      schemaName: extraction.schema,
      part: byName === kind ? partNumber(path) : null,
      entriesSeen: extraction.recordsSeen,
      accountsExtracted: extraction.accounts.length,
      invalidEntries: rejectedTotal(extraction),
      rejectedByReason: extraction.rejected,
      usernameSources: extraction.sources,
      conflictingUsernames: extraction.conflicts
    }

    reports.push(report)
    collected[kind].push(...extraction.accounts)
    discovered.push({
      path,
      role: kind,
      detectedBy: report.detectedBy,
      status: 'processed',
      note: `${extraction.recordsSeen} records, ${extraction.accounts.length} accounts (${extraction.schema}).`
    })

    if (extraction.recordsSeen === 0) {
      issues.push({ code: 'empty_list', path, message: 'The file contains no records.', severity: 'info' })
    }
  }

  const unique = { followers: deduplicate(collected.followers), following: deduplicate(collected.following) }
  const byKind = {
    followers: reports.filter(r => r.kind === 'followers'),
    following: reports.filter(r => r.kind === 'following')
  }
  const totals = {
    followers: totalsOf(byKind.followers, collected.followers, unique.followers),
    following: totalsOf(byKind.following, collected.following, unique.following)
  }

  issues.push(...completenessIssues(reports, byKind, failedNamed, totals))

  const exportDate = detectExportDate(
    entries.map(([path]) => path),
    sourceName
  )

  issues.push(...detectDateRangeLimit(totals, exportDate))

  const { status, appearsComplete } = statusOf(issues)

  return {
    followers: unique.followers,
    following: unique.following,
    files: reports,
    issues,
    diagnostics: { files: discovered, followers: totals.followers, following: totals.following, exportDate, status, appearsComplete }
  }
}

const completenessIssues = (
  reports: FileReport[],
  byKind: Record<ConnectionKind, FileReport[]>,
  failedNamed: Set<ConnectionKind>,
  totals: Record<ConnectionKind, ListTotals>
): ParseIssue[] => {
  const issues: ParseIssue[] = []
  const present = new Set(KINDS.filter(kind => byKind[kind].length > 0 || failedNamed.has(kind)))

  if (present.size === 0) {
    issues.push({
      code: 'no_connection_files',
      message: 'No followers or following files were found in this archive.',
      severity: 'error'
    })
  } else {
    for (const [kind, code] of [
      ['followers', 'missing_followers_file'],
      ['following', 'missing_following_file']
    ] as const) {
      if (!present.has(kind)) {
        issues.push({
          code,
          message: `No ${kind} file was found, so relationship analytics would be incomplete.`,
          severity: 'error'
        })
      }
    }
  }

  for (const kind of KINDS) {
    const gaps = missingParts(reports, kind)

    if (gaps.length > 0) {
      const found = [...new Set(byKind[kind].flatMap(r => (r.part === null ? [] : [r.part])))].sort((a, b) => a - b)
      const names = gaps.map(n => `${kind}_${n}.json`).join(', ')

      issues.push({
        code: 'missing_part',
        message:
          `${names} ${gaps.length === 1 ? 'is' : 'are'} missing from the numbered parts (found: ${found.join(', ')}). ` +
          `Some ${kind} are not in this archive.`,
        severity: 'error'
      })
    }

    const rejected: Record<string, number> = {}

    for (const report of byKind[kind]) {
      for (const [reason, n] of Object.entries(report.rejectedByReason)) rejected[reason] = (rejected[reason] ?? 0) + n
    }

    const lost = Object.values(rejected).reduce((a, b) => a + b, 0)

    if (lost > 0) {
      const breakdown = Object.entries(rejected)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([reason, n]) => `${reason.replaceAll('_', ' ')}: ${n}`)
        .join(', ')

      issues.push({
        code: 'rejected_records',
        message: `${lost} of ${totals[kind].recordsSeen} ${kind} records could not be read and are not counted (${breakdown}).`,
        severity: 'warning'
      })
    }
  }

  const conflicts = reports.reduce((sum, r) => sum + r.conflictingUsernames, 0)

  if (conflicts > 0) {
    issues.push({
      code: 'conflicting_usernames',
      message: `${conflicts} records held two different valid usernames; the profile URL was used.`,
      severity: 'info'
    })
  }

  for (const [name, count] of duplicateSources(reports).sort(([a], [b]) => (a < b ? -1 : 1))) {
    issues.push({
      code: 'duplicate_source_files',
      message: `${name} appears in ${count} places in the archive; duplicate accounts were merged.`,
      severity: 'info'
    })
  }

  return issues
}
