import { Undo2 } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { Navigate, NavLink, useParams } from 'react-router'

import { CompletenessNotice, MarksNotice, NoDataState, PageHead } from '@/app/common'
import DotBar from '@/components/dots/DotBar'
import DotColumns, { type DotColumn } from '@/components/dots/DotColumns'
import DotText from '@/components/dots/DotText'
import Dialog from '@/components/ui/Dialog'
import { useAppData, type Session } from '@/data/context'
import { monthlyActivity } from '@/lib/analytics/activity'
import { summarizeKind } from '@/lib/analytics/categories'
import { accountsOfKind, type Relationship, type RelationshipKind } from '@/lib/analytics/relationships'
import { REASONS, REASON_LABEL, isReason, unavailableAccounts, type UnavailableReason } from '@/lib/analytics/unavailable'
import { formatCount, formatDate, formatPercent } from '@/lib/format'
import { KIND_COLOR, PEAK_COLOR } from '@/lib/palette'

import AccountBrowser from './AccountBrowser'

type ListKind = RelationshipKind | 'unavailable'

const KINDS: {
  kind: ListKind
  label: string
  title: string
  description: string
  dateHeader: string
  chartTitle: string
}[] = [
  {
    kind: 'not-following-back',
    label: 'Not following back',
    title: 'Not following back',
    description: 'Accounts you follow that do not follow you back. Review them yourself on Instagram.',
    dateHeader: 'You followed',
    chartTitle: 'Accounts you followed'
  },
  {
    kind: 'fans',
    label: 'Fans',
    title: 'Fans',
    description: 'Followers you do not follow back.',
    dateHeader: 'Followed you',
    chartTitle: 'New fans'
  },
  {
    kind: 'mutuals',
    label: 'Mutuals',
    title: 'Mutual connections',
    description: 'Accounts you follow that also follow you.',
    dateHeader: 'Followed you',
    chartTitle: 'New mutuals'
  },
  {
    kind: 'followers',
    label: 'Followers',
    title: 'Followers',
    description: 'Everyone who follows you.',
    dateHeader: 'Followed you',
    chartTitle: 'New followers'
  },
  {
    kind: 'following',
    label: 'Following',
    title: 'Following',
    description: 'Every account you follow.',
    dateHeader: 'You followed',
    chartTitle: 'Accounts you followed'
  },
  {
    kind: 'unavailable',
    label: 'Unavailable',
    title: 'Unavailable accounts',
    description: 'Accounts you marked as no longer available on Instagram. They are left out of every figure.',
    dateHeader: 'Followed',
    chartTitle: ''
  }
]

type Mode = 'months' | 'years'

type PropsRail = {
  config: (typeof KINDS)[number]
  session: Session
  accounts: ReturnType<typeof accountsOfKind>
}

