/// <reference types="node" />
/**
 * Local-only validation of the frontend pipeline against a real Instagram export.
 *
 * Skipped unless INYX_REFERENCE_DIR points at a directory holding an unpacked export folder and, optionally, the
 * original .zip beside it. The real data must never be committed. This file has no usernames and no expected
 * totals: it recomputes totals with a naive traversal of the raw JSON and checks that the parser agrees.
 *
 *   $env:INYX_REFERENCE_DIR = (Resolve-Path ../reference).Path; npm test -- src/lib/instagram/reference.test.ts
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

import { importExportFile } from './importExport'
import { parseExportFiles } from './parse'

const REFERENCE = process.env.INYX_REFERENCE_DIR
const FOLLOWERS = /^followers(_\d+)?\.json$/i
const FOLLOWING = /^following(_\d+)?\.json$/i

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const full = join(dir, name)

    return statSync(full).isDirectory() ? walk(full) : [full]
  })

const rawUsernames = (path: string): string[] => {
  let data = JSON.parse(readFileSync(path, 'utf-8').replace(/^﻿/, ''))

  if (!Array.isArray(data)) data = Object.values(data).find(Array.isArray)

  return (data as { title?: string; string_list_data: { href?: string; value?: string }[] }[]).flatMap(entry =>
    entry.string_list_data.map(item => {
      const match = /instagram\.com\/(?:_u\/)?([^/?#]+)/.exec(item.href ?? '')

      return (match?.[1] ?? item.value ?? entry.title ?? '').toLowerCase()
    })
  )
}

describe.skipIf(!REFERENCE || !existsSync(REFERENCE))('the real reference export', () => {
  const base = REFERENCE ?? '.'
  const root = join(base, readdirSync(base).find(name => statSync(join(base, name)).isDirectory()) ?? '')
  const files = walk(root)
  const parsed = parseExportFiles(new Map(files.map(f => [relative(root, f).replaceAll('\\', '/'), readFileSync(f)])), {
    sourceName: `${root.split(/[\\/]/).pop()}.zip`
  })

  const raw = (pattern: RegExp) => files.filter(f => pattern.test(f.split(/[\\/]/).pop()!)).flatMap(rawUsernames)

  it('matches an independent count of the raw files', () => {
    const followers = raw(FOLLOWERS)
    const following = raw(FOLLOWING)

    expect(followers.length).toBeGreaterThan(0)
    expect(following.length).toBeGreaterThan(0)
    expect(parsed.diagnostics.followers.recordsSeen).toBe(followers.length)
    expect(parsed.diagnostics.following.recordsSeen).toBe(following.length)
    expect(parsed.diagnostics.followers.rejectedRecords + parsed.diagnostics.following.rejectedRecords).toBe(0)
    expect(new Set(parsed.followers.map(a => a.username))).toEqual(new Set(followers))
    expect(new Set(parsed.following.map(a => a.username))).toEqual(new Set(following))
  })

  it('processes only the followers and following files and loses nothing silently', () => {
    expect(parsed.diagnostics.files.filter(f => f.status === 'failed')).toEqual([])
    expect(parsed.issues.filter(i => i.severity === 'error')).toEqual([])
    expect(parsed.issues.some(i => i.code === 'rejected_records')).toBe(false)
    expect(parsed.files.length).toBe(files.filter(f => FOLLOWERS.test(f.split(/[\\/]/).pop()!) || FOLLOWING.test(f.split(/[\\/]/).pop()!)).length)
  })

  it('gives the same result through the real zip as the unpacked folder', async () => {
    const zipName = readdirSync(base).find(name => name.toLowerCase().endsWith('.zip'))

    if (!zipName) return

    const viaZip = await importExportFile(new File([readFileSync(join(base, zipName))], zipName))

    expect(new Set(viaZip.parsed.followers.map(a => a.username))).toEqual(new Set(parsed.followers.map(a => a.username)))
    expect(new Set(viaZip.parsed.following.map(a => a.username))).toEqual(new Set(parsed.following.map(a => a.username)))
    expect(viaZip.parsed.diagnostics.status).toBe(parsed.diagnostics.status)
    expect(viaZip.parsed.diagnostics.exportDate).toBe(parsed.diagnostics.exportDate)
    expect(viaZip.parsed.issues.map(i => i.code)).toEqual(parsed.issues.map(i => i.code))
  })
})
