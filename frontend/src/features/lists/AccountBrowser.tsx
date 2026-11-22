import { ChevronLeft, ChevronRight, Download, ExternalLink, Search } from 'lucide-react'
import { useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'

import Dialog from '@/components/ui/Dialog'
import { useElementSize, useFitLayout } from '@/hooks/useFit'
import { accountColumns, downloadText, toCsv } from '@/lib/csv'
import { formatCount, formatDate } from '@/lib/format'
import { isSafeProfileUrl } from '@/lib/instagram/normalize'
import type { Account } from '@/lib/instagram/types'
import type { Relationship } from '@/lib/analytics/relationships'
import { KIND_COLOR } from '@/lib/palette'

const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  mutual: 'Mutual',
  'not-following-back': 'Not following back',
  fan: 'Fan'
}

const RELATIONSHIP_COLOR: Record<Relationship, string> = {
  mutual: KIND_COLOR.mutuals,
  'not-following-back': KIND_COLOR['not-following-back'],
  fan: KIND_COLOR.fans
}

const RELATIONSHIP_EXPLANATION: Record<Relationship, string> = {
  mutual: 'You follow each other.',
  'not-following-back': 'You follow this account, but it does not follow you.',
  fan: 'This account follows you, but you do not follow it.'
}

type DateFilter = 'all' | '30d' | '6m' | '1y' | 'older' | 'none'
type Sort = 'az' | 'za' | 'newest' | 'oldest'

const DAY = 86_400

// The card grid is laid out from these, so the number of cards that fit can be worked out from the space.
const CARD_MIN_WIDTH = 230
const CARD_HEIGHT = 56
const GRID_GAP = 8

const matchesDate = (account: Account, filter: DateFilter, reference: number) => {
  if (filter === 'all') return true
  if (filter === 'none') return account.followedAt === null
  if (account.followedAt === null) return false

  const age = reference - account.followedAt

  switch (filter) {
    case '30d':
      return age <= 30 * DAY
    case '6m':
      return age <= 182 * DAY
    case '1y':
      return age <= 365 * DAY
    case 'older':
      return age > 365 * DAY
  }
}

const compare = (sort: Sort) => (a: Account, b: Account) => {
  if (sort === 'az' || sort === 'za') {
    const order = a.username < b.username ? -1 : a.username > b.username ? 1 : 0

    return sort === 'az' ? order : -order
  }

  // Accounts without a date always sort last.
  if (a.followedAt === null && b.followedAt === null) return a.username < b.username ? -1 : 1
  if (a.followedAt === null) return 1
  if (b.followedAt === null) return -1

  return sort === 'newest' ? b.followedAt - a.followedAt : a.followedAt - b.followedAt
}

type PropsAccountBrowser = {
  accounts: readonly Account[]
  /** Relationship of each account to the user, when meaningful for this list. */
  relationOf?: (username: string) => Relationship | null
  /** Used for the CSV relationship column when relationOf is not given. */
  csvRelationship?: string
  csvName: string
  /** The date relative filters count back from (the export's analysis time). */
  reference: Date
  emptyMessage: string
  /** Label for the account's date, for example "Followed you". */
  dateHeader?: string
  /** Cards per page when the page scrolls and so cannot be measured (phones, short windows). */
  fallbackPageSize: number
  /** Facts shown in an account's details; defaults to its date. */
  detailsOf?: (account: Account) => { label: string; value: string }[]
  /** A small control on every card, for example "mark as unavailable". */
  cardControl?: (account: Account) => ReactNode
  /** Extra controls inside an account's details. */
  dialogControls?: (account: Account) => ReactNode
  /** Controls at the left of the pager that act on the accounts currently shown. */
  footerControls?: (visible: readonly Account[]) => ReactNode
  /** An extra CSV column. */
  csvExtra?: { header: string; value: (account: Account) => string }
}

/**
 * Search, sort, filter, page and export a list of accounts. On the fixed layout the number of cards per page is
 * worked out from the space available, so the list always fills its tile without the page scrolling. Selecting an
 * account opens its details in a dialog.
 */
