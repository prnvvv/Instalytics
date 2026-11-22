/**
 * Secure, read-only access to a ZIP held in memory (port of backend app/modules/archive).
 *
 * Nothing is written anywhere: member names are only lookup keys, so path traversal cannot reach a
 * filesystem. Archives are validated from their central directory first; only the few JSON files the
 * parser needs are ever inflated, each under a hard size cap.
 */

import { unzipSync } from 'fflate'

import { isCandidatePath, isMetadataPath, normalizeMemberPath } from './discovery'

export type ArchiveLimits = {
  maxArchiveBytes: number
  maxEntries: number
  maxEntryBytes: number
  maxTotalBytes: number
  maxCompressionRatio: number
  /** The ratio check is skipped below this size: tiny files legitimately compress very well. */
  ratioCheckMinBytes: number
  maxPathLength: number
  maxPathDepth: number
  maxJsonBytes: number
  allowedExtensions: ReadonlySet<string>
}

export const DEFAULT_LIMITS: ArchiveLimits = {
  maxArchiveBytes: 250 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryBytes: 200 * 1024 * 1024,
  maxTotalBytes: 1024 * 1024 * 1024,
  maxCompressionRatio: 100,
  ratioCheckMinBytes: 1024 * 1024,
  maxPathLength: 255,
  maxPathDepth: 20,
  maxJsonBytes: 50 * 1024 * 1024,
  // Types that appear in a real export. Only JSON is read; unknown types (executables, nested archives)
  // are rejected.
  allowedExtensions: new Set([
    '.json',
    '.html',
    '.htm',
    '.txt',
    '.csv',
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.webp',
    '.heic',
    '.mp4',
    '.mov',
    '.m4a',
    '.mp3',
    '.aac'
  ])
}

export type ArchiveErrorCode =
  | 'not_a_zip'
  | 'archive_too_large'
  | 'too_many_entries'
  | 'unsafe_path'
  | 'duplicate_entry'
  | 'unsupported_file_type'
  | 'unsupported_compression'
  | 'entry_too_large'
  | 'total_too_large'
  | 'suspicious_compression'
  | 'corrupted_archive'

/** The message never includes file names or contents. */
export class ArchiveError extends Error {
  readonly code: ArchiveErrorCode

  constructor(code: ArchiveErrorCode, message: string) {
    super(message)
    this.name = 'ArchiveError'
    this.code = code
  }
}

export type ArchiveContents = {
  /** Candidate JSON members, normalized path to bytes. */
  files: Map<string, Uint8Array>
  /** Candidate members skipped for exceeding the per-JSON size limit. */
  oversized: string[]
  /** Every member path, for detecting unsupported layouts (for example HTML exports). */
  memberPaths: string[]
  entryCount: number
  totalUncompressedBytes: number
}

const EOCD_SIGNATURE = [0x50, 0x4b, 0x05, 0x06]
const EOCD_MIN_SIZE = 22
const MAX_EOCD_SEARCH = 65_535 + EOCD_MIN_SIZE
const ZIP64_ENTRY_MARKER = 0xffff
const ZIP64_SIZE_MARKER = 0xffffffff
// Upper bound on central-directory bytes per entry (name + extra + comment + 46-byte header).
const MAX_CENTRAL_BYTES_PER_ENTRY = 1024

const unsafe = () => new ArchiveError('unsafe_path', 'Archive contains an unsafe file path.')

/** Validates a member name and returns its normalized form. Only ever used as a lookup key. */
export const safeMemberPath = (name: string, limits: ArchiveLimits): string => {
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw unsafe()

  const unified = name.replaceAll('\\', '/')

  if (unified.startsWith('/') || /^[A-Za-z]:/.test(unified)) throw unsafe()

  const parts = unified.split('/')

  // Directory entries end with a slash.
  if (parts[parts.length - 1] === '') parts.pop()

  if (parts.length === 0 || parts.some(part => part === '' || part === '.' || part === '..')) throw unsafe()

  if (unified.length > limits.maxPathLength || parts.length > limits.maxPathDepth) throw unsafe()

  return parts.join('/')
}

const extensionOf = (path: string) => {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(dot).toLowerCase() : ''
}

