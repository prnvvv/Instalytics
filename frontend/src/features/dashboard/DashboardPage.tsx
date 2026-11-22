import { ArrowLeftRight, Percent, Repeat, Star, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { Link, useLocation } from 'react-router'

import { CompletenessNotice, MarksNotice, NoDataState, PageHead, SessionContext } from '@/app/common'
import DotBar from '@/components/dots/DotBar'
import DotColumns, { type DotColumn } from '@/components/dots/DotColumns'
import DotText from '@/components/dots/DotText'
import Dialog from '@/components/ui/Dialog'
import { useAppData } from '@/data/context'
import { monthlyActivity, timestampCoverage } from '@/lib/analytics/activity'
import { buildInsights } from '@/lib/analytics/insights'
import type { RelationshipAnalytics } from '@/lib/analytics/relationships'
import { formatCount, formatPercent, formatRatio } from '@/lib/format'
import { KIND_COLOR } from '@/lib/palette'
import { effectiveCounts } from '@/lib/storage/snapshots'

import ImportDetails from './ImportDetails'
import ReconcilePanel from './ReconcilePanel'
import StatCard from './StatCard'

const COLOR = KIND_COLOR

const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)

const Kinds = ({ a }: { a: RelationshipAnalytics }) => (
  <div className='ix-kinds'>
    <StatCard
      title='Followers'
      subtitle='People who follow you'
      icon={Users}
      color={COLOR.followers}
      value={formatCount(a.followersCount)}
      valueLabel={`${formatCount(a.followersCount)} followers`}
      to='/app/lists/followers'
      chart={
        <DotBar
          label={`${formatCount(a.mutualCount)} mutual and ${formatCount(a.fansCount)} fans among your followers`}
          parts={[
            { value: a.mutualCount, color: COLOR.mutuals, label: 'Mutuals' },
            { value: a.fansCount, color: COLOR.fans, label: 'Fans' }
          ]}
        />
      }
      note={
        <>
          <b>{formatCount(a.mutualCount)}</b> mutual · <b>{formatCount(a.fansCount)}</b> fans
        </>
      }
    />

    <StatCard
      title='Following'
      subtitle='Accounts you follow'
      icon={UserPlus}
      color={COLOR.following}
      value={formatCount(a.followingCount)}
      valueLabel={`${formatCount(a.followingCount)} following`}
      to='/app/lists/following'
      chart={
        <DotBar
          label={`${formatCount(a.mutualCount)} follow you back and ${formatCount(a.notFollowingBackCount)} do not`}
          parts={[
            { value: a.mutualCount, color: COLOR.mutuals, label: 'Follow back' },
            { value: a.notFollowingBackCount, color: COLOR['not-following-back'], label: 'Do not' }
          ]}
        />
      }
      note={
        <>
          <b>{formatCount(a.mutualCount)}</b> follow back · <b>{formatCount(a.notFollowingBackCount)}</b> do not
        </>
      }
    />

    <StatCard
      title='Mutuals'
      subtitle='You follow each other'
      icon={UserCheck}
      color={COLOR.mutuals}
      value={formatCount(a.mutualCount)}
      valueLabel={`${formatCount(a.mutualCount)} mutual connections`}
      to='/app/lists/mutuals'
      chart={
        <DotBar
          total={a.uniqueAccountsCount}
          label={`${formatPercent(a.mutualityRate)} of all accounts are mutual`}
          parts={[{ value: a.mutualCount, color: COLOR.mutuals, label: 'Mutual' }]}
        />
      }
      note={<>of {formatCount(a.uniqueAccountsCount)} unique accounts</>}
    />

    <StatCard
      title='Not following back'
      subtitle='You follow, they do not'
      icon={UserMinus}
      color={COLOR['not-following-back']}
      value={formatCount(a.notFollowingBackCount)}
      valueLabel={`${formatCount(a.notFollowingBackCount)} accounts not following back`}
      to='/app/lists/not-following-back'
      chart={
        <DotBar
          total={a.followingCount}
          label={`${formatPercent(share(a.notFollowingBackCount, a.followingCount) * 100)} of the accounts you follow`}
          parts={[{ value: a.notFollowingBackCount, color: COLOR['not-following-back'], label: 'Not following back' }]}
        />
      }
      note={<>of the {formatCount(a.followingCount)} you follow</>}
    />

    <StatCard
      title='Fans'
      subtitle='Follow you, you do not follow back'
      icon={Star}
      color={COLOR.fans}
      value={formatCount(a.fansCount)}
      valueLabel={`${formatCount(a.fansCount)} fans`}
      to='/app/lists/fans'
      chart={
        <DotBar
          total={a.followersCount}
          label={`${formatPercent(share(a.fansCount, a.followersCount) * 100)} of your followers`}
          parts={[{ value: a.fansCount, color: COLOR.fans, label: 'Fans' }]}
        />
      }
      note={<>of your {formatCount(a.followersCount)} followers</>}
    />
  </div>
)

