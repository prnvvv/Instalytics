import { Link, NavLink, Outlet } from 'react-router'
import { preconnect } from 'react-dom'

import { DataProvider } from '@/data/DataProvider'
import { useBackendStatus } from '@/data/useBackendStatus'
import type { SnapshotStore } from '@/lib/storage/snapshots'

import '@/styles/app.css'

// The same typefaces as the landing page (Archivo, Handjet, Host Grotesk, Martian Mono).
const FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75,800&family=Handjet:wght@600&family=Host+Grotesk:wght@400;500;600&family=Martian+Mono:wght@400&display=swap'

const NAV = [
  { label: 'Overview', to: '/app/dashboard' },
  { label: 'Lists', to: '/app/lists' },
  { label: 'History', to: '/app/history' },
  { label: 'Settings', to: '/app/settings' }
]

const AppFonts = () => {
  preconnect('https://fonts.googleapis.com')
  preconnect('https://fonts.gstatic.com', { crossOrigin: 'anonymous' })

  return <link rel='stylesheet' href={FONTS_URL} precedence='default' />
}

const API_CHIP = {
  online: { label: 'API online', dot: 'ix-dot-ok', hint: 'The INYX backend is reachable and ready.' },
  degraded: { label: 'API degraded', dot: 'ix-dot-warn', hint: 'The INYX backend is reachable, but a dependency is unavailable.' },
  offline: { label: 'API offline', dot: 'ix-dot-off', hint: 'The backend is not reachable. The app still works: analysis runs in your browser.' }
} as const

/** The backend's health. Only a health check is ever sent: no Instagram data goes to the backend. */
const ApiStatus = () => {
  const { status } = useBackendStatus()

  if (status === null || status.state === 'not_configured') return null

  const chip = API_CHIP[status.state]

  return (
    <span className='ix-chip' role='status' title={`${chip.hint} Health check only; no Instagram data is sent.`}>
      <span aria-hidden className={chip.dot} />
      {chip.label}
    </span>
  )
}

type PropsAppShell = {
  /** Injected in tests; defaults to the browser's IndexedDB. */
  store?: SnapshotStore | null
}

const AppShell = ({ store }: PropsAppShell) => {
  return (
    <DataProvider store={store}>
      <AppFonts />
      <div className='ix-root'>
        <header className='ix-header ix-frame'>
          <Link to='/' className='ix-brand' aria-label='INYX home'>
            <span aria-hidden className='ix-hot' />
            INYX
          </Link>

          <nav aria-label='Application' className='ix-nav'>
            {NAV.map(item => (
              <NavLink key={item.to} to={item.to}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className='ix-header-end'>
            <span className='ix-chip' title='INYX reads your export in this browser tab. The file is never uploaded, and no Instagram login is ever needed.'>
              <span aria-hidden className='ix-dot-ok' />
              Private: runs in your browser
            </span>
            <ApiStatus />
            <Link to='/app/import' className='ix-btn ix-btn-dark'>
              Import
            </Link>
          </div>
        </header>

        <main className='ix-main ix-frame'>
          <Outlet />
        </main>
      </div>
    </DataProvider>
  )
}

export default AppShell