/** The left side of a category page: the headline number, how it splits, a chart and a few readings. */
const KindRail = ({ config, session, accounts }: PropsRail) => {
  const [mode, setMode] = useState<Mode>('months')
  const [more, setMore] = useState(false)
  const color = KIND_COLOR[config.kind]
  const kind = config.kind as RelationshipKind
  const referenceSeconds = Math.floor(new Date(session.analyzedAt).getTime() / 1000)
  const summary = useMemo(
    () => summarizeKind(kind, session.analysis, accounts, referenceSeconds),
    [kind, session.analysis, accounts, referenceSeconds]
  )
  const { stats, composition } = summary
  const noun = config.chartTitle.toLowerCase()

  const columns = useMemo<DotColumn[] | null>(() => {
    if (mode === 'years') {
      return stats.byYear.length === 0
        ? null
        : stats.byYear.map(item => ({
            key: String(item.year),
            label: String(item.year),
            value: item.count,
            tooltip: `${item.year}: ${formatCount(item.count)} ${noun}`
          }))
    }

    const buckets = monthlyActivity(accounts, 12)

    return buckets
      ? buckets.map(b => ({ key: b.key, label: b.label.slice(0, 3), value: b.count, tooltip: `${b.label}: ${formatCount(b.count)} ${noun}` }))
      : null
  }, [mode, stats, accounts, noun])

  return (
    <aside className='ix-rail' aria-label={`${config.title} statistics`}>
      <section className='ix-tile' style={{ '--tile-c': color } as CSSProperties}>
        <p className='ix-label'>{config.label}</p>
        <div className='ix-metric' style={{ marginTop: 10 }}>
          <DotText text={formatCount(accounts.length)} dot={6} color={color} label={`${formatCount(accounts.length)} ${config.label.toLowerCase()}`} />
        </div>
        <div style={{ marginTop: 14 }}>
          <DotBar
            parts={composition.parts}
            total={composition.total}
            segments={28}
            label={composition.caption}
          />
          <p className='ix-tile-note'>{composition.caption}</p>
        </div>
      </section>

      <section className='ix-tile ix-rail-grow' style={{ '--tile-c': color } as CSSProperties} aria-label={`${config.chartTitle} over time`}>
        <div className='ix-tile-head'>
          <div>
            <h2 className='ix-tile-title'>{config.chartTitle}</h2>
            <p className='ix-tile-sub'>From the dates in your export</p>
          </div>
          <div className='ix-seg' role='group' aria-label='Choose the time scale'>
            <button type='button' aria-pressed={mode === 'months'} onClick={() => setMode('months')}>
              Months
            </button>
            <button type='button' aria-pressed={mode === 'years'} onClick={() => setMode('years')}>
              Years
            </button>
          </div>
        </div>
        <div className='ix-tile-body' style={{ marginTop: 10 }}>
          {columns ? (
            <DotColumns columns={columns} color={color} peakColor={PEAK_COLOR} fill label={`${config.chartTitle} by ${mode === 'months' ? 'month' : 'year'}`} />
          ) : (
            <p className='ix-note'>This export has no dates for these accounts, so there is nothing to chart.</p>
          )}
        </div>
      </section>

      <section className='ix-tile' style={{ '--tile-c': color } as CSSProperties} aria-label='Insights'>
        <div className='ix-tile-head'>
          <h2 className='ix-tile-title'>Insights</h2>
          <button type='button' className='ix-btn ix-btn-sm' onClick={() => setMore(true)}>
            Read more
          </button>
        </div>
        <ul className='ix-insights' style={{ marginTop: 6 }}>
          {summary.insights.slice(0, 2).map(insight => (
            <li key={insight.id}>{insight.text}</li>
          ))}
        </ul>
      </section>

      <Dialog open={more} onClose={() => setMore(false)} title={`${config.title}: in detail`} description='Every reading below comes straight from your export.'>
        <ul className='ix-insights'>
          {summary.insights.map(insight => (
            <li key={insight.id}>{insight.text}</li>
          ))}
        </ul>
        <dl className='ix-facts' style={{ marginTop: 12 }}>
          <div>
            <dt>Accounts</dt>
            <dd>{formatCount(stats.count)}</dd>
          </div>
          <div>
            <dt>With a date in the export</dt>
            <dd>{stats.count === 0 ? 'n/a' : formatPercent((stats.withDates * 100) / stats.count)}</dd>
          </div>
          <div>
            <dt>Newest</dt>
            <dd>{formatDate(stats.newest)}</dd>
          </div>
          <div>
            <dt>Oldest</dt>
            <dd>{formatDate(stats.oldest)}</dd>
          </div>
          <div>
            <dt>In the last 30 days</dt>
            <dd>{formatCount(stats.last30)}</dd>
          </div>
          <div>
            <dt>In the last year</dt>
            <dd>{formatCount(stats.last365)}</dd>
          </div>
          <div>
            <dt>Older than a year</dt>
            <dd>{formatCount(stats.olderThanYear)}</dd>
          </div>
        </dl>
      </Dialog>
    </aside>
  )
}

