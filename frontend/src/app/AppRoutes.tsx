import { Link, Navigate, Route, Routes } from 'react-router'

import { PageHead, EmptyState } from '@/app/common'
import { useAppData } from '@/data/context'
import DashboardPage from '@/features/dashboard/DashboardPage'
import HistoryPage from '@/features/history/HistoryPage'
import ListsPage from '@/features/lists/ListsPage'
import SettingsPage from '@/features/settings/SettingsPage'
import ImportPage from '@/features/upload/ImportPage'

import type { SnapshotStore } from '@/lib/storage/snapshots'

import AppShell from './AppShell'

/** /app goes to the overview when there is something to show, otherwise to the import page. */
const AppHome = () => {
  const { session, loading } = useAppData()

  if (loading) return <p className='ix-note'>Loading...</p>

  return <Navigate to={session ? '/app/dashboard' : '/app/import'} replace />
}

const NotFound = () => (
  <>
    <PageHead label='404' title='Not found' />
    <div className='ix-panel'>
      <EmptyState title='This page does not exist' body='Use the navigation above to get back on track.'>
        <Link to='/app' className='ix-btn ix-btn-dark'>
          Go to the app
        </Link>
      </EmptyState>
    </div>
  </>
)

/** The application: everything under /app. */
export const AppRoutes = ({ store }: { store?: SnapshotStore | null }) => (
  <Routes>
    <Route element={<AppShell store={store} />}>
      <Route index element={<AppHome />} />
      <Route path='import' element={<ImportPage />} />
      <Route path='dashboard' element={<DashboardPage />} />
      <Route path='lists' element={<Navigate to='/app/lists/not-following-back' replace />} />
      <Route path='lists/:kind' element={<ListsPage />} />
      <Route path='history' element={<HistoryPage />} />
      <Route path='settings' element={<SettingsPage />} />
      <Route path='*' element={<NotFound />} />
    </Route>
  </Routes>
)
