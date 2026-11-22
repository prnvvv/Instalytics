/**
 * Reconciling an export with the counts Instagram's own app shows.
 *
 * An export is a snapshot of a file; the app's profile counts are live and only include accounts that are
 * currently active. They rarely match exactly, and the user can type in what the app shows to see why. The
 * reasoning is deliberately hedged: the export carries no per-account status, so nothing here claims to know
 * which accounts are inactive, only what the difference could mean.
 */

export type ReconcileKind = 'followers' | 'following'

export type ReconcileVerdict = 'match' | 'export-has-more' | 'export-has-fewer'

export type ReconcileContext = {
  /** Accounts you follow that do not follow back, and followers you do not follow back, from the export. */
  notFollowingBack: number
  fans: number
  /** Whether the import was already flagged as possibly limited to a date range. */
  dateLimited: boolean
}

export type ReconcileResult = {
  kind: ReconcileKind
  exported: number
  reported: number
  /** exported - reported: positive when the export lists more accounts than Instagram shows. */
  difference: number
  verdict: ReconcileVerdict
  title: string
  detail: string
}

/** Instagram's count is live, so a few accounts of drift is normal: 0.5% of the count, and never less than 2. */
export const tolerance = (reported: number) => Math.max(2, Math.round(reported * 0.005))

const noun = (kind: ReconcileKind) => (kind === 'followers' ? 'followers' : 'accounts you follow')

const plural = (n: number, one: string, many: string) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`

export const reconcile = (
  kind: ReconcileKind,
  exported: number,
  reported: number,
  context: ReconcileContext
): ReconcileResult => {
  const difference = exported - reported
  const size = Math.abs(difference)
  const base = { kind, exported, reported, difference }

  if (size <= tolerance(reported)) {
    return {
      ...base,
      verdict: 'match',
      title: difference === 0 ? `${kind === 'followers' ? 'Followers' : 'Following'} match exactly` : `${kind === 'followers' ? 'Followers' : 'Following'} match`,
      detail:
        difference === 0
          ? `The export lists ${exported.toLocaleString('en-US')} and Instagram shows ${reported.toLocaleString('en-US')}.`
          : `The export lists ${exported.toLocaleString('en-US')} and Instagram shows ${reported.toLocaleString('en-US')}. A difference of ${plural(size, 'account', 'accounts')} is normal: Instagram's count is live and the export is a snapshot.`
    }
  }

  if (difference > 0) {
    const side = kind === 'following' ? 'not following back' : 'fans'
    const current = kind === 'following' ? context.notFollowingBack : context.fans
    const lower = Math.max(0, current - size)

    return {
      ...base,
      verdict: 'export-has-more',
      title: `The export lists ${plural(size, 'more account', 'more accounts')} than Instagram shows`,
      detail:
        `Instagram's profile count only includes accounts that are active right now, while an export can still list ` +
        `accounts that have since been deactivated or deleted, and anything you changed after exporting also differs. ` +
        `The export carries no status per account, so it cannot say which ones. ` +
        `If the extra ${size.toLocaleString('en-US')} are inactive accounts, they could not follow you back, so they would all sit in "${side}": ` +
        `that figure would be closer to ${lower.toLocaleString('en-US')} than ${current.toLocaleString('en-US')}. ` +
        'Open a few profile links from the list: an inactive account shows that the page is not available.'
    }
  }

  return {
    ...base,
    verdict: 'export-has-fewer',
    title: `The export lists ${plural(size, 'fewer account', 'fewer accounts')} than Instagram shows`,
    detail:
      `Either ${noun(kind)} changed after you exported, or this export is incomplete. ` +
      (context.dateLimited
        ? 'It was already flagged as possibly limited to a date range, which would leave older accounts out. '
        : 'Check the warnings above for a missing file or a date-range limit. ') +
      'To be sure, request the export again with the date range set to All time and "Followers and following" selected.'
  }
}

/** Parses a typed count. Empty or invalid input is "not entered" (null), never zero. */
export const parseReported = (text: string): number | null => {
  const cleaned = text.replaceAll(/[\s,]/g, '')

  if (!/^\d{1,9}$/.test(cleaned)) return null

  return Number(cleaned)
}
