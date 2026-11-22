import { describe, expect, it } from 'vitest'

import { followersEntry, followersJson, followingEntry, followingJson, TS } from '../test-helpers'
import { buildProfileUrl, isValidUsername, normalizeUsername, parseTimestamp } from './normalize'
import { parseExportFiles } from './parse'

describe('normalizeUsername', () => {
  it.each([
    ['alice', 'alice'],
    ['  Alice  ', 'alice'],
    ['@alice', 'alice'],
    ['alice/', 'alice'],
    ['https://www.instagram.com/alice', 'alice'],
    ['https://instagram.com/Alice?hl=en', 'alice'],
    ['https://www.instagram.com/_u/alice', 'alice'],
    ['http://m.instagram.com/alice/#top', 'alice'],
    ['www.instagram.com/alice', 'alice'],
    ['instagram.com/alice/', 'alice']
  ])('normalizes %s', (raw, expected) => {
    expect(normalizeUsername(raw)).toBe(expected)
  })

  it.each([
    null,
    42,
    '',
    '   ',
    '@',
    'has space',
    'a'.repeat(31),
    'bad/slash',
    'bad<script>',
    'javascript:alert(1)',
    'https://evil.example/alice',
    'https://instagram.com.evil.example/alice',
    'https://www.instagram.com/',
    'https://www.instagram.com/p/ABC123/',
    'https://www.instagram.com/explore/',
    'ftp://www.instagram.com/alice'
  ])('rejects %s', raw => {
    expect(normalizeUsername(raw)).toBeNull()
  })

  it('only builds profile URLs for validated usernames', () => {
    expect(buildProfileUrl('alice')).toBe('https://www.instagram.com/alice/')

    for (const bad of ['', 'Alice', 'a b', 'x/../y', 'javascript:1']) {
      expect(isValidUsername(bad)).toBe(false)
      expect(() => buildProfileUrl(bad)).toThrow('Invalid')
    }
  })

  it('parses plausible timestamps and refuses the rest', () => {
    expect(parseTimestamp(1_700_000_000)).toBe(1_700_000_000)

    for (const bad of [null, '1700000000', true, 0, -5, 999, 1e12, Infinity]) expect(parseTimestamp(bad)).toBeNull()
  })
})

const names = (accounts: { username: string }[]) => accounts.map(a => a.username)

