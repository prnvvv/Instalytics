import { useMemo, useState, type CSSProperties } from 'react'
import { Link, useNavigate } from 'react-router'

import { PageHead } from '@/app/common'
import DotText from '@/components/dots/DotText'
import Dialog from '@/components/ui/Dialog'
import { useAppData } from '@/data/context'
import { compareSnapshots, type ComparisonKind } from '@/lib/analytics/compare'
import { excludeUnavailable } from '@/lib/analytics/unavailable'
import { formatCount, formatDateTime } from '@/lib/format'
import type { Account } from '@/lib/instagram/types'
import { effectiveCounts, fromStored, type Snapshot } from '@/lib/storage/snapshots'

import AccountBrowser from '../lists/AccountBrowser'

type Source = {
  id: string
  title: string
  analyzedAt: string
  followers: Account[]
  following: Account[]
}

const CURRENT_ID = 'current'
const SHOWN_SNAPSHOTS = 3

const KINDS: { kind: ComparisonKind; title: string; subtitle: string; color: string; csv: string }[] = [
  { kind: 'gainedFollowers', title: 'Gained followers', subtitle: 'In the newer export only', color: '#f6d08a', csv: 'gained-followers' },
  { kind: 'lostFollowers', title: 'Lost followers', subtitle: 'In the older export only', color: '#f5a07a', csv: 'lost-followers' },
  { kind: 'newFollowing', title: 'New follows', subtitle: 'You follow now, not before', color: '#8593ea', csv: 'new-following' },
  { kind: 'unfollowed', title: 'Unfollowed', subtitle: 'You followed before, not now', color: '#e88bb3', csv: 'unfollowed' }
]

const snapshotTitle = (s: Snapshot) => `${s.label || 'Snapshot'} · ${formatDateTime(s.analyzedAt)}`

const signed = (n: number) => (n > 0 ? `+${formatCount(n)}` : formatCount(n))

type PropsSnapshotRows = {
  items: Snapshot[]
  confirming: string | null
  onOpen: (id: string) => void
  onDelete: (id: string) => void
  onBlur: () => void
}

const SnapshotRows = ({ items, confirming, onOpen, onDelete, onBlur }: PropsSnapshotRows) => (
  <ul>
    {items.map(s => (
      <li key={s.id} className='ix-snapshot'>
        <div style={{ minWidth: 0 }}>
          <p style={{ fontWeight: 600 }}>{s.label || 'Snapshot'}</p>
          <p className='ix-note'>
            Analysed {formatDateTime(s.analyzedAt)} · {s.source.fileName} · {formatCount(effectiveCounts(s).followers)} followers ·{' '}
            {formatCount(effectiveCounts(s).following)} following
          </p>
        </div>
        <div className='flex gap-2'>
          <button type='button' className='ix-btn ix-btn-sm' onClick={() => onOpen(s.id)}>
            Open
          </button>
          <button
            type='button'
            className={confirming === s.id ? 'ix-btn ix-btn-sm ix-btn-danger' : 'ix-btn ix-btn-sm'}
            onClick={() => onDelete(s.id)}
            onBlur={onBlur}
          >
            {confirming === s.id ? 'Confirm delete' : 'Delete'}
          </button>
        </div>
      </li>
    ))}
  </ul>
)

