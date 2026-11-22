import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router'

import LandingPage from '@/pages/LandingPage'

// The application is split from the landing page so visitors only download it when they open /app.
const AppRoutes = lazy(() => import('@/app/AppRoutes').then(module => ({ default: module.AppRoutes })))

const App = () => {
  return (
    <Routes>
      <Route path='/' element={<LandingPage />} />
      <Route
        path='/app/*'
        element={
          <Suspense fallback={<p role='status' style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>Loading INYX...</p>}>
            <AppRoutes />
          </Suspense>
        }
      />
      <Route path='*' element={<Navigate to='/' replace />} />
    </Routes>
  )
}

export default App
