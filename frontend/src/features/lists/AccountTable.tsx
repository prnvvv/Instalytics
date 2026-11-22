import { ChevronLeft, ChevronRight, Download, ExternalLink, Search } from 'lucide-react'
import { Fragment, useId, useMemo, useState, type ReactNode } from 'react'

import { accountColumns, downloadText, toCsv } from '@/lib/csv'
import { formatCount, formatDate } from '@/lib/format'
import { isSafeProfileUrl } from '@/lib/instagram/normalize'
import type { Account } from '@/lib/instagram/types'
import type { Relationship } from '@/lib/analytics/relationships'

const RELATIONSHIP_LABEL: Record<Relationship, string> = {
  mutual: 'Mutual',
  'not-following-back': 'Not following back',
  fan: 'Fan'
}

const RELATIONSHIP_COLOR: Record<Relationship, string> = {
  mutual: '#f6d08a',
  'not-following-back': '#f5a07a',
  fan: '#e88bb3'
}

const RELATIONSHIP_EXPLANATION: Record<Relationship, string> = {
  mutual: 'You follow each other.',
  'not-following-back': 'You follow this account, but it does not follow you.',
  fan: 'This account follows you, but you do not follow it.'
}

type DateFilter = 'all' | '30d' | '6m' | '1y' | 'older' | 'none'
type Sort = 'az' | 'za' | 'newest' | 'oldest'

const DAY = 86_400

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

type PropsAccountTable = {
  accounts: readonly Account[]
  /** Relationship of each account to the user, when meaningful for this list. */
  relationOf?: (username: string) => Relationship | null
  /** Used for the CSV relationship column when relationOf is not given. */
  csvRelationship?: string
  csvName: string
  pageSize: number
  /** The date relative filters count back from (the export's analysis time). */
  reference: Date
  emptyMessage: string
  /** Label for the column's date, for example "Followed you". */
  dateHeader?: string
  /** Show the Status column. Lists that hold a single kind of account hide it as redundant. */
  showStatus?: boolean
  /** An extra column of per-row controls, for example "mark as unavailable". */
  rowAction?: { header: string; render: (account: Account) => ReactNode }
  /** A button acting on the accounts currently shown on the page, for example "mark this page as unavailable". */
  pageAction?: { label: (count: number) => string; run: (visible: readonly Account[]) => void }
  /** An extra CSV column. */
  csvExtra?: { header: string; value: (account: Account) => string }
}