type PropsRate = { title: string; subtitle: string; icon: typeof Percent; color: string; value: string; label: string }

const Rate = ({ title, subtitle, icon: Icon, color, value, label }: PropsRate) => (
  <article className='ix-tile ix-rate' style={{ '--tile-c': color } as CSSProperties} aria-label={`${title}: ${label}`}>
    <DotText text={value.toUpperCase()} label={label} dot={3} color={color} />
    <div className='ix-rate-text'>
      <p>{title}</p>
      <p className='ix-tile-sub'>{subtitle}</p>
    </div>
    <Icon aria-hidden size={14} style={{ marginLeft: 'auto', color }} />
  </article>
)

const Rates = ({ a }: { a: RelationshipAnalytics }) => (
  <div className='ix-rates'>
    <Rate
      title='Follow-back rate'
      subtitle='Mutuals ÷ accounts you follow'
      icon={Percent}
      color={COLOR.mutuals}
      value={formatPercent(a.followBackRate)}
      label={`Follow-back rate ${formatPercent(a.followBackRate)}`}
    />
    <Rate
      title='Mutuality rate'
      subtitle='Mutuals ÷ all unique accounts'
      icon={Repeat}
      color={COLOR.followers}
      value={formatPercent(a.mutualityRate)}
      label={`Mutuality rate ${formatPercent(a.mutualityRate)}`}
    />
    <Rate
      title='Follower ratio'
      subtitle='Followers ÷ following'
      icon={ArrowLeftRight}
      color={COLOR.following}
      value={formatRatio(a.followerToFollowingRatio)}
      label={`Follower to following ratio ${formatRatio(a.followerToFollowingRatio)}`}
    />
  </div>
)

type Which = 'followers' | 'following'
type View = 'activity' | 'snapshots'

