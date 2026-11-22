import { ArrowLeftRight, Percent, Repeat, Star, UserCheck, UserMinus, UserPlus, Users } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router'

import { CompletenessNotice, MarksNotice, NoDataState, PageHead, SessionContext } from '@/app/common'
import DotBar from '@/components/dots/DotBar'
import DotColumns, { type DotColumn } from '@/components/dots/DotColumns'
import DotGrid from '@/components/dots/DotGrid'
import { useAppData } from '@/data/context'
import { monthlyActivity, timestampCoverage } from '@/lib/analytics/activity'
import { buildInsights } from '@/lib/analytics/insights'
import type { RelationshipAnalytics } from '@/lib/analytics/relationships'
import { formatCount, formatPercent, formatRatio } from '@/lib/format'
import { effectiveCounts, type Snapshot } from '@/lib/storage/snapshots'

import ReconcilePanel from './ReconcilePanel'
import StatCard from './StatCard'

// The landing page's heat ramp, one colour per kind of account.
const COLOR = {
  followers: '#a98ae6',
  following: '#8593ea',
  mutuals: '#f6d08a',
  notFollowingBack: '#f5a07a',
  fans: '#e88bb3'
}

const Metrics = ({ a }: { a: RelationshipAnalytics }) => {
  const share = (part: number, whole: number) => (whole === 0 ? 0 : part / whole)
  const ratioShare = a.followersCount + a.followingCount === 0 ? 0 : a.followersCount / (a.followersCount + a.followingCount)

  return (
    <div className='ix-grid'>
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
              { value: a.notFollowingBackCount, color: COLOR.notFollowingBack, label: 'Do not' }
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
        chart={<DotGrid fraction={share(a.mutualCount, a.uniqueAccountsCount)} color={COLOR.mutuals} label={`${formatPercent(a.mutualityRate)} of all accounts are mutual`} />}
        note={<>of {formatCount(a.uniqueAccountsCount)} unique accounts</>}
      />

      <StatCard
        title='Not following back'
        subtitle='You follow, they do not'
        icon={UserMinus}
        color={COLOR.notFollowingBack}
        value={formatCount(a.notFollowingBackCount)}
        valueLabel={`${formatCount(a.notFollowingBackCount)} accounts not following back`}
        to='/app/lists/not-following-back'
        chart={<DotGrid fraction={share(a.notFollowingBackCount, a.followingCount)} color={COLOR.notFollowingBack} label={`${formatPercent(share(a.notFollowingBackCount, a.followingCount) * 100)} of the accounts you follow`} />}
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
        chart={<DotGrid fraction={share(a.fansCount, a.followersCount)} color={COLOR.fans} label={`${formatPercent(share(a.fansCount, a.followersCount) * 100)} of your followers`} />}
        note={<>of your {formatCount(a.followersCount)} followers</>}
      />

      <StatCard
        title='Follow-back rate'
        subtitle='Mutuals ÷ accounts you follow'
        icon={Percent}
        color={COLOR.mutuals}
        value={formatPercent(a.followBackRate)}
        valueLabel={`Follow-back rate ${formatPercent(a.followBackRate)}`}
        chart={<DotBar segments={20} total={100} label={`Follow-back rate ${formatPercent(a.followBackRate)}`} parts={[{ value: a.followBackRate ?? 0, color: COLOR.mutuals, label: 'Follow back' }]} />}
        note={a.followBackRate === null ? 'You follow no one yet' : <>higher means more of your follows are returned</>}
      />

      <StatCard
        title='Mutuality rate'
        subtitle='Mutuals ÷ all unique accounts'
        icon={Repeat}
        color={COLOR.followers}
        value={formatPercent(a.mutualityRate)}
        valueLabel={`Mutuality rate ${formatPercent(a.mutualityRate)}`}
        chart={<DotBar segments={20} total={100} label={`Mutuality rate ${formatPercent(a.mutualityRate)}`} parts={[{ value: a.mutualityRate ?? 0, color: COLOR.followers, label: 'Mutual' }]} />}
        note={<>across {formatCount(a.uniqueAccountsCount)} accounts</>}
      />

      <StatCard
        title='Follower ratio'
        subtitle='Followers ÷ following'
        icon={ArrowLeftRight}
        color={COLOR.following}
        value={formatRatio(a.followerToFollowingRatio)}
        valueLabel={`Follower to following ratio ${formatRatio(a.followerToFollowingRatio)}`}
        chart={
          <DotBar
            segments={20}
            total={1}
            label={`${formatCount(a.followersCount)} followers against ${formatCount(a.followingCount)} following`}
            parts={[
              { value: ratioShare, color: COLOR.followers, label: 'Followers' },
              { value: 1 - ratioShare, color: COLOR.following, label: 'Following' }
            ]}
          />
        }
        note={
          <>
            <b>{formatCount(a.followersCount)}</b> followers · <b>{formatCount(a.followingCount)}</b> following
          </>
        }
      />
    </div>
  )
}

