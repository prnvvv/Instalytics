import { useId, useState } from 'react'

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
  const [followersText, setFollowersText] = useState('')
  const [followingText, setFollowingText] = useState('')
  const followersId = useId()
  const followingId = useId()

  const { analysis } = session
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
    <section className='ix-card ix-span-4' aria-labelledby='reconcile-title'>
      <div className='ix-card-head'>
        <div>
          <h2 id='reconcile-title' className='ix-card-title'>
            Check against Instagram
          </h2>
          <p className='ix-card-sub'>
            Optional. Type the counts your Instagram profile shows to see how they compare with this export. Nothing
            you type is stored or sent anywhere.
          </p>
        </div>
      </div>

      <div className='ix-toolbar' style={{ marginTop: 16 }}>
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
    </section>
  )
}

export default ReconcilePanel