/** The left side of the Unavailable page: how many accounts are set aside, and why. */
const UnavailableRail = ({ session }: { session: Session }) => {
  const counts = REASONS.map(reason => ({ reason, count: Object.values(session.reasons).filter(r => r === reason).length }))
  const unspecified = session.unavailable.length - counts.reduce((sum, item) => sum + item.count, 0)
  const where =
    session.snapshotId !== null
      ? 'Your marks are saved with this snapshot, in this browser only.'
      : session.origin === 'sample'
        ? 'This is sample data, so nothing is saved.'
        : 'Marks are kept only while this tab is open; save a snapshot to keep them.'

  return (
    <aside className='ix-rail' aria-label='Unavailable accounts statistics'>
      <section className='ix-tile' style={{ '--tile-c': KIND_COLOR.unavailable } as CSSProperties}>
        <p className='ix-label'>Set aside</p>
        <div className='ix-metric' style={{ marginTop: 10 }}>
          <DotText text={formatCount(session.unavailable.length)} dot={6} color={KIND_COLOR.unavailable} label={`${formatCount(session.unavailable.length)} unavailable accounts`} />
        </div>
        <p className='ix-tile-note' style={{ marginTop: 14 }}>
          left out of every figure
        </p>
      </section>

      <section className='ix-tile ix-rail-grow' style={{ '--tile-c': KIND_COLOR.unavailable } as CSSProperties}>
        <h2 className='ix-tile-title'>Why you set them aside</h2>
        <p className='ix-tile-sub'>The label is yours. INYX cannot tell these apart from your export.</p>
        <dl className='ix-facts' style={{ marginTop: 10 }}>
          {counts.map(item => (
            <div key={item.reason}>
              <dt>{REASON_LABEL[item.reason]}</dt>
              <dd>{formatCount(item.count)}</dd>
            </div>
          ))}
          <div>
            <dt>Not specified</dt>
            <dd>{formatCount(unspecified)}</dd>
          </div>
        </dl>
        <p className='ix-note' style={{ marginTop: 'auto', paddingTop: 10 }}>
          {where}
        </p>
      </section>
    </aside>
  )
}

