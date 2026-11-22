import { useMemo, useState } from 'react'
import { Navigate, NavLink, useParams } from 'react-router'

import { CompletenessNotice, MarksNotice, NoDataState, PageHead, SessionContext } from '@/app/common'
import { useAppData } from '@/data/context'
import { accountsOfKind, type Relationship, type RelationshipKind } from '@/lib/analytics/relationships'
import { REASONS, REASON_LABEL, isReason, unavailableAccounts, type UnavailableReason } from '@/lib/analytics/unavailable'
import { formatCount } from '@/lib/format'

import AccountTable from './AccountTable'

type ListKind = RelationshipKind | 'unavailable'

const KINDS: {
  kind: ListKind
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
  { kind: 'following', label: 'Following', title: 'Following', description: 'Every account you follow.', dateHeader: 'You followed' },
  {
    kind: 'unavailable',
    label: 'Unavailable',
    title: 'Unavailable accounts',
    description:
      'Accounts you marked as no longer available on Instagram, for example deactivated or deleted. They are left out of every figure. Restore any you marked by mistake.',
    dateHeader: 'Followed'
  }
]

const ListsPage = () => {
  const { kind } = useParams()
  const { session, settings, setUnavailable } = useAppData()
  const active = KINDS.find(k => k.kind === kind)
  // Applied to every account ticked or bulk-marked from the lists; empty means "not specified".
  const [reason, setReason] = useState<UnavailableReason | ''>('')

  // How each account relates to you, from the complete lists so marked accounts keep a status too.
  const relations = useMemo(() => {
    const map = new Map<string, Relationship>()

    if (session) {
      const followers = new Set(session.baseFollowers.map(a => a.username))
      const following = new Set(session.baseFollowing.map(a => a.username))

      for (const name of new Set([...followers, ...following])) {
        map.set(name, followers.has(name) && following.has(name) ? 'mutual' : followers.has(name) ? 'fan' : 'not-following-back')
      }
    }

    return map
  }, [session])

  const marked = useMemo(() => new Set(session?.unavailable ?? []), [session])

  if (!active) return <Navigate to='/app/lists/not-following-back' replace />

  if (!session) {
    return (
      <>
        <PageHead label='Lists' title={active.title} />
        <NoDataState />
      </>
    )
  }

  const accountsFor = (listKind: ListKind) =>
    listKind === 'unavailable'
      ? unavailableAccounts(session.baseFollowers, session.baseFollowing, marked)
      : accountsOfKind(session.analysis, listKind)

  const accounts = accountsFor(active.kind)
  const isUnavailableTab = active.kind === 'unavailable'

  return (
    <>
      <PageHead
        label='Lists'
        title={active.title}
        sub={active.description}
        actions={<SessionContext session={session} />}
      />

      <CompletenessNotice session={session} />
      {!isUnavailableTab && <MarksNotice session={session} />}

      <nav aria-label='Lists' className='ix-tabs'>
        {KINDS.filter(item => item.kind !== 'unavailable' || session.unavailable.length > 0 || isUnavailableTab).map(item => (
          <NavLink key={item.kind} to={`/app/lists/${item.kind}`}>
            {item.label}
            <span>{formatCount(accountsFor(item.kind).length)}</span>
          </NavLink>
        ))}
      </nav>

      <section className='ix-card' aria-label={active.title}>
        {active.kind === 'not-following-back' && accounts.length > 0 && (
          <p className='ix-note' style={{ marginBottom: 14 }}>
            INYX never follows or unfollows for you. Use the profile links to review accounts yourself. If a profile
            shows that the page is not available, tick <b>Unavailable</b> to leave it out of your figures.
          </p>
        )}

        {!isUnavailableTab && accounts.length > 0 && (
          <label style={{ display: 'block', marginBottom: 14 }}>
            <span className='ix-mono ix-muted' style={{ display: 'block', marginBottom: 6 }}>
              Reason to record when you mark accounts
            </span>
            <select className='ix-field' value={reason} onChange={event => setReason(isReason(event.target.value) ? event.target.value : '')}>
              <option value=''>Not specified</option>
              {REASONS.map(item => (
                <option key={item} value={item}>
                  {REASON_LABEL[item]}
                </option>
              ))}
            </select>
          </label>
        )}

        {/* Remount per list so search, filters and the open row reset when the tab changes. */}
        <AccountTable
          key={active.kind}
          accounts={accounts}
          relationOf={username => relations.get(username) ?? null}
          showStatus={active.kind === 'followers' || active.kind === 'following' || isUnavailableTab}
          csvName={active.kind}
          pageSize={settings.rowsPerPage}
          reference={new Date(session.analyzedAt)}
          dateHeader={active.dateHeader}
          emptyMessage={isUnavailableTab ? 'No accounts are marked as unavailable.' : 'No accounts in this list for this export.'}
          csvExtra={isUnavailableTab ? { header: 'reason', value: a => (session.reasons[a.username] ? REASON_LABEL[session.reasons[a.username]] : '') } : undefined}
          pageAction={
            isUnavailableTab
              ? undefined
              : {
                  label: count => `Mark these ${count} as unavailable`,
                  run: visible =>
                    void setUnavailable(
                      visible.map(a => a.username),
                      true,
                      reason || undefined
                    )
                }
          }
          rowAction={
            isUnavailableTab
              ? {
                  header: 'Reason / Restore',
                  render: account => (
                    <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className='ix-field'
                        aria-label={`Reason for ${account.username}`}
                        value={session.reasons[account.username] ?? ''}
                        onChange={event =>
                          void setUnavailable([account.username], true, isReason(event.target.value) ? event.target.value : undefined)
                        }
                      >
                        <option value=''>Not specified</option>
                        {REASONS.map(item => (
                          <option key={item} value={item}>
                            {REASON_LABEL[item]}
                          </option>
                        ))}
                      </select>
                      <button
                        type='button'
                        className='ix-btn ix-btn-sm'
                        aria-label={`Restore ${account.username} to your figures`}
                        onClick={() => void setUnavailable([account.username], false)}
                      >
                        Restore
                      </button>
                    </span>
                  )
                }
              : {
                  header: 'Unavailable',
                  render: account => (
                    <input
                      type='checkbox'
                      className='ix-tick'
                      checked={false}
                      aria-label={`Mark ${account.username} as no longer available on Instagram`}
                      onChange={() => void setUnavailable([account.username], true, reason || undefined)}
                    />
                  )
                }
          }
        />
      </section>
    </>
  )
}

export default ListsPage