const ActivityTile = ({ analysis }: { analysis: RelationshipAnalytics }) => {
  const { snapshots } = useAppData()
  const [which, setWhich] = useState<Which>('followers')
  const [view, setView] = useState<View>('activity')
  const hasTrend = snapshots.length >= 2
  const accounts = which === 'followers' ? analysis.followers : analysis.following
  const buckets = useMemo(() => monthlyActivity(accounts, 12), [accounts])
  const coverage = timestampCoverage(accounts)
  const noun = which === 'followers' ? 'new follower' : 'account followed'
  const color = which === 'followers' ? COLOR.followers : COLOR.following

  const columns: DotColumn[] | null = buckets
    ? buckets.map(b => ({
        key: b.key,
        label: b.label.slice(0, 3),
        value: b.count,
        tooltip: `${b.label}: ${formatCount(b.count)} ${noun}${b.count === 1 ? '' : 's'}`
      }))
    : null

  const recent = snapshots.slice(-12)
  const counts = recent.map(s => effectiveCounts(s)[which])
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const pad = Math.max(1, Math.round((max - min) * 0.25) || Math.round(max * 0.1))

  const trend: DotColumn[] = recent.map(s => {
    const date = new Date(s.analyzedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    const count = effectiveCounts(s)[which]

    return { key: s.id, label: date, value: count, tooltip: `${date}: ${formatCount(count)} ${which}${s.label ? ` (${s.label})` : ''}` }
  })

  return (
    <section className='ix-tile' style={{ '--tile-c': color } as CSSProperties} aria-labelledby='activity-title'>
      <div className='ix-tile-head'>
        <div>
          <h2 id='activity-title' className='ix-tile-title'>
            {view === 'activity' ? 'Follow activity' : 'Across your saved snapshots'}
          </h2>
          <p className='ix-tile-sub'>
            {view === 'activity' ? (
              'Per month, from the dates in your export'
            ) : (
              <>
                Counts at each analysis, not the day anything changed. <Link to='/app/history' className='ix-link'>Compare snapshots</Link>
              </>
            )}
          </p>
        </div>
        <div className='flex flex-wrap items-center justify-end gap-2'>
          {hasTrend && (
            <div className='ix-seg' role='group' aria-label='Choose the chart'>
              <button type='button' aria-pressed={view === 'activity'} onClick={() => setView('activity')}>
                Activity
              </button>
              <button type='button' aria-pressed={view === 'snapshots'} onClick={() => setView('snapshots')}>
                Snapshots
              </button>
            </div>
          )}
          <div className='ix-seg' role='group' aria-label='Choose the list'>
            <button type='button' aria-pressed={which === 'followers'} onClick={() => setWhich('followers')}>
              Followers
            </button>
            <button type='button' aria-pressed={which === 'following'} onClick={() => setWhich('following')}>
              Following
            </button>
          </div>
        </div>
      </div>

      <div className='ix-tile-body' style={{ marginTop: 10 }}>
        {view === 'snapshots' && hasTrend ? (
          <DotColumns columns={trend} color={color} peakColor={COLOR.mutuals} fill domain={[Math.max(0, min - pad), max]} label={`${which} count at each saved snapshot`} />
        ) : columns ? (
          <DotColumns columns={columns} color={color} peakColor={COLOR.mutuals} fill label={`Accounts per month, last 12 months of ${which}`} />
        ) : (
          <p className='ix-note'>This export has no follow dates for {which}, so no activity is shown.</p>
        )}
      </div>

      {view === 'activity' && columns && (
        <p className='ix-tile-note'>
          Last 12 months of data
          {coverage < 1 && (
            <>
              {' '}
              · <b>{formatPercent(coverage * 100)}</b> of accounts carry a date
            </>
          )}
        </p>
      )}
    </section>
  )
}

const DEFINITIONS = [
  { name: 'Follow-back rate', text: 'Mutuals ÷ accounts you follow. Higher means more of your follows are returned.' },
  { name: 'Mutuality rate', text: 'Mutuals ÷ all unique accounts (everyone who follows you or whom you follow).' },
  { name: 'Follower ratio', text: 'Followers ÷ following. Above 1 means more people follow you than you follow.' }
]

const InsightsTile = ({ analysis }: { analysis: RelationshipAnalytics }) => {
  const [more, setMore] = useState(false)
  const insights = buildInsights(analysis)

  return (
    <section className='ix-tile' style={{ '--tile-c': COLOR.mutuals } as CSSProperties} aria-labelledby='insights-title'>
      <div className='ix-tile-head'>
        <div>
          <h2 id='insights-title' className='ix-tile-title'>
            Insights
          </h2>
          <p className='ix-tile-sub'>Plain readings of the numbers above</p>
        </div>
        <button type='button' className='ix-btn ix-btn-sm' onClick={() => setMore(true)}>
          Read more
        </button>
      </div>

      {insights.length > 0 ? (
        <ul className='ix-insights ix-tile-body' style={{ marginTop: 6, overflow: 'hidden' }}>
          {insights.slice(0, 3).map(insight => (
            <li key={insight.id}>{insight.text}</li>
          ))}
        </ul>
      ) : (
        <p className='ix-note' style={{ marginTop: 12 }}>
          There is not enough data for insights yet.
        </p>
      )}

      <Dialog open={more} onClose={() => setMore(false)} title='Insights in detail' description='Every reading comes straight from your two lists. Nothing is estimated.'>
        {insights.length > 0 && (
          <ul className='ix-insights'>
            {insights.map(insight => (
              <li key={insight.id}>{insight.text}</li>
            ))}
          </ul>
        )}
        <h3 className='ix-tile-title' style={{ marginTop: 14 }}>
          How the rates are worked out
        </h3>
        <dl className='ix-facts' style={{ marginTop: 6 }}>
          {DEFINITIONS.map(item => (
            <div key={item.name} style={{ display: 'block' }}>
              <dt>{item.name}</dt>
              <dd style={{ textAlign: 'left', fontWeight: 400 }}>{item.text}</dd>
            </div>
          ))}
        </dl>
      </Dialog>
    </section>
  )
}

const DashboardPage = () => {
  const { session, storeAvailable, saveCurrent } = useAppData()
  const location = useLocation()
  const [saveNote, setSaveNote] = useState<string | null>((location.state as { notice?: string | null } | null)?.notice ?? null)
  const [checking, setChecking] = useState(false)
  const [details, setDetails] = useState(false)

  if (!session) {
    return (
      <div className='ix-page'>
        <PageHead
          label='Overview'
          title={
            <>
              Your <span className='ix-px'>network</span>
            </>
          }
        />
        <NoDataState />
      </div>
    )
  }

  const { analysis } = session
  const canSave = session.origin === 'import' && session.snapshotId === null && storeAvailable
  const isSample = session.origin === 'sample'

  const handleSave = async () => {
    const outcome = await saveCurrent()

    setSaveNote(
      outcome.saved
        ? 'Snapshot saved on this device.'
        : outcome.duplicateOf
          ? 'This export is identical to a snapshot you already saved.'
          : 'The snapshot could not be saved.'
    )
  }

  return (
    <div className='ix-page'>
      <PageHead
        label='Overview'
        title={
          <>
            Your <span className='ix-px'>network</span>
          </>
        }
        keepSub
        sub={
          <span className='flex flex-wrap items-center gap-2'>
            <SessionContext session={session} />
            <MarksNotice session={session} />
            {isSample && <span className='ix-note ix-hide-short'>Synthetic sample data for previewing the app. It is not your account and cannot be saved.</span>}
          </span>
        }
        actions={
          <>
            {canSave && (
              <button type='button' className='ix-btn' onClick={handleSave}>
                Save snapshot
              </button>
            )}
            {!isSample && (
              <button type='button' className='ix-btn' onClick={() => setChecking(true)}>
                Check against Instagram
              </button>
            )}
            {!isSample && (
              <button type='button' className='ix-btn' onClick={() => setDetails(true)}>
                Import details
              </button>
            )}
            <Link to='/app/import' className='ix-btn ix-btn-dark'>
              {isSample ? 'Import your own export' : 'Import new export'}
            </Link>
          </>
        }
      />

      {saveNote && (
        <p className='ix-note' role='status'>
          {saveNote}
        </p>
      )}

      <CompletenessNotice session={session} />

      <Kinds a={analysis} />
      <Rates a={analysis} />

      <div className='ix-body ix-body-2'>
        <ActivityTile analysis={analysis} />
        <InsightsTile analysis={analysis} />
      </div>

      {!isSample && (
        <Dialog
          open={checking}
          onClose={() => setChecking(false)}
          title='Check against Instagram'
          description='Compare this export with what your Instagram profile shows.'
        >
          <ReconcilePanel session={session} />
        </Dialog>
      )}

      {!isSample && <ImportDetails open={details} onClose={() => setDetails(false)} session={session} />}
    </div>
  )
}

export default DashboardPage
