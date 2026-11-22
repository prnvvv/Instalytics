import { useId, useState } from 'react'
import { Link } from 'react-router'

import type { Session } from '@/data/context'
import { parseReported, reconcile, type ReconcileResult } from '@/lib/analytics/reconcile'

const ALERT = { match: 'ix-alert ix-alert-ok', 'export-has-more': 'ix-alert', 'export-has-fewer': 'ix-alert ix-alert-error' } as const

const Result = ({ result }: { result: ReconcileResult }) => (
  <div className={ALERT[result.verdict]}>
    <div>
      <strong>{result.title}</strong>
      {result.detail}
    </div>
  </div>
)

/**
 * Lets the user type what Instagram's own app shows on their profile and compares it with the export. Everything
 * is computed here in the browser; the numbers are not stored or sent anywhere.
 */
const ReconcilePanel = ({ session }: { session: Session }) => {
  // Rendered inside a dialog titled "Check against Instagram".
  const [followersText, setFollowersText] = useState('')
  const [followingText, setFollowingText] = useState('')
  const followersId = useId()
  const followingId = useId()

  const { analysis } = session
  const marks = session.unavailable.length
  const context = {
    notFollowingBack: analysis.notFollowingBackCount,
    fans: analysis.fansCount,
    dateLimited: session.issues.some(issue => issue.code === 'possible_date_range_limit')
  }
  const reportedFollowers = parseReported(followersText)
  const reportedFollowing = parseReported(followingText)
  const results = [
    reportedFollowers === null ? null : reconcile('followers', analysis.followersCount, reportedFollowers, context),
    reportedFollowing === null ? null : reconcile('following', analysis.followingCount, reportedFollowing, context)
  ].filter((result): result is ReconcileResult => result !== null)
  const invalid = (text: string) => text.trim() !== '' && parseReported(text) === null

  return (
    <section aria-label='Check against Instagram'>
      <p className='ix-note'>
        Optional. Type the counts your Instagram profile shows to see how they compare with this export. Nothing you
        type is stored or sent anywhere.
      </p>

      <div className='ix-toolbar' style={{ marginTop: 14 }}>
        <div>
          <label htmlFor={followersId} className='ix-mono' style={{ display: 'block', marginBottom: 6, color: 'var(--ix-muted)' }}>
            Followers in the Instagram app
          </label>
          <input
            id={followersId}
            className='ix-field'
            inputMode='numeric'
            autoComplete='off'
            placeholder={`Export: ${analysis.followersCount.toLocaleString('en-US')}`}
            value={followersText}
            aria-invalid={invalid(followersText)}
            onChange={event => setFollowersText(event.target.value)}
          />
        </div>
        <div>
          <label htmlFor={followingId} className='ix-mono' style={{ display: 'block', marginBottom: 6, color: 'var(--ix-muted)' }}>
            Following in the Instagram app
          </label>
          <input
            id={followingId}
            className='ix-field'
            inputMode='numeric'
            autoComplete='off'
            placeholder={`Export: ${analysis.followingCount.toLocaleString('en-US')}`}
            value={followingText}
            aria-invalid={invalid(followingText)}
            onChange={event => setFollowingText(event.target.value)}
          />
        </div>
      </div>

      {(invalid(followersText) || invalid(followingText)) && (
        <p className='ix-note' role='status'>
          Enter whole numbers only, for example 1200.
        </p>
      )}

      {results.length > 0 && (
        <div className='ix-stack' style={{ marginTop: 12 }} role='status'>
          {results.map(result => (
            <Result key={result.kind} result={result} />
          ))}
        </div>
      )}

      {marks > 0 && (
        <p className='ix-note' style={{ marginTop: 12 }}>
          These figures exclude the {marks.toLocaleString('en-US')} {marks === 1 ? 'account' : 'accounts'} you marked as unavailable. The export
          itself lists {session.baseFollowers.length.toLocaleString('en-US')} followers and {session.baseFollowing.length.toLocaleString('en-US')}{' '}
          following.
        </p>
      )}

      {results.some(result => result.verdict === 'export-has-more') && (
        <p className='ix-note' style={{ marginTop: 12 }}>
          To close the gap, open the profile links in{' '}
          <Link to='/app/lists/not-following-back' className='ix-link'>
            Not following back
          </Link>{' '}
          and tick the ones that are no longer available. Each tick leaves that account out of every figure here.
        </p>
      )}
    </section>
  )
}

export default ReconcilePanel
