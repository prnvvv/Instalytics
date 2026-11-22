import { useMemo } from 'react'
import { Navigate, NavLink, useParams } from 'react-router'

import { CompletenessNotice, NoDataState, PageHead, SessionContext } from '@/app/common'
import { useAppData } from '@/data/context'
import { accountsOfKind, type Relationship, type RelationshipKind } from '@/lib/analytics/relationships'
import { formatCount } from '@/lib/format'

import AccountTable from './AccountTable'

const KINDS: {
  kind: RelationshipKind
  label: string
  title: string
  description: string
  dateHeader: string
}[] = [
  {
    kind: 'not-following-back',
    label: 'Not following back',
    title: 'Not following back',
    description: 'Accounts you follow that do not follow you back. Review them yourself on Instagram.',
    dateHeader: 'You followed'
  },
  {
    kind: 'fans',
    label: 'Fans',
    title: 'Fans',
    description: 'Followers you do not follow back.',
    dateHeader: 'Followed you'
  },
  {
    kind: 'mutuals',
    label: 'Mutuals',
    title: 'Mutual connections',
    description: 'Accounts you follow that also follow you.',
    dateHeader: 'Followed you'
  },
  { kind: 'followers', label: 'Followers', title: 'Followers', description: 'Everyone who follows you.', dateHeader: 'Followed you' },
  { kind: 'following', label: 'Following', title: 'Following', description: 'Every account you follow.', dateHeader: 'You followed' }
]

const ListsPage = () => {
  const { kind } = useParams()
  const { session, settings } = useAppData()
  const active = KINDS.find(k => k.kind === kind)

  const relations = useMemo(() => {
    const map = new Map<string, Relationship>()

    if (session) {
      for (const a of session.analysis.mutuals) map.set(a.username, 'mutual')
      for (const a of session.analysis.notFollowingBack) map.set(a.username, 'not-following-back')
      for (const a of session.analysis.fans) map.set(a.username, 'fan')
    }

    return map
  }, [session])

  if (!active) return <Navigate to='/app/lists/not-following-back' replace />

  if (!session) {
    return (
      <>
        <PageHead label='Lists' title={active.title} />
        <NoDataState />
      </>
    )
  }

  const accounts = accountsOfKind(session.analysis, active.kind)

  return (
    <>
      <PageHead
        label='Lists'
        title={active.title}
        sub={active.description}
        actions={<SessionContext session={session} />}
      />

      <CompletenessNotice session={session} />

      <nav aria-label='Lists' className='ix-tabs'>
        {KINDS.map(item => (
          <NavLink key={item.kind} to={`/app/lists/${item.kind}`}>
            {item.label}
            <span>{formatCount(accountsOfKind(session.analysis, item.kind).length)}</span>
          </NavLink>
        ))}
      </nav>

      <section className='ix-card' aria-label={active.title}>
        {active.kind === 'not-following-back' && accounts.length > 0 && (
          <p className='ix-note' style={{ marginBottom: 14 }}>
            INYX never follows or unfollows for you. Use the profile links to review accounts yourself.
          </p>
        )}

        {/* Remount per list so search, filters and the open row reset when the tab changes. */}
        <AccountTable
          key={active.kind}
          accounts={accounts}
          relationOf={username => relations.get(username) ?? null}
          showStatus={active.kind === 'followers' || active.kind === 'following'}
          csvName={active.kind}
          pageSize={settings.rowsPerPage}
          reference={new Date(session.analyzedAt)}
          dateHeader={active.dateHeader}
          emptyMessage={`No accounts in this list for this export.`}
        />
      </section>
    </>
  )
}

export default ListsPage
