import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'

import { PageHead } from '@/app/common'
import DotText from '@/components/dots/DotText'
import { useAppData } from '@/data/context'
import { compareSnapshots, type ComparisonKind } from '@/lib/analytics/compare'
import { formatCount, formatDateTime } from '@/lib/format'
import type { Account } from '@/lib/instagram/types'
import { fromStored, type Snapshot } from '@/lib/storage/snapshots'

import AccountTable from '../lists/AccountTable'

type Source = {
  id: string
  title: string
  analyzedAt: string
  followers: Account[]
  following: Account[]
}

const CURRENT_ID = 'current'

const KINDS: { kind: ComparisonKind; title: string; subtitle: string; color: string; csv: string }[] = [
  { kind: 'gainedFollowers', title: 'Gained followers', subtitle: 'In the newer export only', color: '#f6d08a', csv: 'gained-followers' },
  { kind: 'lostFollowers', title: 'Lost followers', subtitle: 'In the older export only', color: '#f5a07a', csv: 'lost-followers' },
  { kind: 'newFollowing', title: 'New follows', subtitle: 'You follow now, not before', color: '#8593ea', csv: 'new-following' },
  { kind: 'unfollowed', title: 'Unfollowed', subtitle: 'You followed before, not now', color: '#e88bb3', csv: 'unfollowed' }
]

const snapshotTitle = (s: Snapshot) => `${s.label || 'Snapshot'} · ${formatDateTime(s.analyzedAt)}`

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : formatCount(n))

