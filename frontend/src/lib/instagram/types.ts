/** Canonical models, matching docs/parser/instagram-export-format.md and the backend's camelCase schema. */

export type Account = {
  username: string
  profileUrl: string
  /** Unix seconds from the export; null when the export has no (plausible) timestamp. Never invented. */
  followedAt: number | null
  /** File the record came from; absent for records restored from a saved snapshot. */
  source?: string
}

export type ConnectionKind = 'followers' | 'following'

export type ParseIssueCode =
  | 'invalid_json'
  | 'unexpected_structure'
  | 'file_too_large'
  | 'html_export'
  | 'no_connection_files'

/** A non-fatal problem. Never contains file contents or usernames. */
export type ParseIssue = { code: ParseIssueCode; path?: string; message: string }

export type FileReport = {
  path: string
  kind: ConnectionKind
  entriesSeen: number
  invalidEntries: number
}

export type ParsedExport = {
  followers: Account[]
  following: Account[]
  files: FileReport[]
  issues: ParseIssue[]
  /** Raw records seen across all files, before de-duplication. */
  recordsSeen: { followers: number; following: number }
}

export const PARSER_VERSION = '1.0.0'