/** Reject absurd entry counts before the central directory is parsed (and allocated). */
const precheckCentralDirectory = (bytes: Uint8Array, limits: ArchiveLimits) => {
  const start = Math.max(0, bytes.length - MAX_EOCD_SEARCH)
  let index = -1

  for (let i = bytes.length - EOCD_MIN_SIZE; i >= start; i--) {
    if (
      bytes[i] === EOCD_SIGNATURE[0] &&
      bytes[i + 1] === EOCD_SIGNATURE[1] &&
      bytes[i + 2] === EOCD_SIGNATURE[2] &&
      bytes[i + 3] === EOCD_SIGNATURE[3]
    ) {
      index = i
      break
    }
  }

  if (index < 0) throw new ArchiveError('not_a_zip', 'File is not a valid ZIP archive.')

  const view = new DataView(bytes.buffer, bytes.byteOffset + index, EOCD_MIN_SIZE)
  const totalEntries = view.getUint16(10, true)
  const centralSize = view.getUint32(12, true)
  const tooMany = () => new ArchiveError('too_many_entries', 'Archive contains too many files.')

  if (totalEntries === ZIP64_ENTRY_MARKER || centralSize === ZIP64_SIZE_MARKER) {
    // ZIP64 carries the real values; with limits this small, that means "too many".
    if (limits.maxEntries < ZIP64_ENTRY_MARKER) throw tooMany()

    return
  }

  if (totalEntries > limits.maxEntries || centralSize > limits.maxEntries * MAX_CENTRAL_BYTES_PER_ENTRY) {
    throw tooMany()
  }
}

type EntryInfo = { raw: string; path: string; size: number; compressed: number }

const ratioExceeded = (uncompressed: number, compressed: number, limits: ArchiveLimits) =>
  uncompressed >= limits.ratioCheckMinBytes && uncompressed / Math.max(compressed, 1) > limits.maxCompressionRatio

/** Validate the archive and inflate only the candidate followers/following JSON files. */
export const readExportArchive = (bytes: Uint8Array, limits: ArchiveLimits = DEFAULT_LIMITS): ArchiveContents => {
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new ArchiveError('archive_too_large', 'Archive file is too large.')
  }

  if (bytes.byteLength < EOCD_MIN_SIZE) throw new ArchiveError('not_a_zip', 'File is not a valid ZIP archive.')

  precheckCentralDirectory(bytes, limits)

  // Pass 1: list entries from the central directory without inflating anything.
  const entries: EntryInfo[] = []
  const compressionKinds: number[] = []

  try {
    unzipSync(bytes, {
      filter: info => {
        entries.push({ raw: info.name, path: info.name, size: info.originalSize, compressed: info.size })
        compressionKinds.push(info.compression)

        return false
      }
    })
  } catch {
    throw new ArchiveError('not_a_zip', 'File is not a valid ZIP archive.')
  }

  if (entries.length > limits.maxEntries) throw new ArchiveError('too_many_entries', 'Archive contains too many files.')

  const seen = new Set<string>()
  const members: EntryInfo[] = []
  let total = 0

  entries.forEach((entry, i) => {
    entry.path = safeMemberPath(entry.raw, limits)

    const key = entry.path.toLowerCase()

    if (seen.has(key)) throw new ArchiveError('duplicate_entry', 'Archive contains duplicate file paths.')

    seen.add(key)

    // Directory entries carry no data.
    if (entry.raw.endsWith('/')) return

    if (compressionKinds[i] !== 0 && compressionKinds[i] !== 8) {
      throw new ArchiveError('unsupported_compression', 'Unsupported compression method.')
    }

    if (!isMetadataPath(entry.path) && !limits.allowedExtensions.has(extensionOf(entry.path))) {
      throw new ArchiveError('unsupported_file_type', 'Archive contains unsupported files.')
    }

    if (entry.size > limits.maxEntryBytes) throw new ArchiveError('entry_too_large', 'A file in the archive is too large.')

    total += entry.size

    if (total > limits.maxTotalBytes) throw new ArchiveError('total_too_large', 'Archive contents are too large.')

    if (ratioExceeded(entry.size, entry.compressed, limits)) {
      throw new ArchiveError('suspicious_compression', 'Archive compression is suspicious.')
    }

    members.push(entry)
  })

  if (ratioExceeded(total, bytes.byteLength, limits)) {
    throw new ArchiveError('suspicious_compression', 'Archive compression is suspicious.')
  }

  // Pass 2: inflate only candidate JSON members that fit under the per-JSON limit.
  const byRaw = new Map(members.map(m => [m.raw, m]))
  const oversized: string[] = []
  const wanted = new Set<string>()

  for (const member of members) {
    if (!isCandidatePath(member.path)) continue

    if (member.size > limits.maxJsonBytes) oversized.push(member.path)
    else wanted.add(member.raw)
  }

  const files = new Map<string, Uint8Array>()

  if (wanted.size > 0) {
    try {
      const inflated = unzipSync(bytes, { filter: info => wanted.has(info.name) })

      for (const [raw, data] of Object.entries(inflated)) {
        const member = byRaw.get(raw)

        // Belt and braces: the bytes actually produced must also respect the cap.
        if (member === undefined || data.byteLength > limits.maxJsonBytes) {
          throw new ArchiveError('entry_too_large', 'A file in the archive is too large.')
        }

        files.set(normalizeMemberPath(member.path), data)
      }
    } catch (error) {
      if (error instanceof ArchiveError) throw error

      throw new ArchiveError('corrupted_archive', 'Archive is corrupted.')
    }
  }

  return {
    files,
    oversized,
    memberPaths: members.map(m => m.path),
    entryCount: entries.length,
    totalUncompressedBytes: total
  }
}