describe('parseExportFiles', () => {
  it('parses followers and following in the standard layout', () => {
    const result = parseExportFiles({
      'connections/followers_and_following/followers_1.json': followersJson('alice', 'bob'),
      'connections/followers_and_following/following.json': followingJson('bob', 'carol')
    })

    expect(names(result.followers)).toEqual(['alice', 'bob'])
    expect(names(result.following)).toEqual(['bob', 'carol'])
    expect(result.issues).toEqual([])
    expect(result.recordsSeen).toEqual({ followers: 2, following: 2 })
  })

  it('takes fields only from the source', () => {
    const [account] = parseExportFiles({ 'followers_1.json': followersJson('alice') }).followers

    expect(account.profileUrl).toBe('https://www.instagram.com/alice/')
    expect(account.followedAt).toBe(TS)
    expect(account.source).toBe('followers_1.json')
  })

  it('leaves a missing timestamp null', () => {
    const data = JSON.stringify([followersEntry('alice', null)])

    expect(parseExportFiles({ 'followers_1.json': data }).followers[0].followedAt).toBeNull()
  })

  it('merges multiple files and de-duplicates, counting the raw records', () => {
    const result = parseExportFiles({
      'x/followers_1.json': followersJson('alice', 'bob'),
      'x/followers_2.json': followersJson('bob', 'carol'),
      'x/followers_10.json': followersJson('dave')
    })

    expect(names(result.followers).sort()).toEqual(['alice', 'bob', 'carol', 'dave'])
    expect(result.recordsSeen.followers).toBe(5)
  })

  it('treats case variants as one account and keeps the newest timestamp', () => {
    const data = JSON.stringify([followersEntry('Alice', TS), followersEntry('ALICE', TS + 500), followersEntry('alice', null)])
    const result = parseExportFiles({ 'followers_1.json': data })

    expect(result.followers).toHaveLength(1)
    expect(result.followers[0].followedAt).toBe(TS + 500)
  })

  it('reads usernames from title and href when value is missing', () => {
    const viaTitle = JSON.stringify({ relationships_following: [followingEntry('alice')] })
    const viaHref = JSON.stringify({
      relationships_following: [{ title: '', string_list_data: [{ href: 'https://www.instagram.com/_u/zed' }] }]
    })

    expect(names(parseExportFiles({ 'following.json': viaTitle }).following)).toEqual(['alice'])
    expect(names(parseExportFiles({ 'following.json': viaHref }).following)).toEqual(['zed'])
  })

  it('accepts a relationships_followers wrapper', () => {
    const data = JSON.stringify({ relationships_followers: [followersEntry('alice')] })

    expect(names(parseExportFiles({ 'followers_and_following/followers.json': data }).followers)).toEqual(['alice'])
  })

  it('does not depend on directory names', () => {
    const result = parseExportFiles({
      'my export/anything/followers_1.json': followersJson('alice'),
      'other\\place\\following.json': followingJson('bob')
    })

    expect(names(result.followers)).toEqual(['alice'])
    expect(names(result.following)).toEqual(['bob'])
  })

  it('classifies unexpected names inside the follow directory by their content', () => {
    const data = JSON.stringify({ relationships_following: [followingEntry('alice')] })

    expect(names(parseExportFiles({ 'connections/followers_and_following/renamed.json': data }).following)).toEqual(['alice'])
  })

  it('tolerates a UTF-8 byte order mark', () => {
    expect(names(parseExportFiles({ 'followers_1.json': '﻿' + followersJson('alice') }).followers)).toEqual(['alice'])
  })

  it('ignores unrelated and metadata files without raising issues', () => {
    const result = parseExportFiles({
      'connections/followers_and_following/close_friends.json': JSON.stringify({ relationships_close_friends: [] }),
      'messages/inbox/t/message_1.json': '{not parsed}',
      'followers_1.json.bak': 'nope',
      '__MACOSX/followers_1.json': 'garbage',
      'x/._followers_1.json': 'garbage',
      'following_hashtags.json': '[]'
    })

    expect(result.files).toEqual([])
    expect(result.issues.map(i => i.code)).toEqual(['no_connection_files'])
  })

  it('reports malformed JSON without leaking content, and continues', () => {
    const result = parseExportFiles({ 'followers_1.json': '{not json', 'followers_2.json': followersJson('alice') })

    expect(names(result.followers)).toEqual(['alice'])
    expect(result.issues.map(i => i.code)).toEqual(['invalid_json'])
    expect(result.issues[0].message).not.toContain('not json')
  })

  it('rejects invalid UTF-8 as invalid JSON', () => {
    const result = parseExportFiles({ 'followers_1.json': new Uint8Array([0xff, 0xfe, 0x00, 0x62]) })

    expect(result.issues.map(i => i.code)).toEqual(['invalid_json'])
  })

  it('reports unexpected structures', () => {
    expect(parseExportFiles({ 'following.json': '{"something_else": []}' }).issues.map(i => i.code)).toEqual(['unexpected_structure'])
    expect(parseExportFiles({ 'followers_1.json': '"just a string"' }).issues.map(i => i.code)).toEqual(['unexpected_structure'])
  })

  it('skips oversized files with an issue', () => {
    const result = parseExportFiles({ 'followers_1.json': followersJson('alice') }, 10)

    expect(result.followers).toEqual([])
    expect(result.issues.map(i => i.code)).toEqual(['file_too_large'])
  })

  it('counts invalid entries rather than fabricating accounts', () => {
    const entries = [
      followersEntry('alice'),
      { title: '', string_list_data: [] },
      { title: '', string_list_data: [{ href: 'https://evil.example/x', value: 'bad name' }] },
      'not-a-dict',
      { string_list_data: ['not-a-dict'] },
      null
    ]
    const result = parseExportFiles({ 'followers_1.json': JSON.stringify(entries) })

    expect(names(result.followers)).toEqual(['alice'])
    expect(result.files[0]).toMatchObject({ entriesSeen: 6, invalidEntries: 5 })
  })

  it('parses empty lists cleanly', () => {
    const result = parseExportFiles({ 'followers_1.json': '[]', 'following.json': '{"relationships_following": []}' })

    expect(result.followers).toEqual([])
    expect(result.issues).toEqual([])
    expect(result.files).toHaveLength(2)
  })

  it('never turns malicious values into links', () => {
    const entries = [
      followersEntry('alice', TS, 'javascript:alert(1)'),
      { title: '', string_list_data: [{ value: '<img src=x onerror=alert(1)>' }] },
      { title: '', string_list_data: [{ value: 'javascript:alert(1)' }] }
    ]
    const result = parseExportFiles({ 'followers_1.json': JSON.stringify(entries) })

    expect(names(result.followers)).toEqual(['alice'])
    expect(result.followers[0].profileUrl).toBe('https://www.instagram.com/alice/')
  })
})
