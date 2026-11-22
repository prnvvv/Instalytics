import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router'

import { PageHead } from '@/app/common'
import { useAppData } from '@/data/context'
import { useBackendStatus } from '@/data/useBackendStatus'
import { apiBaseUrl, apiMode, type BackendStatus } from '@/lib/api/client'
import { accountsOfKind, type RelationshipKind } from '@/lib/analytics/relationships'
import { accountsToCsv, downloadText, toCsv } from '@/lib/csv'
import { formatBytes, formatCount, formatPercent, formatRatio } from '@/lib/format'
import { approximateSize } from '@/lib/storage/snapshots'

const EXPORTS: { kind: RelationshipKind; label: string }[] = [
  { kind: 'not-following-back', label: 'Not following back' },
  { kind: 'fans', label: 'Fans' },
  { kind: 'mutuals', label: 'Mutuals' },
  { kind: 'followers', label: 'Followers' },
  { kind: 'following', label: 'Following' }
]

const BACKEND_TEXT: Record<BackendStatus['state'], string> = {
  not_configured: 'Not configured. INYX works fully without it.',
  online: 'Online and ready.',
  degraded: 'Reachable, but a dependency is unavailable.',
  offline: 'Not reachable. INYX still works without it.'
}

const CHECK_TEXT = { ok: 'ok', unavailable: 'unavailable', not_configured: 'not configured' } as const

const MODE_TEXT = {
  direct: () => `Requests go to ${apiBaseUrl()} (VITE_API_URL). That origin must be listed in the backend's CORS_ORIGINS.`,
  proxy: () => 'Development: requests to /api are forwarded to the backend by the Vite dev server.',
  none: () => 'No backend is configured. Set VITE_API_URL to show the status of the INYX API.'
} as const

const tint = (color: string) => ({ '--tile-c': color }) as CSSProperties

