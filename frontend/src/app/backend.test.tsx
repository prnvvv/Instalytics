import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '@/app/AppRoutes'
import { apiBaseUrl, getBackendStatus } from '@/lib/api/client'
import { MemorySnapshotStore } from '@/lib/storage/snapshots'
import { followersJson, followingJson, zipFile } from '@/lib/test-helpers'

const READY = { status: 'ok', checks: { redis: 'not_configured' } }

const respond = (body: unknown, status = 200) =>
  Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }))

const stubFetch = (handler: (url: string, init?: RequestInit) => Promise<Response>) => {
  const mock = vi.fn(handler)

  vi.stubGlobal('fetch', mock)

  return mock
}

const renderApp = (path = '/app/settings') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/app/*' element={<AppRoutes store={new MemorySnapshotStore()} />} />
      </Routes>
    </MemoryRouter>
  )

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('backend client', () => {
  it('uses the same origin in development, so the dev proxy can forward /api', () => {
    expect(apiBaseUrl()).toBe('')
  })

  it('uses VITE_API_URL when set, without a trailing slash', () => {
    vi.stubEnv('VITE_API_URL', 'https://api.example.test///')

    expect(apiBaseUrl()).toBe('https://api.example.test')
  })

  it('reports no backend in production when none is configured', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_API_URL', '')

    expect(apiBaseUrl()).toBeNull()
    expect(await getBackendStatus()).toEqual({ state: 'not_configured' })
  })

  it('calls the readiness endpoint with no credentials and nothing in the body', async () => {
    const fetchMock = stubFetch(() => respond(READY))

    expect(await getBackendStatus()).toEqual({ state: 'online', readiness: READY })

    const [url, init] = fetchMock.mock.calls[0]

    expect(url).toBe('/api/v1/health/ready')
    expect(init).toMatchObject({ credentials: 'omit', cache: 'no-store' })
    expect(init?.body).toBeUndefined()
    expect(init?.method ?? 'GET').toBe('GET')
  })

  it('maps a 503 with a readiness body to degraded', async () => {
    stubFetch(() => respond({ status: 'unavailable', checks: { redis: 'unavailable' } }, 503))

    expect((await getBackendStatus()).state).toBe('degraded')
  })

  it.each([
    ['a proxy error page', () => respond('<html>Bad gateway</html>', 502)],
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an unexpected JSON body', () => respond({ hello: 'world' })]
  ])('treats %s as offline', async (_name, handler) => {
    stubFetch(handler)

    expect(await getBackendStatus()).toEqual({ state: 'offline' })
  })
})

describe('backend status in the app', () => {
  it('shows an online indicator in the header and the readiness checks in Settings', async () => {
    stubFetch(() => respond(READY))
    renderApp()

    const header = screen.getByRole('banner')

    expect(await within(header).findByText('API online')).toBeInTheDocument()
    expect(await screen.findByText('Online and ready.')).toBeInTheDocument()
    expect(screen.getByText('redis')).toBeInTheDocument()
    expect(screen.getByText('not configured')).toBeInTheDocument()
    expect(screen.getByText(/forwarded to the backend by the vite dev server/i)).toBeInTheDocument()
  })

  it('shows a degraded indicator when a dependency is down', async () => {
    stubFetch(() => respond({ status: 'unavailable', checks: { redis: 'unavailable' } }, 503))
    renderApp()

    expect(await within(screen.getByRole('banner')).findByText('API degraded')).toBeInTheDocument()
    expect(await screen.findByText('unavailable')).toBeInTheDocument()
  })

  it('shows an offline indicator and keeps the whole app usable', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')

    expect(await within(screen.getByRole('banner')).findByText('API offline')).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /try with sample data/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /your network/i })).toBeInTheDocument()
  })

  it('hides the indicator when no backend is configured', async () => {
    vi.stubEnv('DEV', false)
    vi.stubEnv('VITE_API_URL', '')
    renderApp()

    expect(await screen.findByText(/not configured\. inyx works fully without it/i)).toBeInTheDocument()
    expect(within(screen.getByRole('banner')).queryByText(/^API /)).toBeNull()
  })

  it('re-checks on demand', async () => {
    const user = userEvent.setup()
    let up = false
    const fetchMock = stubFetch(() => (up ? respond(READY) : Promise.reject(new TypeError('down'))))

    renderApp()
    expect(await screen.findByText(/not reachable/i)).toBeInTheDocument()

    up = true
    await user.click(screen.getByRole('button', { name: 'Check again' }))
    expect(await screen.findByText('Online and ready.')).toBeInTheDocument()
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })
})

describe('privacy: nothing about the user is ever sent to the backend', () => {
  it('only makes health checks during a full import, analysis and export', async () => {
    const user = userEvent.setup()
    const fetchMock = stubFetch(() => respond(READY))

    renderApp('/app/import')
    await user.click(await screen.findByRole('checkbox', { name: /i understand my export is read only/i }))
    await user.upload(
      await screen.findByLabelText(/drop your instagram export zip/i),
      zipFile({
        'connections/followers_and_following/followers_1.json': followersJson('private_alice', 'private_bob'),
        'connections/followers_and_following/following.json': followingJson('private_bob', 'private_carol')
      })
    )
    await screen.findByRole('heading', { level: 1, name: /your network/i })
    await user.click(screen.getByRole('link', { name: /Not following back/ }))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })

    expect(fetchMock).toHaveBeenCalled()
    for (const [url, init] of fetchMock.mock.calls) {
      expect(url).toBe('/api/v1/health/ready')
      expect(init?.body).toBeUndefined()
      expect(String(url)).not.toMatch(/private_/)
    }
  })
})