type Which = 'followers' | 'following'

const ActivityCard = ({ analysis }: { analysis: RelationshipAnalytics }) => {
  const [which, setWhich] = useState<Which>('followers')
  const accounts = which === 'followers' ? analysis.followers : analysis.following
  const buckets = useMemo(() => monthlyActivity(accounts, 12), [accounts])
  const coverage = timestampCoverage(accounts)
  const noun = which === 'followers' ? 'new follower' : 'account followed'

  const columns: DotColumn[] | null = buckets
    ? buckets.map(b => ({
        key: b.key,
        label: b.label.slice(0, 3),
        value: b.count,
        tooltip: `${b.label}: ${formatCount(b.count)} ${noun}${b.count === 1 ? '' : 's'}`
      }))
    : null

  return (
    <section className='ix-card ix-span-2' aria-labelledby='activity-title'>
      <div className='ix-card-head'>
        <div>
          <h2 id='activity-title' className='ix-card-title'>
            Follow activity
          </h2>
          <p className='ix-card-sub'>Per month, from the dates in your export</p>
        </div>
        <div className='ix-seg' role='group' aria-label='Choose the list'>
          <button type='button' aria-pressed={which === 'followers'} onClick={() => setWhich('followers')}>
            Followers
          </button>
          <button type='button' aria-pressed={which === 'following'} onClick={() => setWhich('following')}>
            Following
          </button>
        </div>
      </div>

      {columns ? (
        <>
          <DotColumns
            columns={columns}
            color={which === 'followers' ? COLOR.followers : COLOR.following}
            peakColor={COLOR.mutuals}
            rows={9}
            label={`Accounts per month, last 12 months of ${which}`}
          />
          <p className='ix-card-note'>
            Last 12 months of data
            {coverage < 1 && <> · <b>{formatPercent(coverage * 100)}</b> of accounts carry a date</>}
          </p>
        </>
      ) : (
        <p className='ix-note' style={{ marginTop: 18 }}>
          This export has no follow dates for {which}, so no activity is shown.
        </p>
      )}
    </section>
  )
}

const InsightsCard = ({ analysis }: { analysis: RelationshipAnalytics }) => {
  const insights = buildInsights(analysis)

  return (
    <section className='ix-card ix-span-2' aria-labelledby='insights-title'>
      <div className='ix-card-head'>
        <div>
          <h2 id='insights-title' className='ix-card-title'>
            Insights
          </h2>
          <p className='ix-card-sub'>Plain readings of the numbers above</p>
        </div>
      </div>

      {insights.length > 0 ? (
        <ul className='ix-insights' style={{ marginTop: 14 }}>
          {insights.map(insight => (
            <li key={insight.id}>{insight.text}</li>
          ))}
        </ul>
      ) : (
        <p className='ix-note' style={{ marginTop: 18 }}>
          There is not enough data for insights yet.
        </p>
      )}
    </section>
  )
}