const HistoryPage = () => {
  const navigate = useNavigate()
  const { session, snapshots, storeAvailable, settings, saveCurrent, loadSnapshot, deleteSnapshot } = useAppData()
  const [fromChoice, setFromChoice] = useState<string | null>(null)
  const [toChoice, setToChoice] = useState<string | null>(null)
  const [kind, setKind] = useState<ComparisonKind>('gainedFollowers')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)

  const unsavedCurrent = session && session.origin === 'import' && session.snapshotId === null ? session : null

  const sources = useMemo<Source[]>(() => {
    const list: Source[] = snapshots.map(s => ({
      id: s.id,
      title: snapshotTitle(s),
      analyzedAt: s.analyzedAt,
      followers: fromStored(s.followers),
      following: fromStored(s.following)
    }))

    if (unsavedCurrent) {
      list.push({
        id: CURRENT_ID,
        title: `Current import (not saved) · ${formatDateTime(unsavedCurrent.analyzedAt)}`,
        analyzedAt: unsavedCurrent.analyzedAt,
        followers: unsavedCurrent.analysis.followers,
        following: unsavedCurrent.analysis.following
      })
    }

    return list.sort((a, b) => (a.analyzedAt < b.analyzedAt ? -1 : a.analyzedAt > b.analyzedAt ? 1 : 0))
  }, [snapshots, unsavedCurrent])

  const canCompare = sources.length >= 2
  const fromId = fromChoice ?? sources[sources.length - 2]?.id
  const toId = toChoice ?? sources[sources.length - 1]?.id

  const comparison = useMemo(() => {
    const a = sources.find(s => s.id === fromId)
    const b = sources.find(s => s.id === toId)

    if (!a || !b || a.id === b.id) return null

    // Always compare older against newer, whichever way round they were picked.
    const [older, newer] = a.analyzedAt <= b.analyzedAt ? [a, b] : [b, a]

    return { older, newer, result: compareSnapshots(older, newer) }
  }, [sources, fromId, toId])

  const handleSave = async () => {
    const outcome = await saveCurrent()

    setNote(
      outcome.saved
        ? 'Snapshot saved on this device.'
        : outcome.duplicateOf
          ? 'This export is identical to a snapshot you already saved.'
          : 'The snapshot could not be saved.'
    )
  }

  const handleDelete = async (id: string) => {
    if (confirming !== id) {
      setConfirming(id)

      return
    }

    await deleteSnapshot(id)
    setConfirming(null)
    setFromChoice(null)
    setToChoice(null)
  }

  const active = KINDS.find(k => k.kind === kind)!

  return (
    <>
      <PageHead
        label='History'
        title={
          <>
            Compare <span className='ix-px'>exports</span>
          </>
        }
        sub='Snapshots are only kept if you choose to save them, and only on this device. Comparing two exports shows who is new and who is gone between them.'
        actions={
          unsavedCurrent && storeAvailable ? (
            <button type='button' className='ix-btn ix-btn-dark' onClick={handleSave}>
              Save current as snapshot
            </button>
          ) : undefined
        }
      />

      {note && (
        <p className='ix-note' role='status' style={{ marginBottom: 12 }}>
          {note}
        </p>
      )}

      <section className='ix-panel ix-light' aria-labelledby='saved-title' style={{ marginBottom: 12 }}>
        <h2 id='saved-title' className='ix-h2'>
          Saved snapshots
        </h2>

        {snapshots.length === 0 ? (
          <div className='ix-empty ix-light'>
            <p>
              {storeAvailable
                ? 'Nothing saved yet. When you import an export, tick "Save a snapshot on this device" to build a history you can compare. Nothing is ever saved without that.'
                : 'This browser blocks local storage, so snapshots cannot be saved here.'}
            </p>
            <Link to='/app/import' className='ix-btn ix-btn-dark'>
              Import an export
            </Link>
          </div>
        ) : (
          <ul style={{ marginTop: 8 }}>
            {[...snapshots].reverse().map(s => (
              <li key={s.id} className='ix-snapshot'>
                <div>
                  <p style={{ fontWeight: 600 }}>{s.label || 'Snapshot'}</p>
                  <p className='ix-note'>
                    Analysed {formatDateTime(s.analyzedAt)} · {s.source.fileName} · {formatCount(s.counts.followers)} followers ·{' '}
                    {formatCount(s.counts.following)} following
                  </p>
                </div>
                <div className='flex gap-2'>
                  <button
                    type='button'
                    className='ix-btn ix-btn-sm'
                    onClick={() => {
                      loadSnapshot(s.id)
                      navigate('/app/dashboard')
                    }}
                  >
                    Open
                  </button>
                  <button
                    type='button'
                    className={confirming === s.id ? 'ix-btn ix-btn-sm ix-btn-danger' : 'ix-btn ix-btn-sm'}
                    onClick={() => handleDelete(s.id)}
                    onBlur={() => setConfirming(null)}
                  >
                    {confirming === s.id ? 'Confirm delete' : 'Delete'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!canCompare ? (
        <section className='ix-panel ix-light'>
          <EmptyCompare count={sources.length} />
        </section>
      ) : (
        <>
          <section className='ix-panel ix-light' aria-labelledby='compare-title' style={{ marginBottom: 12 }}>
            <h2 id='compare-title' className='ix-h2'>
              Compare two exports
            </h2>
            <div className='ix-toolbar' style={{ marginTop: 12 }}>
              <label>
                <span className='ix-mono ix-muted' style={{ display: 'block', marginBottom: 4 }}>
                  From
                </span>
                <select className='ix-field' value={fromId} onChange={event => setFromChoice(event.target.value)}>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className='ix-mono ix-muted' style={{ display: 'block', marginBottom: 4 }}>
                  To
                </span>
                <select className='ix-field' value={toId} onChange={event => setToChoice(event.target.value)}>
                  {sources.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className='ix-note' style={{ marginTop: 10 }}>
              Dates are when each export was analysed, not when someone actually followed or unfollowed. The comparison only shows what differs
              between the two files.
            </p>
          </section>

          {comparison ? (
            <>
              <div className='ix-grid' role='group' aria-label='Changes between the two exports'>
                {KINDS.map(item => {
                  const count = comparison.result[item.kind].length

                  return (
                    <button
                      key={item.kind}
                      type='button'
                      className='ix-card'
                      aria-pressed={kind === item.kind}
                      onClick={() => setKind(item.kind)}
                      style={{ textAlign: 'left', cursor: 'pointer', boxShadow: kind === item.kind ? `inset 0 0 0 1.5px ${item.color}` : undefined }}
                    >
                      <span className='ix-card-title'>{item.title}</span>
                      <span className='ix-card-sub'>{item.subtitle}</span>
                      <span className='ix-metric'>
                        <DotText text={formatCount(count)} dot={5} color={item.color} label={`${formatCount(count)} ${item.title.toLowerCase()}`} />
                      </span>
                    </button>
                  )
                })}
              </div>

              <p className='ix-note' style={{ margin: '12px 0' }} role='status'>
                Followers {signed(comparison.result.netFollowers)} · Following {signed(comparison.result.netFollowing)} between{' '}
                {formatDateTime(comparison.older.analyzedAt)} and {formatDateTime(comparison.newer.analyzedAt)}.
              </p>

              <section className='ix-card' aria-label={active.title}>
                <AccountTable
                  key={`${comparison.older.id}-${comparison.newer.id}-${kind}`}
                  accounts={comparison.result[kind]}
                  csvName={active.csv}
                  csvRelationship={active.csv.replace('-', ' ')}
                  pageSize={settings.rowsPerPage}
                  reference={new Date(comparison.newer.analyzedAt)}
                  dateHeader={kind === 'gainedFollowers' || kind === 'lostFollowers' ? 'Followed you' : 'You followed'}
                  emptyMessage='No accounts changed in this way between these exports.'
                />
              </section>
            </>
          ) : (
            <p className='ix-note'>Choose two different exports to compare.</p>
          )}
        </>
      )}
    </>
  )
}

const EmptyCompare = ({ count }: { count: number }) => (
  <div className='ix-empty ix-light'>
    <h2 className='ix-h2'>Two exports to compare</h2>
    <p>
      {count === 0
        ? 'Comparisons need at least two exports. Import one now, save a snapshot, and come back after your next export.'
        : 'You have one export so far. Import another later and save both as snapshots to see who is new and who is gone.'}
    </p>
  </div>
)

export default HistoryPage
