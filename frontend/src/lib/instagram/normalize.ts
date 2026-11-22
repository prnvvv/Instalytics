/**
 * Username and profile-URL normalization (port of backend app/modules/parser/normalize.py).
 *
 * Usernames compare case-insensitively, so the canonical form is lowercase. Only validated usernames are
 * ever turned into profile URLs, which keeps imported data from producing `javascript:` or off-site links.
 */

const USERNAME_RE = /^[a-z0-9._]{1,30}$/
const INSTAGRAM_HOSTS = new Set(['instagram.com', 'www.instagram.com', 'm.instagram.com'])
const RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'tv',
  'stories',
  'explore',
  'accounts',
  'direct',
  'tags',
  'web'
])

// Plausible export timestamps: Instagram launched in 2010; cap at 2100.
const MIN_TIMESTAMP = 1_262_304_000
const MAX_TIMESTAMP = 4_102_444_800

export const isValidUsername = (username: string) => USERNAME_RE.test(username)

const usernameFromUrl = (input: string): string | null => {
  let url: URL

  try {
    url = new URL(input.includes('://') ? input : `https://${input}`)
  } catch {
    return null
  }

  if (!['http:', 'https:'].includes(url.protocol) || !INSTAGRAM_HOSTS.has(url.hostname)) return null

  let segments = url.pathname.split('/').filter(Boolean)

  // Exports link followed accounts as /_u/<username>.
  if (segments[0] === '_u') segments = segments.slice(1)

  if (segments.length === 0 || RESERVED_PATHS.has(segments[0])) return null

  return segments[0]
}

/** The canonical username for a username, `@handle` or Instagram profile URL; null if invalid. */
export const normalizeUsername = (raw: unknown): string | null => {
  if (typeof raw !== 'string') return null

  const text = raw.trim().toLowerCase()

  if (!text) return null

  const candidate =
    text.includes('://') || text.startsWith('instagram.com/') || text.startsWith('www.instagram.com/')
      ? usernameFromUrl(text)
      : text.replace(/^@/, '').replace(/\/+$/, '')

  return candidate !== null && isValidUsername(candidate) ? candidate : null
}

/** Profile URL for an already-normalized username. Throws for anything unvalidated. */
export const buildProfileUrl = (username: string) => {
  if (!isValidUsername(username)) throw new Error('Invalid Instagram username.')

  return `https://www.instagram.com/${username}/`
}

/** Unix seconds when plausible, else null. Missing or implausible values are never guessed. */
export const parseTimestamp = (raw: unknown): number | null => {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null

  return raw >= MIN_TIMESTAMP && raw <= MAX_TIMESTAMP ? Math.floor(raw) : null
}