const SettingsPage = () => {
  const { session, snapshots, storeAvailable, storageError, settings, updateSettings, deleteAllSnapshots, clearSession, clearUnavailable } = useAppData()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { status, refresh: checkBackend } = useBackendStatus()
  const [message, setMessage] = useState<string | null>(null)

  const handleDeleteAll = async () => {
    if (!confirmDelete) {
      setConfirmDelete(true)

      return
    }

    await deleteAllSnapshots()
    setConfirmDelete(false)
    setMessage('All saved snapshots were deleted from this device.')
  }

  const handleClearMarks = async () => {
    await clearUnavailable()
    setMessage('All unavailable marks were cleared; every account counts in the figures again.')
  }

  const handleClear = () => {
    clearSession()
    setMessage('The current analysis was cleared from memory.')
  }

  const day = session ? new Date(session.analyzedAt).toISOString().slice(0, 10) : ''

  const handleSummary = () => {
    if (!session) return

    const a = session.analysis
    const rows: [string, string][] = [
      ['followers', String(a.followersCount)],
      ['following', String(a.followingCount)],
      ['mutuals', String(a.mutualCount)],
      ['not_following_back', String(a.notFollowingBackCount)],
      ['fans', String(a.fansCount)],
      ['unique_accounts', String(a.uniqueAccountsCount)],
      ['follow_back_rate_percent', a.followBackRate === null ? '' : a.followBackRate.toFixed(2)],
      ['mutuality_rate_percent', a.mutualityRate === null ? '' : a.mutualityRate.toFixed(2)],
      ['follower_to_following_ratio', a.followerToFollowingRatio === null ? '' : a.followerToFollowingRatio.toFixed(4)]
    ]

    downloadText(`inyx-summary-${day}.csv`, toCsv(rows, [{ header: 'metric', value: r => r[0] }, { header: 'value', value: r => r[1] }]))
  }

  return (
    <div className='ix-page'>
      <PageHead
        label='Settings'
        title={
          <>
            Your <span className='ix-px'>data</span>
          </>
        }
        sub='Everything INYX knows about you lives in this browser. Here you can see it, export it and delete it.'
      />

      {message && (
        <p className='ix-note' role='status'>
          {message}
        </p>
      )}

      <div className='ix-body ix-body-3'>
        <div className='ix-stack'>
          <section className='ix-tile' style={tint('#a98ae6')} aria-labelledby='saved'>
            <h2 id='saved' className='ix-tile-title'>
              Saved on this device
            </h2>
            <dl className='ix-kv' style={{ marginTop: 8 }}>
              <div>
                <dt>Saved snapshots</dt>
                <dd>{formatCount(snapshots.length)}</dd>
              </div>
              <div className='ix-hide-short'>
                <dt>Approximate size</dt>
                <dd>{formatBytes(approximateSize(snapshots))}</dd>
              </div>
              <div>
                <dt>Current analysis in memory</dt>
                <dd>{session ? (session.origin === 'sample' ? 'Sample data' : session.fileName) : 'None'}</dd>
              </div>
              <div>
                <dt>Accounts marked unavailable</dt>
                <dd>{formatCount(session?.unavailable.length ?? 0)}</dd>
              </div>
            </dl>

            {storageError && (
              <div className='ix-alert ix-alert-error' role='alert' style={{ marginTop: 10 }}>
                <div>{storageError}</div>
              </div>
            )}
            {!storeAvailable && <p className='ix-note'>This browser blocks local storage, so nothing can be saved here.</p>}

            <div className='flex flex-wrap gap-2' style={{ marginTop: 12 }}>
              <button
                type='button'
                className={confirmDelete ? 'ix-btn ix-btn-sm ix-btn-danger' : 'ix-btn ix-btn-sm'}
                disabled={snapshots.length === 0}
                onClick={handleDeleteAll}
                onBlur={() => setConfirmDelete(false)}
              >
                {confirmDelete ? 'Click again to delete everything' : 'Delete all saved snapshots'}
              </button>
              <button type='button' className='ix-btn ix-btn-sm' disabled={!session} onClick={handleClear}>
                Clear current analysis
              </button>
              <button type='button' className='ix-btn ix-btn-sm' disabled={!session || session.unavailable.length === 0} onClick={handleClearMarks}>
                Clear unavailable marks
              </button>
            </div>
            <p className='ix-note ix-hide-short' style={{ marginTop: 8 }}>
              Deleting removes snapshots from this browser for good.
            </p>
          </section>

          <section className='ix-tile' style={tint('#f5a07a')} aria-labelledby='prefs'>
            <h2 id='prefs' className='ix-tile-title'>
              Preferences
            </h2>
            <div className='ix-stack' style={{ marginTop: 10, gap: 10 }}>
              <label>
                <span className='ix-label' style={{ display: 'block', marginBottom: 4 }}>
                  Cards per page when the page scrolls
                </span>
                <select
                  className='ix-field'
                  value={settings.rowsPerPage}
                  onChange={event => updateSettings({ rowsPerPage: Number(event.target.value) as 25 | 50 | 100 })}
                >
                  {[25, 50, 100].map(size => (
                    <option key={size} value={size}>
                      {size}
                    </option>
                  ))}
                </select>
              </label>
              <label className='ix-check'>
                <input
                  type='checkbox'
                  checked={settings.saveByDefault}
                  disabled={!storeAvailable}
                  onChange={event => updateSettings({ saveByDefault: event.target.checked })}
                />
                <span>
                  Pre-tick "Also save a snapshot" when importing
                  <span className='ix-note ix-hide-short' style={{ display: 'block' }}>
                    You still confirm every import. Nothing is saved without that.
                  </span>
                </span>
              </label>
            </div>
          </section>
        </div>

        <div className='ix-stack'>
          <section className='ix-tile' style={tint('#f6d08a')} aria-labelledby='export'>
            <h2 id='export' className='ix-tile-title'>
              Export
            </h2>
            {session ? (
              <>
                <p className='ix-note' style={{ marginTop: 6 }}>
                  CSV files open in any spreadsheet. Cells that could be read as formulas are neutralised.
                </p>
                <div className='flex flex-wrap gap-2' style={{ marginTop: 12 }}>
                  <button type='button' className='ix-btn ix-btn-sm' onClick={handleSummary}>
                    Summary
                  </button>
                  {EXPORTS.map(item => (
                    <button
                      key={item.kind}
                      type='button'
                      className='ix-btn ix-btn-sm'
                      onClick={() => downloadText(`inyx-${item.kind}-${day}.csv`, accountsToCsv(accountsOfKind(session.analysis, item.kind), item.kind))}
                    >
                      {item.label} ({formatCount(accountsOfKind(session.analysis, item.kind).length)})
                    </button>
                  ))}
                </div>
                <p className='ix-note' style={{ marginTop: 10 }}>
                  Rates in the summary: follow-back {formatPercent(session.analysis.followBackRate)}, mutuality {formatPercent(session.analysis.mutualityRate)}, ratio{' '}
                  {formatRatio(session.analysis.followerToFollowingRatio)}.
                </p>
              </>
            ) : (
              <p className='ix-note' style={{ marginTop: 8 }}>
                Import an export first. Per-list CSV export is also on every list page.{' '}
                <Link to='/app/import' className='ix-link'>
                  Import
                </Link>
              </p>
            )}
          </section>

          <section className='ix-tile' style={tint('#e88bb3')} aria-labelledby='backend'>
            <h2 id='backend' className='ix-tile-title'>
              Backend
            </h2>
            <p className='ix-note' style={{ marginTop: 6 }} role='status'>
              {status === null ? 'Checking...' : BACKEND_TEXT[status.state]}
            </p>
            {status !== null && (status.state === 'online' || status.state === 'degraded') && (
              <dl className='ix-kv' style={{ marginTop: 8 }}>
                {Object.entries(status.readiness.checks).map(([name, value]) => (
                  <div key={name}>
                    <dt>{name}</dt>
                    <dd>{CHECK_TEXT[value]}</dd>
                  </div>
                ))}
              </dl>
            )}
            <p className='ix-note' style={{ marginTop: 8 }}>
              {MODE_TEXT[apiMode()]()}
            </p>
            <p className='ix-note'>Only this health check is sent. Your export and your account lists never leave the browser.</p>
            <button type='button' className='ix-btn ix-btn-sm' style={{ marginTop: 10, alignSelf: 'flex-start' }} onClick={checkBackend}>
              Check again
            </button>
          </section>
        </div>

        <div className='ix-stack'>
          <section className='ix-tile' style={tint('#8593ea')} aria-labelledby='privacy'>
            <h2 id='privacy' className='ix-tile-title'>
              Privacy
            </h2>
            <ul className='ix-bullets' style={{ marginTop: 10 }}>
              <li>No Instagram login, password, cookies or tokens. INYX never connects to your account.</li>
              <li>Your export is read in this browser tab and is never uploaded. The analysis runs here too.</li>
              <li>Snapshots are opt-in, hold only follower and following lists, and stay on this device.</li>
              <li>INYX never follows, unfollows or messages anyone for you.</li>
              <li>The page's typefaces load from Google Fonts, which is a request your browser makes. No export data is involved.</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  )
}

export default SettingsPage
