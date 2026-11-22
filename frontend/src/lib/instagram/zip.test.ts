import { zipSync, strToU8 } from 'fflate'
import { describe, expect, it } from 'vitest'

import { followersJson, followingJson, makeZip, zipFile } from '../test-helpers'
import { friendlyMessage, importExportFile, ImportError } from './importExport'
import { ArchiveError, DEFAULT_LIMITS, readExportArchive, type ArchiveLimits } from './zip'

const limits = (overrides: Partial<ArchiveLimits>): ArchiveLimits => ({ ...DEFAULT_LIMITS, ...overrides })

const codeOf = (bytes: Uint8Array, lim: ArchiveLimits = DEFAULT_LIMITS) => {
  try {
    readExportArchive(bytes, lim)
  } catch (error) {
    if (error instanceof ArchiveError) return error.code

    throw error
  }

  return 'ok'
}

// fflate normalises nothing about member names, so hostile names survive into the archive.
const zipWithName = (name: string, data = '[]') => zipSync({ [name]: strToU8(data) })

describe('readExportArchive', () => {
  it('returns only candidate JSON members, with the full member list', () => {
    const contents = readExportArchive(
      makeZip({
        'export/connections/followers_and_following/followers_1.json': followersJson('alice'),
        'export/connections/followers_and_following/following.json': followingJson('bob'),
        'export/media/photo.JPG': 'jpeg bytes',
        'export/messages/inbox/t/message_1.json': '{}'
      })
    )

    expect([...contents.files.keys()].sort()).toEqual([
      'export/connections/followers_and_following/followers_1.json',
      'export/connections/followers_and_following/following.json'
    ])
    expect(contents.memberPaths).toHaveLength(4)
    expect(contents.entryCount).toBe(4)
  })

  it('tolerates macOS metadata', () => {
    expect(codeOf(makeZip({ '__MACOSX/._followers_1.json': 'x', '.DS_Store': 'x', 'a.json': '[]' }))).toBe('ok')
  })

  it('rejects non-zip data', () => {
    expect(codeOf(new Uint8Array())).toBe('not_a_zip')
    expect(codeOf(strToU8('not a zip at all'))).toBe('not_a_zip')
    expect(codeOf(new Uint8Array(100))).toBe('not_a_zip')
  })

  it('rejects a truncated archive', () => {
    const bytes = makeZip({ 'followers_1.json': followersJson('alice') })

    expect(['not_a_zip', 'corrupted_archive']).toContain(codeOf(bytes.slice(0, bytes.length / 2)))
  })

  it.each([
    '../evil.json',
    'a/../../evil.json',
    '/abs/evil.json',
    'C:/evil.json',
    'c:evil.json',
    'a/./b.json',
    'a//b.json',
    'a/\u0001b.json',
    '..\\..\\evil.json',
    'a/' + 'x/'.repeat(25) + 'f.json',
    'n'.repeat(300) + '.json'
  ])('rejects the unsafe path %j', name => {
    expect(codeOf(zipWithName(name))).toBe('unsafe_path')
  })

  it('rejects case-insensitive duplicates', () => {
    expect(codeOf(makeZip({ 'A/b.json': '[]', 'a/B.json': '[]' }))).toBe('duplicate_entry')
  })

  it.each(['run.exe', 'script.py', 'nested.zip', 'payload.js', 'noextension', '.hidden', 'x.json.exe'])(
    'rejects the unexpected file type %s',
    name => {
      expect(codeOf(makeZip({ [name]: 'x' }))).toBe('unsupported_file_type')
    }
  )

  it('enforces the archive size and entry count limits', () => {
    const bytes = makeZip({ 'a.json': '[]' })

    expect(codeOf(bytes, limits({ maxArchiveBytes: bytes.length - 1 }))).toBe('archive_too_large')

    const many = makeZip(Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`f${i}.json`, '[]'])))

    expect(codeOf(many, limits({ maxEntries: 5 }))).toBe('too_many_entries')
    expect(codeOf(many, limits({ maxEntries: 6 }))).toBe('ok')
  })

  it('rejects a forged entry count before parsing the central directory', () => {
    const bytes = makeZip({ 'a.json': '[]' })
    const eocd = bytes.length - 22

    new DataView(bytes.buffer, bytes.byteOffset).setUint16(eocd + 10, 0xffff, true)
    expect(codeOf(bytes)).toBe('too_many_entries')
  })

  it('rejects a forged central directory size', () => {
    const bytes = makeZip({ 'a.json': '[]' })

    new DataView(bytes.buffer, bytes.byteOffset).setUint32(bytes.length - 22 + 12, 500 * 1024 * 1024, true)
    expect(codeOf(bytes)).toBe('too_many_entries')
  })

  it('enforces entry and total size limits', () => {
    expect(codeOf(makeZip({ 'a.json': 'x'.repeat(5000) }), limits({ maxEntryBytes: 4999 }))).toBe('entry_too_large')
    expect(codeOf(makeZip({ 'a.json': 'x'.repeat(3000), 'b.json': 'y'.repeat(3000) }), limits({ maxTotalBytes: 5000 }))).toBe(
      'total_too_large'
    )
  })

  it('detects a zip bomb by compression ratio', () => {
    const bomb = makeZip({ 'bomb.json': new Uint8Array(5_000_000) })

    expect(codeOf(bomb, limits({ ratioCheckMinBytes: 1_000_000 }))).toBe('suspicious_compression')
  })

  it('stops a zip bomb with the default total limit lowered', () => {
    expect(codeOf(makeZip({ 'bomb.json': new Uint8Array(5_000_000) }), limits({ maxTotalBytes: 1_000_000 }))).toBe('total_too_large')
  })

  it('does not flag many small, highly compressible files', () => {
    const files = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`f${i}.json`, '[]'.repeat(200)]))

    expect(codeOf(makeZip(files))).toBe('ok')
  })

  it('skips candidate JSON over the per-file limit instead of inflating it', () => {
    const big = followersJson(...Array.from({ length: 200 }, (_, i) => `user${i}`))
    const contents = readExportArchive(makeZip({ 'followers_1.json': big, 'following.json': followingJson('a') }), limits({ maxJsonBytes: big.length - 1 }))

    expect(contents.oversized).toEqual(['followers_1.json'])
    expect([...contents.files.keys()]).toEqual(['following.json'])
  })

  it('flags CRC corruption on read', () => {
    const bytes = makeZip({ 'a.json': '["payload-payload-payload"]' }, 0)
    const at = bytes.findIndex((_, i) => String.fromCharCode(...bytes.slice(i, i + 7)) === 'payload')

    bytes[at] ^= 0xff
    expect(['ok', 'corrupted_archive']).toContain(codeOf(bytes))
  })

  it('never puts member names in error messages', () => {
    try {
      readExportArchive(makeZip({ 'secret-user-name.exe': 'x' }))
    } catch (error) {
      expect((error as Error).message).not.toContain('secret-user-name')
    }
  })
})