const HistoryPage = () => {
  const navigate = useNavigate()
  const { session, snapshots, storeAvailable, settings, saveCurrent, loadSnapshot, deleteSnapshot } = useAppData()
  const [fromChoice, setFromChoice] = useState<string | null>(null)
  const [toChoice, setToChoice] = useState<string | null>(null)
  const [kind, setKind] = useState<ComparisonKind>('gainedFollowers')
  const [confirming, setConfirming] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [all, setAll] = useState(false)

  const unsavedCurrent = session && session.origin === 'import' && session.snapshotId === null ? session : null

  const sources = useMemo<Source[]>(() => {
    const list: Source[] = snapshots.map(s => ({
      id: s.id,
      title: snapshotTitle(s),
      analyzedAt: s.analyzedAt,
      // Comparisons use each snapshot as the user saw it, with accounts they marked unavailable left out.
      followers: excludeUnavailable(fromStored(s.followers), new Set(s.unavailable ?? [])),
      following: excludeUnavailable(fromStored(s.following), new Set(s.unavailable ?? []))
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

  const handleOpen = (id: string) => {
    loadSnapshot(id)
    navigate('/app/dashboard')
  }

  const active = KINDS.find(k => k.kind === kind)!
  const newestFirst = [...snapshots].reverse()

  return (
    <div className='ix-page'>
      <PageHead
        label='History'
        title={
          <>
            Compare <span className='ix-px'>exports</span>
          </>
        }
        sub='Snapshots are only kept if you choose to save them, and only on this device.'
        actions={
          unsavedCurrent && storeAvailable ? (
            <button type='button' className='ix-btn ix-btn-dark' onClick={handleSave}>
              Save current as snapshot
            </button>
          ) : undefined
        }
      />

      {note && (
        <p className='ix-note' role='status'>
          {note}
        </p>
      )}

      <div className='ix-body ix-body-rail'>
        <aside className='ix-rail'>
          <section className='ix-tile ix-rail-grow' style={{ '--tile-c': '#a98ae6' } as CSSProperties} aria-labelledby='saved-title'>
            <div className='ix-tile-head'>
              <h2 id='saved-title' className='ix-tile-title'>
                Saved snapshots
              </h2>
              {snapshots.length > SHOWN_SNAPSHOTS && (
                <button type='button' className='ix-btn ix-btn-sm' onClick={() => setAll(true)}>
                  View all ({snapshots.length})
                </button>
              )}
            </div>

            {snapshots.length === 0 ? (
              <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                <p className='ix-note'>
                  {storeAvailable
                    ? 'Nothing saved yet. When you import an export, tick "Also save a snapshot on this device" to build a history you can compare. Nothing is ever saved without that.'
                    : 'This browser blocks local storage, so snapshots cannot be saved here.'}
                </p>
                <Link to='/app/import' className='ix-btn ix-btn-dark' style={{ justifySelf: 'start' }}>
                  Import an export
                </Link>
              </div>
            ) : (
              <div style={{ marginTop: 6 }}>
                <SnapshotRows
                  items={newestFirst.slice(0, SHOWN_SNAPSHOTS)}
                  confirming={confirming}
                  onOpen={handleOpen}
                  onDelete={handleDelete}
                  onBlur={() => setConfirming(null)}
                />
              </div>
            )}
          </section>

          {canCompare && (
            <section className='ix-tile' style={{ '--tile-c': '#f5a07a' } as CSSProperties} aria-labelledby='compare-title'>
              <h2 id='compare-title' className='ix-tile-title'>
                Compare two exports
              </h2>
              <div className='ix-stack' style={{ marginTop: 10, gap: 8 }}>
                <label>
                  <span className='ix-label' style={{ display: 'block', marginBottom: 4 }}>
                    From
                  </span>
                  <select className='ix-field' style={{ width: '100%' }} value={fromId} onChange={event => setFromChoice(event.target.value)}>
                    {sources.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className='ix-label' style={{ display: 'block', marginBottom: 4 }}>
                    To
                  </span>
                  <select className='ix-field' style={{ width: '100%' }} value={toId} onChange={event => setToChoice(event.target.value)}>
                    {sources.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <p className='ix-note' style={{ marginTop: 10 }}>
                Dates are when each export was analysed, not when someone actually followed or unfollowed. The comparison only shows what differs between
                the two files.
              </p>
            </section>
          )}
        </aside>

        {!canCompare ? (
          <section className='ix-tile' style={{ '--tile-c': '#f5a07a' } as CSSProperties}>
            <div className='ix-empty'>
              <h2 className='ix-h2'>Two exports to compare</h2>
              <p>
                {sources.length === 0
                  ? 'Comparisons need at least two exports. Import one now, save a snapshot, and come back after your next export.'
                  : 'You have one export so far. Import another later and save both as snapshots to see who is new and who is gone.'}
              </p>
            </div>
          </section>
        ) : comparison ? (
          <div className='ix-rail'>
            <div className='ix-kinds' style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }} role='group' aria-label='Changes between the two exports'>
              {KINDS.map(item => {
                const count = comparison.result[item.kind].length

                return (
                  <button
                    key={item.kind}
                    type='button'
                    className='ix-tile'
                    aria-pressed={kind === item.kind}
                    onClick={() => setKind(item.kind)}
                    style={{ '--tile-c': item.color, textAlign: 'left', cursor: 'pointer', borderStyle: kind === item.kind ? 'solid' : undefined, borderColor: kind === item.kind ? item.color : undefined } as CSSProperties}
                  >
                    <span className='ix-tile-title'>{item.title}</span>
                    <span className='ix-tile-sub'>{item.subtitle}</span>
                    <span className='ix-metric'>
                      <DotText text={formatCount(count)} dot={4} color={item.color} label={`${formatCount(count)} ${item.title.toLowerCase()}`} />
                    </span>
                  </button>
                )
              })}
            </div>

            <p className='ix-note' role='status'>
              Followers {signed(comparison.result.netFollowers)} · Following {signed(comparison.result.netFollowing)} between{' '}
              {formatDateTime(comparison.older.analyzedAt)} and {formatDateTime(comparison.newer.analyzedAt)}.
            </p>

            <section className='ix-tile ix-rail-grow' style={{ '--tile-c': active.color } as CSSProperties} aria-label={active.title}>
              <AccountBrowser
                key={`${comparison.older.id}-${comparison.newer.id}-${kind}`}
                accounts={comparison.result[kind]}
                csvName={active.csv}
                csvRelationship={active.csv.replace('-', ' ')}
                fallbackPageSize={settings.rowsPerPage}
                reference={new Date(comparison.newer.analyzedAt)}
                dateHeader={kind === 'gainedFollowers' || kind === 'lostFollowers' ? 'Followed you' : 'You followed'}
                emptyMessage='No accounts changed in this way between these exports.'
              />
            </section>
          </div>
        ) : (
          <section className='ix-tile'>
            <p className='ix-note'>Choose two different exports to compare.</p>
          </section>
        )}
      </div>

      <Dialog open={all} onClose={() => setAll(false)} title='All saved snapshots' wide>
        <SnapshotRows items={newestFirst} confirming={confirming} onOpen={handleOpen} onDelete={handleDelete} onBlur={() => setConfirming(null)} />
      </Dialog>
    </div>
  )
}

export default HistoryPage