const TrendCard = ({ snapshots }: { snapshots: Snapshot[] }) => {
  const [which, setWhich] = useState<Which>('followers')
  const recent = snapshots.slice(-12)
  const counts = recent.map(s => effectiveCounts(s)[which])
  const min = Math.min(...counts)
  const max = Math.max(...counts)
  const pad = Math.max(1, Math.round((max - min) * 0.25) || Math.round(max * 0.1))

  const columns: DotColumn[] = recent.map(s => {
    const date = new Date(s.analyzedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

    const count = effectiveCounts(s)[which]

    return {
      key: s.id,
      label: date,
      value: count,
      tooltip: `${date}: ${formatCount(count)} ${which}${s.label ? ` (${s.label})` : ''}`
    }
  })

  return (
    <section className='ix-card ix-span-4' aria-labelledby='trend-title'>
      <div className='ix-card-head'>
        <div>
          <h2 id='trend-title' className='ix-card-title'>
            Across your saved snapshots
          </h2>
          <p className='ix-card-sub'>
            Counts at each analysis, not the exact day anything changed. <Link to='/app/history' style={{ textDecoration: 'underline' }}>Compare snapshots</Link>
          </p>
        </div>
        <div className='ix-seg' role='group' aria-label='Choose the count'>
          <button type='button' aria-pressed={which === 'followers'} onClick={() => setWhich('followers')}>
            Followers
          </button>
          <button type='button' aria-pressed={which === 'following'} onClick={() => setWhich('following')}>
            Following
          </button>
        </div>
      </div>
      <DotColumns
        columns={columns}
        color={which === 'followers' ? COLOR.followers : COLOR.following}
        peakColor={COLOR.mutuals}
        rows={8}
        domain={[Math.max(0, min - pad), max]}
        label={`${which} count at each saved snapshot`}
      />
    </section>
  )
}

const DashboardPage = () => {
  const { session, snapshots, storeAvailable, saveCurrent } = useAppData()
  const location = useLocation()
  const [saveNote, setSaveNote] = useState<string | null>((location.state as { notice?: string | null } | null)?.notice ?? null)

  if (!session) return (
    <>
      <PageHead label='Overview' title={<>Your <span className='ix-px'>network</span></>} />
      <NoDataState />
    </>
  )

  const { analysis } = session
  const canSave = session.origin === 'import' && session.snapshotId === null && storeAvailable

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
    <>
      <PageHead
        label='Overview'
        title={
          <>
            Your <span className='ix-px'>network</span>
          </>
        }
        sub='Every figure is a plain set comparison of your followers and following lists. Nothing here is estimated.'
        actions={
          <>
            {canSave && (
              <button type='button' className='ix-btn' onClick={handleSave}>
                Save snapshot
              </button>
            )}
            <Link to='/app/import' className='ix-btn ix-btn-dark'>
              Import new export
            </Link>
          </>
        }
      />

      <div className='ix-banner' style={{ background: 'transparent', padding: 0 }}>
        <div className='flex flex-wrap items-center gap-2'>
          <SessionContext session={session} />
        </div>
      </div>

      {saveNote && (
        <p className='ix-note' role='status' style={{ marginBottom: 12 }}>
          {saveNote}
        </p>
      )}

      <CompletenessNotice session={session} />
      <MarksNotice session={session} />

      {session.origin === 'sample' && (
        <div className='ix-banner' role='note'>
          <span>This is synthetic sample data for previewing the app. It is not your account and cannot be saved.</span>
          <Link to='/app/import' className='ix-btn ix-btn-sm ix-btn-dark'>
            Import your own export
          </Link>
        </div>
      )}

      <Metrics a={analysis} />

      <div className='ix-grid' style={{ marginTop: 12 }}>
        <ActivityCard analysis={analysis} />
        <InsightsCard analysis={analysis} />
        {session.origin !== 'sample' && <ReconcilePanel session={session} />}
        {snapshots.length >= 2 && <TrendCard snapshots={snapshots} />}
      </div>
    </>
  )
}

export default DashboardPage
