import { isHtmlConnectionPath, parseExportFiles } from './parse'
import type { ParsedExport } from './types'
import { ArchiveError, DEFAULT_LIMITS, readExportArchive, type ArchiveErrorCode, type ArchiveLimits } from './zip'

export type ImportStage = 'reading' | 'validating' | 'parsing'

export type ImportErrorCode = ArchiveErrorCode | 'not_a_zip_file' | 'empty_file' | 'read_failed'

export class ImportError extends Error {
  readonly code: ImportErrorCode

  constructor(code: ImportErrorCode, message: string) {
    super(message)
    this.name = 'ImportError'
    this.code = code
  }
}

export type ImportResult = {
  parsed: ParsedExport
  fileName: string
  fileSize: number
  entryCount: number
  analyzedAt: string
}

const FRIENDLY: Record<ImportErrorCode, string> = {
  not_a_zip_file: 'This is not a ZIP file. Choose the .zip archive Instagram sent you.',
  empty_file: 'This file is empty.',
  read_failed: 'The file could not be read. Try selecting it again.',
  not_a_zip: 'This file is not a valid ZIP archive. It may be incomplete or damaged; download the export again.',
  archive_too_large: 'This archive is larger than the 250 MB limit. Request only "Followers and following" in your export.',
  too_many_entries: 'This archive contains too many files to read safely.',
  unsafe_path: 'This archive contains unsafe file paths, so it was rejected.',
  duplicate_entry: 'This archive contains duplicate file paths, so it was rejected.',
  unsupported_file_type: 'This archive contains file types an Instagram export does not include, so it was rejected.',
  unsupported_compression: 'This archive uses a compression method that is not supported.',
  entry_too_large: 'A file inside this archive is larger than the safety limit.',
  total_too_large: 'This archive expands to more data than the safety limit allows.',
  suspicious_compression: 'This archive is compressed far more than normal, so it was rejected for safety.',
  corrupted_archive: 'This archive is damaged and could not be read. Download the export again.'
}

export const friendlyMessage = (code: ImportErrorCode) => FRIENDLY[code]

// Gives the UI a chance to paint each stage before the next synchronous step starts.
const nextFrame = () => new Promise<void>(resolve => setTimeout(resolve, 0))

/**
 * Reads, validates and parses an export entirely in the browser. The file never leaves this tab: there is
 * no network call anywhere in this path.
 */
export const importExportFile = async (
  file: File,
  onStage?: (stage: ImportStage) => void,
  limits: ArchiveLimits = DEFAULT_LIMITS
): Promise<ImportResult> => {
  if (!/\.zip$/i.test(file.name)) throw new ImportError('not_a_zip_file', FRIENDLY.not_a_zip_file)

  if (file.size === 0) throw new ImportError('empty_file', FRIENDLY.empty_file)

  if (file.size > limits.maxArchiveBytes) throw new ImportError('archive_too_large', FRIENDLY.archive_too_large)

  onStage?.('reading')
  await nextFrame()

  let bytes: Uint8Array

  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch {
    throw new ImportError('read_failed', FRIENDLY.read_failed)
  }

  // ZIP local headers start with "PK".
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new ImportError('not_a_zip_file', FRIENDLY.not_a_zip_file)

  onStage?.('validating')
  await nextFrame()

  let contents

  try {
    contents = readExportArchive(bytes, limits)
  } catch (error) {
    if (error instanceof ArchiveError) throw new ImportError(error.code, FRIENDLY[error.code])

    throw new ImportError('corrupted_archive', FRIENDLY.corrupted_archive)
  }

  onStage?.('parsing')
  await nextFrame()

  const parsed = parseExportFiles(contents.files, limits.maxJsonBytes)

  for (const path of contents.oversized) {
    parsed.issues.push({ code: 'file_too_large', path, message: 'File exceeds the size limit.' })
  }

  // A skipped oversized file already explains why nothing was found.
  if (contents.oversized.length > 0) {
    parsed.issues = parsed.issues.filter(issue => issue.code !== 'no_connection_files')
  }

  // An archive with no JSON connection files but HTML ones is a recognisable, unsupported layout.
  if (parsed.files.length === 0 && contents.memberPaths.some(isHtmlConnectionPath)) {
    const index = parsed.issues.findIndex(issue => issue.code === 'no_connection_files')

    const html = {
      code: 'html_export' as const,
      message: 'This looks like an HTML export. Request your data again and choose the JSON format.'
    }

    if (index >= 0) parsed.issues[index] = html
    else parsed.issues.push(html)
  }

  return {
    parsed,
    fileName: file.name,
    fileSize: file.size,
    entryCount: contents.entryCount,
    analyzedAt: new Date().toISOString()
  }
}