const AccountBrowser = ({
  accounts,
  relationOf,
  csvRelationship = '',
  csvName,
  reference,
  emptyMessage,
  dateHeader = 'Followed',
  fallbackPageSize,
  detailsOf,
  cardControl,
  dialogControls,
  footerControls,
  csvExtra
}: PropsAccountBrowser) => {
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sort, setSort] = useState<Sort>('az')
  const [page, setPage] = useState(1)
  const [openName, setOpenName] = useState<string | null>(null)
  const grid = useRef<HTMLDivElement>(null)
  const fit = useFitLayout()
  const { width, height } = useElementSize(grid)
  const searchId = useId()

  const hasDates = useMemo(() => accounts.some(a => a.followedAt !== null), [accounts])
  const referenceSeconds = Math.floor(reference.getTime() / 1000)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, '')

    return accounts
      .filter(a => (needle === '' || a.username.includes(needle)) && matchesDate(a, dateFilter, referenceSeconds))
      .sort(compare(hasDates ? sort : sort === 'za' ? 'za' : 'az'))
  }, [accounts, query, dateFilter, sort, referenceSeconds, hasDates])

  const columnsFit = Math.max(1, Math.floor((width + GRID_GAP) / (CARD_MIN_WIDTH + GRID_GAP)))
  const rowsFit = Math.max(1, Math.floor((height + GRID_GAP) / (CARD_HEIGHT + GRID_GAP)))
  const pageSize = fit && width > 0 && height > 0 ? columnsFit * rowsFit : fallbackPageSize

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const start = (current - 1) * pageSize
  const visible = rows.slice(start, start + pageSize)
  const opened = openName === null ? null : (accounts.find(a => a.username === openName) ?? null)

  const handleExport = () => {
    const columns = accountColumns(csvRelationship)

    columns[3] = {
      header: 'relationship',
      value: a => (relationOf ? (relationOf(a.username) ?? '') : csvRelationship)
    }

    if (csvExtra) columns.push({ header: csvExtra.header, value: csvExtra.value })

    const day = reference.toISOString().slice(0, 10)

    downloadText(`inyx-${csvName}-${day}.csv`, toCsv(rows, columns))
  }

  const subtitle = (account: Account) => {
    const relation = relationOf?.(account.username) ?? null

    if (account.followedAt !== null) return `${dateHeader} ${formatDate(account.followedAt)}`

    return relation ? RELATIONSHIP_LABEL[relation] : 'No date in export'
  }

  const colorOf = (account: Account) => {
    const relation = relationOf?.(account.username) ?? null

    return relation ? RELATIONSHIP_COLOR[relation] : KIND_COLOR.following
  }

  const openRelation = opened ? (relationOf?.(opened.username) ?? null) : null

  return (
    <div className='ix-browser' style={{ flex: 1 }}>
      <div className='ix-toolbar'>
        <label className='ix-search' htmlFor={searchId}>
          <span className='sr-only'>Search usernames</span>
          <Search aria-hidden size={14} style={{ position: 'absolute', left: 14, top: 11, color: '#9a9a9a' }} />
          <input
            id={searchId}
            type='search'
            className='ix-field'
            style={{ width: '100%', paddingLeft: 36 }}
            placeholder='Search usernames'
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              setPage(1)
            }}
          />
        </label>

        {hasDates && (
          <label>
            <span className='sr-only'>Filter by date</span>
            <select
              className='ix-field'
              value={dateFilter}
              onChange={event => {
                setDateFilter(event.target.value as DateFilter)
                setPage(1)
              }}
            >
              <option value='all'>Any date</option>
              <option value='30d'>Last 30 days</option>
              <option value='6m'>Last 6 months</option>
              <option value='1y'>Last year</option>
              <option value='older'>Older than a year</option>
              <option value='none'>No date in export</option>
            </select>
          </label>
        )}

        <label>
          <span className='sr-only'>Sort</span>
          <select
            className='ix-field'
            value={sort}
            onChange={event => {
              setSort(event.target.value as Sort)
              setPage(1)
            }}
          >
            <option value='az'>Username A to Z</option>
            <option value='za'>Username Z to A</option>
            {hasDates && <option value='newest'>Date, newest first</option>}
            {hasDates && <option value='oldest'>Date, oldest first</option>}
          </select>
        </label>

        <button type='button' className='ix-btn' onClick={handleExport} disabled={rows.length === 0}>
          <Download aria-hidden size={14} />
          Export CSV ({formatCount(rows.length)})
        </button>
      </div>

      <div ref={grid} className='ix-cards' role='list' aria-label={`${csvName} accounts`}>
        {rows.length === 0 ? (
          <p className='ix-empty' role='status' style={{ gridColumn: '1 / -1' }}>
            <span className='ix-note'>{accounts.length === 0 ? emptyMessage : 'No accounts match these filters.'}</span>
          </p>
        ) : (
          visible.map(account => {
            const safe = isSafeProfileUrl(account.profileUrl)

            return (
              <div key={account.username} role='listitem' className='ix-acct' style={{ '--c': colorOf(account) } as CSSProperties}>
                <i aria-hidden className='ix-acct-sq' />
                <button type='button' className='ix-acct-main' aria-label={`${account.username}: show details`} onClick={() => setOpenName(account.username)}>
                  <b>{account.username}</b>
                  <span>{subtitle(account)}</span>
                </button>
                <div className='ix-acct-acts'>
                  {safe && (
                    <a
                      className='ix-btn ix-btn-icon'
                      href={account.profileUrl}
                      target='_blank'
                      rel='noopener noreferrer'
                      aria-label={`Open ${account.username} on Instagram (new tab)`}
                    >
                      <ExternalLink aria-hidden size={14} />
                    </a>
                  )}
                  {cardControl?.(account)}
                </div>
              </div>
            )
          })
        )}
      </div>

      <div className='ix-pager'>
        <div className='flex flex-wrap items-center gap-2'>{footerControls?.(visible)}</div>
        <div className='flex flex-wrap items-center gap-2'>
          <span role='status'>
            {rows.length === 0 ? '0 accounts' : `${formatCount(start + 1)}-${formatCount(start + visible.length)} of ${formatCount(rows.length)}`}
          </span>
          <button type='button' className='ix-btn ix-btn-sm ix-btn-icon' aria-label='Previous page' disabled={current <= 1} onClick={() => setPage(current - 1)}>
            <ChevronLeft aria-hidden size={14} />
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button type='button' className='ix-btn ix-btn-sm ix-btn-icon' aria-label='Next page' disabled={current >= pages} onClick={() => setPage(current + 1)}>
            <ChevronRight aria-hidden size={14} />
          </button>
        </div>
      </div>

      <Dialog open={opened !== null} onClose={() => setOpenName(null)} title={opened?.username ?? ''} description={openRelation ? RELATIONSHIP_EXPLANATION[openRelation] : undefined}>
        {opened && (
          <>
            <div className='ix-detail-hero' style={{ '--c': colorOf(opened) } as CSSProperties}>
              <i aria-hidden className='ix-detail-sq' />
              <div>
                {openRelation && (
                  <span className='ix-badge'>
                    <i style={{ ['--c' as string]: RELATIONSHIP_COLOR[openRelation] }} />
                    {RELATIONSHIP_LABEL[openRelation]}
                  </span>
                )}
              </div>
            </div>

            <dl className='ix-kv'>
              {(detailsOf ? detailsOf(opened) : [{ label: dateHeader, value: formatDate(opened.followedAt) }]).map(item => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
              <div>
                <dt>Source</dt>
                <dd>{opened.source ?? 'Saved snapshot'}</dd>
              </div>
            </dl>

            <div className='flex flex-wrap items-center gap-2' style={{ marginTop: 14 }}>
              {isSafeProfileUrl(opened.profileUrl) ? (
                <a className='ix-btn ix-btn-dark' href={opened.profileUrl} target='_blank' rel='noopener noreferrer'>
                  Open on Instagram <ExternalLink aria-hidden size={13} />
                </a>
              ) : (
                <span className='ix-note'>No valid profile link</span>
              )}
            </div>

            {dialogControls && <div style={{ marginTop: 14 }}>{dialogControls(opened)}</div>}
          </>
        )}
      </Dialog>
    </div>
  )
}

export default AccountBrowser