/** Search, filter, sort, page and export a list of accounts. Rows expand to show account details. */
const AccountTable = ({
  accounts,
  relationOf,
  csvRelationship = '',
  csvName,
  pageSize: initialPageSize,
  reference,
  emptyMessage,
  dateHeader = 'Followed',
  showStatus = true,
  rowAction,
  pageAction,
  csvExtra
}: PropsAccountTable) => {
  const id = useId()
  const [query, setQuery] = useState('')
  const [dateFilter, setDateFilter] = useState<DateFilter>('all')
  const [sort, setSort] = useState<Sort>('az')
  const [pageSize, setPageSize] = useState(initialPageSize)
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)

  const hasDates = useMemo(() => accounts.some(a => a.followedAt !== null), [accounts])
  const referenceSeconds = Math.floor(reference.getTime() / 1000)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/^@/, '')

    return accounts
      .filter(a => (needle === '' || a.username.includes(needle)) && matchesDate(a, dateFilter, referenceSeconds))
      .sort(compare(hasDates ? sort : sort === 'za' ? 'za' : 'az'))
  }, [accounts, query, dateFilter, sort, referenceSeconds, hasDates])

  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const current = Math.min(page, pages)
  const start = (current - 1) * pageSize
  const visible = rows.slice(start, start + pageSize)

  const reset = () => {
    setPage(1)
    setOpen(null)
  }

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

  return (
    <div>
      <div className='ix-toolbar'>
        <label className='ix-search' style={{ position: 'relative' }}>
          <span className='sr-only'>Search usernames</span>
          <Search aria-hidden size={14} style={{ position: 'absolute', left: 14, top: 12, color: '#9a9a9a' }} />
          <input
            type='search'
            className='ix-field'
            style={{ width: '100%', paddingLeft: 36 }}
            placeholder='Search usernames'
            value={query}
            onChange={event => {
              setQuery(event.target.value)
              reset()
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
                reset()
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
              reset()
            }}
          >
            <option value='az'>Username A to Z</option>
            <option value='za'>Username Z to A</option>
            {hasDates && <option value='newest'>Date, newest first</option>}
            {hasDates && <option value='oldest'>Date, oldest first</option>}
          </select>
        </label>

        {pageAction && (
          <button type='button' className='ix-btn' onClick={() => pageAction.run(visible)} disabled={visible.length === 0}>
            {pageAction.label(visible.length)}
          </button>
        )}

        <button type='button' className='ix-btn' onClick={handleExport} disabled={rows.length === 0}>
          <Download aria-hidden size={14} />
          Export CSV ({formatCount(rows.length)})
        </button>
      </div>

      {rows.length === 0 ? (
        <p className='ix-empty' role='status'>
          <span style={{ color: '#9a9a9a', fontSize: '0.9rem' }}>{accounts.length === 0 ? emptyMessage : 'No accounts match these filters.'}</span>
        </p>
      ) : (
        <div className='ix-table-wrap'>
          <table className='ix-table' aria-label={`${csvName} accounts`}>
            <thead>
              <tr>
                <th scope='col'>Account</th>
                {hasDates && (
                  <th scope='col' className='ix-hide-sm'>
                    {dateHeader}
                  </th>
                )}
                {relationOf && showStatus && <th scope='col'>Status</th>}
                {rowAction && <th scope='col'>{rowAction.header}</th>}
              </tr>
            </thead>
            <tbody>
              {visible.map(account => {
                const relation = relationOf?.(account.username) ?? null
                const expanded = open === account.username
                const detailId = `${id}-${account.username}`
                const safe = isSafeProfileUrl(account.profileUrl)

                return (
                  <Fragment key={account.username}>
                    <tr>
                      <td>
                        <button
                          type='button'
                          className='ix-row-btn'
                          aria-expanded={expanded}
                          aria-controls={detailId}
                          onClick={() => setOpen(expanded ? null : account.username)}
                        >
                          <i aria-hidden className='ix-user-sq' style={{ background: relation ? RELATIONSHIP_COLOR[relation] : '#8593ea' }} />
                          {account.username}
                        </button>
                      </td>
                      {hasDates && <td className='ix-hide-sm'>{formatDate(account.followedAt)}</td>}
                      {relationOf && showStatus && (
                        <td>
                          {relation && (
                            <span className='ix-badge'>
                              <i style={{ ['--c' as string]: RELATIONSHIP_COLOR[relation] }} />
                              {RELATIONSHIP_LABEL[relation]}
                            </span>
                          )}
                        </td>
                      )}
                      {rowAction && <td>{rowAction.render(account)}</td>}
                    </tr>
                    {expanded && (
                      <tr id={detailId} className='ix-detail'>
                        <td colSpan={1 + (hasDates ? 1 : 0) + (relationOf && showStatus ? 1 : 0) + (rowAction ? 1 : 0)}>
                          <dl>
                            <div>
                              <dt>Profile</dt>
                              <dd>
                                {safe ? (
                                  <a href={account.profileUrl} target='_blank' rel='noopener noreferrer'>
                                    Open on Instagram <ExternalLink aria-hidden size={12} style={{ display: 'inline' }} />
                                  </a>
                                ) : (
                                  'Unavailable'
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt>{dateHeader}</dt>
                              <dd>{formatDate(account.followedAt)}</dd>
                            </div>
                            {relation && (
                              <div>
                                <dt>Relationship</dt>
                                <dd>{RELATIONSHIP_EXPLANATION[relation]}</dd>
                              </div>
                            )}
                            <div>
                              <dt>Source</dt>
                              <dd>{account.source ?? 'Saved snapshot'}</dd>
                            </div>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className='ix-pager'>
        <span role='status'>
          {rows.length === 0 ? '0 accounts' : `${formatCount(start + 1)}-${formatCount(start + visible.length)} of ${formatCount(rows.length)}`}
        </span>
        <div className='flex flex-wrap items-center gap-2'>
          <label>
            <span className='sr-only'>Rows per page</span>
            <select
              className='ix-field'
              value={pageSize}
              onChange={event => {
                setPageSize(Number(event.target.value))
                reset()
              }}
            >
              {[25, 50, 100].map(size => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
            </select>
          </label>
          <button type='button' className='ix-btn ix-btn-sm' aria-label='Previous page' disabled={current <= 1} onClick={() => setPage(current - 1)}>
            <ChevronLeft aria-hidden size={14} />
          </button>
          <span>
            Page {current} of {pages}
          </span>
          <button type='button' className='ix-btn ix-btn-sm' aria-label='Next page' disabled={current >= pages} onClick={() => setPage(current + 1)}>
            <ChevronRight aria-hidden size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default AccountTable
