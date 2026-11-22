import { Link, NavLink, Outlet } from 'react-router'
import { preconnect } from 'react-dom'

import { DataProvider } from '@/data/DataProvider'
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
            <span className='ix-chip'>
              <span aria-hidden className='ix-dot-ok' />
              Runs in your browser
            </span>
            <Link to='/app/import' className='ix-btn ix-btn-dark'>
              Import
            </Link>
          </div>
        </header>

        <main className='ix-main ix-frame'>
          <Outlet />
        </main>

        <footer className='ix-footer ix-frame'>
          INYX reads your export in this browser tab. The file is never uploaded, and no Instagram login is ever needed.
        </footer>
      </div>
    </DataProvider>
  )
}

export default AppShell
