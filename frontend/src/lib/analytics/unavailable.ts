/**
 * Accounts the user has marked as no longer available on Instagram (deactivated, deleted or otherwise gone).
 *
 * An export can keep listing such accounts after the app has stopped counting them, so the user can tick them
 * off and the figures then match what Instagram shows. A marked account is removed from BOTH lists before any
 * metric is computed, so every figure stays consistent. Marks are the user's own judgement: nothing here
 * contacts Instagram or decides which accounts are inactive.
 */

import type { Account } from '../instagram/types'

/** Why the user set an account aside. A label the user chooses: INYX cannot tell these apart from the export. */
export type UnavailableReason = 'deactivated' | 'suspended' | 'deleted' | 'blocked'

export const REASONS: readonly UnavailableReason[] = ['deactivated', 'suspended', 'deleted', 'blocked']

export const REASON_LABEL: Record<UnavailableReason, string> = {
  deactivated: 'Deactivated',
  suspended: 'Suspended',
  deleted: 'Deleted',
  blocked: 'Blocked me'
}

export const isReason = (value: unknown): value is UnavailableReason => REASONS.includes(value as UnavailableReason)

export type Reasons = Record<string, UnavailableReason>

/** Records the reason for each username (or clears it when none is given), dropping reasons for unmarked accounts. */
export const updateReasons = (
  current: Reasons,
  usernames: readonly string[],
  reason: UnavailableReason | undefined,
  marks: ReadonlySet<string>
): Reasons => {
  const next: Reasons = {}

  for (const [username, value] of Object.entries(current)) if (marks.has(username)) next[username] = value

  for (const username of usernames) {
    if (!marks.has(username)) delete next[username]
    else if (reason) next[username] = reason
    else delete next[username]
  }

  return next
}

export const excludeUnavailable = (accounts: readonly Account[], marked: ReadonlySet<string>): Account[] =>
  marked.size === 0 ? [...accounts] : accounts.filter(account => !marked.has(account.username))

/** The marked accounts, once each, taken from whichever list holds them (the followers record wins). */
export const unavailableAccounts = (
  followers: readonly Account[],
  following: readonly Account[],
  marked: ReadonlySet<string>
): Account[] => {
  const found = new Map<string, Account>()

  for (const account of [...followers, ...following]) {
    if (marked.has(account.username) && !found.has(account.username)) found.set(account.username, account)
  }

  return [...found.values()].sort((a, b) => (a.username < b.username ? -1 : a.username > b.username ? 1 : 0))
}

/** Adds or removes usernames, ignoring duplicates, and keeps the result sorted so it is stable to store. */
export const updateMarks = (current: readonly string[], usernames: readonly string[], marked: boolean): string[] => {
  const next = new Set(current)

  for (const username of usernames) {
    if (marked) next.add(username)
    else next.delete(username)
  }

  return [...next].sort()
}