describe('importExportFile', () => {
  it('imports followers and following from a ZIP file', async () => {
    const stages: string[] = []
    const result = await importExportFile(
      zipFile({
        'instagram-export/connections/followers_and_following/followers_1.json': followersJson('alice', 'bob'),
        'instagram-export/connections/followers_and_following/following.json': followingJson('bob', 'carol'),
        'instagram-export/media/photo.jpg': 'jpeg',
        'instagram-export/messages/inbox/t/message_1.json': '{broken but irrelevant'
      }),
      stage => stages.push(stage)
    )

    expect(stages).toEqual(['reading', 'validating', 'parsing'])
    expect(result.parsed.followers.map(a => a.username)).toEqual(['alice', 'bob'])
    expect(result.parsed.following.map(a => a.username)).toEqual(['bob', 'carol'])
    expect(result.parsed.issues).toEqual([])
    expect(result.fileName).toBe('export.zip')
  })

  const codeOfImport = async (file: File) => {
    try {
      await importExportFile(file)
    } catch (error) {
      if (error instanceof ImportError) return error.code
    }

    return 'ok'
  }

  it('rejects wrong extensions, empty files and non-zip bytes with friendly codes', async () => {
    expect(await codeOfImport(new File(['x'], 'followers.json'))).toBe('not_a_zip_file')
    expect(await codeOfImport(new File([], 'export.zip'))).toBe('empty_file')
    expect(await codeOfImport(new File(['definitely not a zip'], 'export.zip'))).toBe('not_a_zip_file')
  })

  it('surfaces archive errors as friendly import errors', async () => {
    expect(await codeOfImport(zipFile({ 'run.exe': 'x' }))).toBe('unsupported_file_type')
    expect(await codeOfImport(zipFile({ '../evil.json': '[]' }))).toBe('unsafe_path')
    expect(friendlyMessage('unsafe_path')).toMatch(/unsafe/)
  })

  it('recognises an HTML export as an unsupported layout', async () => {
    const result = await importExportFile(
      zipFile({ 'connections/followers_and_following/followers_1.html': '<html></html>', 'connections/followers_and_following/following.html': '<html></html>' })
    )

    expect(result.parsed.issues.map(i => i.code)).toEqual(['html_export'])
  })

  it('reports an archive without connection files', async () => {
    const result = await importExportFile(zipFile({ 'media/photo.jpg': 'jpeg' }))

    expect(result.parsed.issues.map(i => i.code)).toEqual(['no_connection_files'])
  })

  it('reports an oversized JSON file as an issue', async () => {
    const big = followersJson(...Array.from({ length: 200 }, (_, i) => `user${i}`))
    const result = await importExportFile(zipFile({ 'followers_1.json': big }), undefined, limits({ maxJsonBytes: 100 }))

    expect(result.parsed.issues.map(i => i.code)).toContain('file_too_large')
    expect(result.parsed.diagnostics.status).toBe('incomplete')
  })
})
