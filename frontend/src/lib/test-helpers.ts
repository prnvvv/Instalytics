/** Synthetic export builders for tests. All usernames are fictional; never add real export data here. */

import { zipSync, strToU8 } from 'fflate'

export const TS = 1_700_000_000

export const followersEntry = (username: string, timestamp: number | null = TS, href?: string) => ({
  title: '',
  media_list_data: [],
  string_list_data: [
    { href: href ?? `https://www.instagram.com/${username}`, value: username, ...(timestamp === null ? {} : { timestamp }) }
  ]
})

export const followingEntry = (username: string, timestamp: number | null = TS) => ({
  title: username,
  media_list_data: [],
  string_list_data: [
    { href: `https://www.instagram.com/_u/${username}`, ...(timestamp === null ? {} : { timestamp }) }
  ]
})

export const followersJson = (...usernames: string[]) => JSON.stringify(usernames.map(n => followersEntry(n)))

export const followingJson = (...usernames: string[]) =>
  JSON.stringify({ relationships_following: usernames.map(n => followingEntry(n)) })

export const makeZip = (members: Record<string, string | Uint8Array>, level: 0 | 6 = 6) =>
  zipSync(
    Object.fromEntries(Object.entries(members).map(([name, data]) => [name, typeof data === 'string' ? strToU8(data) : data])),
    { level }
  )

export const zipFile = (members: Record<string, string | Uint8Array>, name = 'export.zip') =>
  new File([makeZip(members) as BlobPart], name, { type: 'application/zip' })