const ListsPage = () => {
  const { kind } = useParams()
  const { session, settings, setUnavailable } = useAppData()
  const active = KINDS.find(k => k.kind === kind)
  // Applied to every account marked from the lists; empty means "not specified".
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

  // When each account started following you, and when you started following it, from the complete lists.
  const since = useMemo(() => {
    const followers = new Map<string, number | null>()
    const following = new Map<string, number | null>()

    for (const a of session?.baseFollowers ?? []) followers.set(a.username, a.followedAt)
    for (const a of session?.baseFollowing ?? []) following.set(a.username, a.followedAt)

    return { followers, following }
  }, [session])

  if (!active) return <Navigate to='/app/lists/not-following-back' replace />

  if (!session) {
    return (
      <div className='ix-page'>
        <PageHead label='Lists' title={active.title} />
        <NoDataState />
      </div>
    )
  }

  const accountsFor = (listKind: ListKind) =>
    listKind === 'unavailable'
      ? unavailableAccounts(session.baseFollowers, session.baseFollowing, marked)
      : accountsOfKind(session.analysis, listKind)

  const accounts = accountsFor(active.kind)
  const isUnavailableTab = active.kind === 'unavailable'
  const reasonSelect = (value: UnavailableReason | '', onChange: (next: UnavailableReason | '') => void, label: string) => (
    <label>
      <span className='sr-only'>{label}</span>
      <select className='ix-field' aria-label={label} value={value} onChange={event => onChange(isReason(event.target.value) ? event.target.value : '')}>
        <option value=''>Not specified</option>
        {REASONS.map(item => (
          <option key={item} value={item}>
            {REASON_LABEL[item]}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className='ix-page'>
      <PageHead label='Lists' title={active.title} sub={active.description} actions={<MarksNotice session={session} />} />

      <CompletenessNotice session={session} />

      <nav aria-label='Lists' className='ix-tabs'>
        {KINDS.filter(item => item.kind !== 'unavailable' || session.unavailable.length > 0 || isUnavailableTab).map(item => (
          <NavLink key={item.kind} to={`/app/lists/${item.kind}`}>
            {item.label}
            <span>{formatCount(accountsFor(item.kind).length)}</span>
          </NavLink>
        ))}
      </nav>

      <div className='ix-body ix-body-rail'>
        {isUnavailableTab ? (
          <UnavailableRail session={session} />
        ) : (
          // Remounted per list so the chart scale and the open dialog reset when the tab changes.
          <KindRail key={active.kind} config={active} session={session} accounts={accounts} />
        )}

        <section className='ix-tile' style={{ '--tile-c': KIND_COLOR[active.kind] } as CSSProperties} aria-label={active.title}>
          {active.kind === 'not-following-back' && accounts.length > 0 && (
            <p className='ix-note' style={{ marginBottom: 10 }}>
              INYX never follows or unfollows for you. Open profiles to review accounts yourself. If a profile shows that the page is not available, tick it
              to leave it out of your figures.
            </p>
          )}

          <AccountBrowser
            key={active.kind}
            accounts={accounts}
            relationOf={username => relations.get(username) ?? null}
            csvName={active.kind}
            fallbackPageSize={settings.rowsPerPage}
            reference={new Date(session.analyzedAt)}
            dateHeader={active.dateHeader}
            emptyMessage={isUnavailableTab ? 'No accounts are marked as unavailable.' : 'No accounts in this list for this export.'}
            detailsOf={account => {
              const theyFollow = since.followers.has(account.username)
              const youFollow = since.following.has(account.username)
              const day = (t: number | null | undefined) => (t ? formatDate(t) : 'date not in export')
              const why = session.reasons[account.username]

              return [
                { label: 'You follow them', value: youFollow ? `Yes, since ${day(since.following.get(account.username))}` : 'No' },
                { label: 'They follow you', value: theyFollow ? `Yes, since ${day(since.followers.get(account.username))}` : 'No' },
                ...(marked.has(account.username) ? [{ label: 'Marked unavailable', value: why ? REASON_LABEL[why] : 'Yes, no reason given' }] : [])
              ]
            }}
            csvExtra={
              isUnavailableTab ? { header: 'reason', value: a => (session.reasons[a.username] ? REASON_LABEL[session.reasons[a.username]] : '') } : undefined
            }
            cardControl={account =>
              isUnavailableTab ? (
                <button
                  type='button'
                  className='ix-btn ix-btn-icon'
                  aria-label={`Restore ${account.username} to your figures`}
                  title='Restore to your figures'
                  onClick={() => void setUnavailable([account.username], false)}
                >
                  <Undo2 aria-hidden size={14} />
                </button>
              ) : (
                <input
                  type='checkbox'
                  className='ix-tick'
                  checked={false}
                  aria-label={`Mark ${account.username} as no longer available on Instagram`}
                  onChange={() => void setUnavailable([account.username], true, reason || undefined)}
                />
              )
            }
            dialogControls={account =>
              isUnavailableTab ? (
                <div className='flex flex-wrap items-center gap-2'>
                  {reasonSelect(session.reasons[account.username] ?? '', next => void setUnavailable([account.username], true, next || undefined), `Reason for ${account.username}`)}
                  <button type='button' className='ix-btn' onClick={() => void setUnavailable([account.username], false)}>
                    Restore to my figures
                  </button>
                </div>
              ) : (
                <div className='flex flex-wrap items-center gap-2'>
                  {reasonSelect(reason, setReason, 'Reason to record when you mark accounts')}
                  <button type='button' className='ix-btn' onClick={() => void setUnavailable([account.username], true, reason || undefined)}>
                    Mark as unavailable
                  </button>
                </div>
              )
            }
            footerControls={visible =>
              isUnavailableTab ? null : (
                <>
                  {reasonSelect(reason, setReason, 'Reason to record when you mark accounts')}
                  <button
                    type='button'
                    className='ix-btn ix-btn-sm'
                    disabled={visible.length === 0}
                    onClick={() =>
                      void setUnavailable(
                        visible.map(a => a.username),
                        true,
                        reason || undefined
                      )
                    }
                  >
                    {`Mark these ${visible.length} as unavailable`}
                  </button>
                </>
              )
            }
          />
        </section>
      </div>
    </div>
  )
}

export default ListsPage
