import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'

import PixelStrip from '@/components/dots/PixelStrip'
import Dialog from '@/components/ui/Dialog'
import { useAppData, type Session } from '@/data/context'
import { formatDateTime } from '@/lib/format'
import type { ParseIssue } from '@/lib/instagram/types'

type PropsPageHead = {
  label: string
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  /** Keep the line under the title on short windows, where it is otherwise hidden to save room. */
  keepSub?: boolean
}

/** The page title block: a mono label, the condensed-caps title, and an optional line and actions. */
export const PageHead = ({ label, title, sub, actions, keepSub = false }: PropsPageHead) => (
  <div className='ix-head'>
    <div style={{ minWidth: 0 }}>
      <p className='ix-label'>{label}</p>
      <h1 className='ix-title'>{title}</h1>
      {sub && <div className={keepSub ? 'ix-sub ix-sub-keep' : 'ix-sub'}>{sub}</div>}
    </div>
    <div className='ix-head-end'>
      <PixelStrip className='ix-hide-sm' count={10} seed={label.length} />
      {actions}
    </div>
  </div>
)

type PropsEmptyState = {
  title: string
  body: string
  children?: ReactNode
}

export const EmptyState = ({ title, body, children }: PropsEmptyState) => (
  <div className='ix-empty'>
    <h2 className='ix-h2'>{title}</h2>
    <p>{body}</p>
    {children && <div className='flex flex-wrap justify-center gap-2'>{children}</div>}
  </div>
)

/** Shown by pages that need an analysis before they can say anything. */
export const NoDataState = () => {
  const { loadSample, loading } = useAppData()

  if (loading) {
    return (
      <div className='ix-tile' role='status'>
        <p className='ix-note'>Checking this device for saved snapshots...</p>
      </div>
    )
  }

  return (
    <div className='ix-tile' style={{ flex: 1 }}>
      <EmptyState
        title='No data yet'
        body='Import your Instagram export to see your followers, following and mutual connections. It stays in this browser.'
      >
        <Link to='/app/import' className='ix-btn ix-btn-dark'>
          Import your export
        </Link>
        <button type='button' className='ix-btn' onClick={loadSample}>
          Try with sample data
        </button>
      </EmptyState>
    </div>
  )
}

const ALERT_CLASS = { error: 'ix-alert ix-alert-error', warning: 'ix-alert', info: 'ix-alert ix-alert-info' } as const

/** One issue from the parser, styled by severity. Issues never contain usernames or file contents. */
export const IssueAlert = ({ issue, title }: { issue: ParseIssue; title: string }) => (
  <div className={ALERT_CLASS[issue.severity]} role={issue.severity === 'error' ? 'alert' : undefined}>
    <div>
      <strong>{title}</strong>
      {issue.message}
      {issue.path ? <span className='ix-note'> ({issue.path.split('/').pop()})</span> : null}
    </div>
  </div>
)

/**
 * Warns, in one line, when the analysis on screen may not cover the whole network. The figures are exact for the
 * files that were read, so this says what may be missing instead of leaving the numbers to look authoritative.
 * The full list of problems opens in a dialog so it never pushes the page content down.
 */
export const CompletenessNotice = ({ session }: { session: Session }) => {
  const [open, setOpen] = useState(false)

  if (session.origin === 'sample' || session.completeness === null || session.completeness === 'complete') return null

  const problems = session.issues.filter(issue => issue.severity !== 'info')
  const incomplete = session.completeness === 'incomplete'

  return (
    <div className={incomplete ? 'ix-banner ix-banner-error' : 'ix-banner ix-banner-warn'} role='status'>
      <span>
        <strong>{incomplete ? 'This export looks incomplete.' : 'These results may not cover everyone.'}</strong> The figures are exact for the
        files that were read.
      </span>
      <button type='button' className='ix-btn ix-btn-sm' onClick={() => setOpen(true)}>
        See what may be missing
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={incomplete ? 'This export looks incomplete' : 'These results may not cover everyone'}
        description='The figures are exact for the files that were read, but they may not be your whole network.'
      >
        {problems.length > 0 ? (
          <ul style={{ listStyle: 'disc', paddingLeft: 18, display: 'grid', gap: 8, fontSize: '0.88rem' }}>
            {problems.map((issue, index) => (
              <li key={`${issue.code}-${index}`}>{issue.message}</li>
            ))}
          </ul>
        ) : (
          <p className='ix-note'>No specific problem was recorded.</p>
        )}
        <Link to='/app/import' className='ix-btn ix-btn-dark' style={{ marginTop: 16 }} onClick={() => setOpen(false)}>
          Import a fresh export
        </Link>
      </Dialog>
    </div>
  )
}

/** Says how many accounts are left out of the figures because the user marked them unavailable. */
export const MarksNotice = ({ session }: { session: Session }) => {
  const count = session.unavailable.length

  if (count === 0) return null

  const where =
    session.snapshotId !== null
      ? 'Saved with this snapshot, in this browser only.'
      : session.origin === 'sample'
        ? 'This is sample data, so nothing is saved.'
        : 'Kept only while this tab is open; save a snapshot to keep them.'

  return (
    <Link
      to='/app/lists/unavailable'
      className='ix-chip'
      role='status'
      title={`${count.toLocaleString('en-US')} ${count === 1 ? 'account is' : 'accounts are'} marked as unavailable and left out of every figure. ${where}`}
    >
      <span aria-hidden className='ix-dot-warn' />
      {count.toLocaleString('en-US')} marked unavailable
    </Link>
  )
}

/** Where the numbers on screen come from, so the date and source are never ambiguous. */
export const SessionContext = ({ session }: { session: Session }) => (
  <>
    {session.origin === 'sample' ? (
      <span className='ix-chip ix-sample-tag'>Sample data (synthetic)</span>
    ) : (
      <>
        <span className='ix-chip'>{session.origin === 'snapshot' ? 'Saved snapshot' : 'This import'}</span>
        <span className='ix-chip' style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {session.fileName}
        </span>
      </>
    )}
    <span className='ix-chip'>Analysed {formatDateTime(session.analyzedAt)}</span>
  </>
)
