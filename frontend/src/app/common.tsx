import { Link } from 'react-router'
import type { ReactNode } from 'react'

import { useAppData, type Session } from '@/data/context'
import { formatDateTime } from '@/lib/format'

type PropsPageHead = {
  label: string
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
}

/** The page title block: a mono label, the condensed-caps title, and an optional line and actions. */
export const PageHead = ({ label, title, sub, actions }: PropsPageHead) => (
  <div className='ix-page-head'>
    <div>
      <p className='ix-mono ix-muted'>{label}</p>
      <h1 className='ix-title'>{title}</h1>
      {sub && <p className='ix-sub'>{sub}</p>}
    </div>
    {actions && <div className='flex flex-wrap items-center gap-2'>{actions}</div>}
  </div>
)

type PropsEmptyState = {
  title: string
  body: string
  children?: ReactNode
  tone?: 'dark' | 'light'
}

export const EmptyState = ({ title, body, children, tone = 'light' }: PropsEmptyState) => (
  <div className={tone === 'dark' ? 'ix-empty' : 'ix-empty ix-light'}>
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
      <div className='ix-panel' role='status'>
        <p className='ix-note'>Checking this device for saved snapshots...</p>
      </div>
    )
  }

  return (
    <div className='ix-panel ix-light'>
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

/** Where the numbers on screen come from, so the date and source are never ambiguous. */
export const SessionContext = ({ session }: { session: Session }) => (
  <>
    {session.origin === 'sample' ? (
      <span className='ix-chip ix-sample-tag'>Sample data (synthetic)</span>
    ) : (
      <>
        <span className='ix-chip'>{session.origin === 'snapshot' ? 'Saved snapshot' : 'This import'}</span>
        <span className='ix-chip'>{session.fileName}</span>
      </>
    )}
    <span className='ix-chip'>Analysed {formatDateTime(session.analyzedAt)}</span>
  </>
)
