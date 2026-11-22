/**
 * Canonical models. These mirror the backend parser (backend/app/modules/parser/models.py); a shared fixture
 * (docs/parser/parity-cases.json) is run against both so they cannot drift apart.
 */

export type Account = {
  username: string
  profileUrl: string
  /** Unix seconds from the export; null when the export has no (plausible) timestamp. Never invented. */
  followedAt: number | null
  /** File the record came from; absent for records restored from a saved snapshot. */
  source?: string
}

export type ConnectionKind = 'followers' | 'following'

export type IssueSeverity = 'info' | 'warning' | 'error'

export type ParseIssueCode =
  // A file could not be read or understood: its accounts are missing from the totals.
  | 'invalid_json'
  | 'unexpected_structure'
  | 'file_too_large'
  // The archive is missing data the analytics need.
  | 'no_connection_files'
  | 'missing_followers_file'
  | 'missing_following_file'
  | 'missing_part'
  // Data was read but may not be the whole picture.
  | 'rejected_records'
  | 'possible_date_range_limit'
  // Informational.
  | 'empty_list'
  | 'conflicting_usernames'
  | 'duplicate_source_files'
  // Frontend only: the archive is the (unsupported) HTML export.
  | 'html_export'

/** A problem or observation. Never contains file contents or usernames. */
export type ParseIssue = {
  code: ParseIssueCode
  path?: string
  message: string
  severity: IssueSeverity
}

/** What was read from one followers/following file. */
export type FileReport = {
  path: string
  kind: ConnectionKind
  /** How the file was recognised: its name, or its content inside a followers_and_following folder. */
  detectedBy: 'filename' | 'content'
  /** "list", "nested-lists", "wrapped:<key>" or "single-record". */
  schemaName: string
  /** The N of followers_N.json, when the name has one. */
  part: number | null
  /** Records seen in the file, valid or not. */
  entriesSeen: number
  /** Accounts extracted, before cross-file de-duplication. */
  accountsExtracted: number
  invalidEntries: number
  rejectedByReason: Record<string, number>
  /** Which field each username was taken from: profile_url, value, title, label_username... */
  usernameSources: Record<string, number>
  conflictingUsernames: number
}

/** A file the parser looked at, and what it decided. */
export type DiscoveredFile = {
  path: string
  role: ConnectionKind | 'ignored'
  detectedBy: 'filename' | 'content' | 'none'
  status: 'processed' | 'failed' | 'ignored'
  note: string | null
}

/** Complete totals for one list, computed from everything extracted, never from previews. */
export type ListTotals = {
  sourceFiles: number
  recordsSeen: number
  validRecords: number
  rejectedRecords: number
  duplicatesRemoved: number
  uniqueAccounts: number
  /** Unix seconds of the earliest and latest dated account, when the export has dates. */
  earliest: number | null
  latest: number | null
  withTimestamp: number
}

export type CompletenessStatus = 'complete' | 'warning' | 'incomplete'

export type ParseDiagnostics = {
  files: DiscoveredFile[]
  followers: ListTotals
  following: ListTotals
  /** From a root folder named instagram-<name>-YYYY-MM-DD-<id>; only the date is read. */
  exportDate: string | null
  status: CompletenessStatus
  /** True only if no warning or error was raised: nothing suggests data is missing. */
  appearsComplete: boolean
}

export type ParsedExport = {
  followers: Account[]
  following: Account[]
  files: FileReport[]
  issues: ParseIssue[]
  diagnostics: ParseDiagnostics
}

export const PARSER_VERSION = '2.0.0'
