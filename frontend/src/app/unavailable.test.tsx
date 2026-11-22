import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { AppRoutes } from '@/app/AppRoutes'
import { MemorySnapshotStore } from '@/lib/storage/snapshots'
import { followersJson, followingJson, zipFile } from '@/lib/test-helpers'

type User = ReturnType<typeof userEvent.setup>

const tree = (path: string, store: MemorySnapshotStore) => (
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path='/app/*' element={<AppRoutes store={store} />} />
    </Routes>
  </MemoryRouter>
)

const renderApp = (path = '/app/import', store = new MemorySnapshotStore()) => {
  const view = render(tree(path, store))

  return { store, ...view }
}

const tickBoxes = () => screen.getAllByRole('checkbox', { name: /Mark .* as no longer available on Instagram/ })

const card = (label: RegExp) => screen.getByRole('link', { name: label })

const openSample = async (user: User) => {
  await user.click(await screen.findByRole('button', { name: /try with sample data/i }))
  await screen.findByRole('heading', { level: 1, name: /your network/i })
}

// 40 followers and 60 following with no overlap: every followed account is "not following back".
const importExport = async (user: User, options: { save?: boolean } = {}) => {
  const followers = Array.from({ length: 40 }, (_, i) => `f${i}`)
  const following = Array.from({ length: 60 }, (_, i) => `g${i}`)

  await user.click(await screen.findByRole('checkbox', { name: /i understand my export is read only/i }))
  if (options.save) await user.click(screen.getByRole('checkbox', { name: /also save a snapshot on this device/i }))

  await user.upload(
    await screen.findByLabelText(/drop your instagram export zip/i),
    zipFile({
      'connections/followers_and_following/followers_1.json': followersJson(...followers),
      'connections/followers_and_following/following.json': followingJson(...following)
    })
  )
  await screen.findByRole('heading', { level: 1, name: /your network/i })
}

const openFirstAccount = async (user: User) => {
  await user.click(screen.getAllByRole('button', { name: /: show details$/ })[0])

  return screen.findByRole('dialog')
}

beforeEach(() => {
  localStorage.clear()
})

describe('marking accounts as unavailable', () => {
  it('leaves the account out of the list, its tab count and the overview', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSample(user)
    expect(card(/Not following back: 80 accounts/)).toBeInTheDocument()
    expect(card(/Following: 200 following/)).toBeInTheDocument()

    await user.click(card(/Not following back: 80 accounts/))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })
    expect(screen.queryByRole('link', { name: /Unavailable/ })).toBeNull()

    const first = tickBoxes()[0]
    const name = first.getAttribute('aria-label')!.replace('Mark ', '').replace(' as no longer available on Instagram', '')

    await user.click(first)

    expect(screen.getByText('1-25 of 79')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: `${name}: show details` })).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Lists' })).getByRole('link', { name: /Not following back\s*79/ })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Lists' })).getByRole('link', { name: /Unavailable\s*1/ })).toBeInTheDocument()
    expect(screen.getByTitle(/1 account is marked as unavailable and left out of every figure/)).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Overview' }))
    expect(await screen.findByRole('link', { name: /Not following back: 79 accounts/ })).toBeInTheDocument()
    expect(card(/Following: 199 following/)).toBeInTheDocument()
    expect(card(/Followers: 240 followers/)).toBeInTheDocument()
  })

  it('removes a marked mutual from both lists, so mutuals, followers and following all drop', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSample(user)
    await user.click(card(/Mutuals: 120 mutual connections/))
    await screen.findByRole('heading', { level: 1, name: 'Mutual connections' })
    await user.click(tickBoxes()[0])
    await user.click(screen.getByRole('link', { name: 'Overview' }))

    expect(await screen.findByRole('link', { name: /Mutuals: 119 mutual connections/ })).toBeInTheDocument()
    expect(card(/Followers: 239 followers/)).toBeInTheDocument()
    expect(card(/Following: 199 following/)).toBeInTheDocument()
  })

  it('lists marked accounts under Unavailable and restores them', async () => {
    const user = userEvent.setup()

    renderApp()
    await openSample(user)
    await user.click(card(/Not following back: 80 accounts/))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })
    await user.click(tickBoxes()[0])
    await user.click(tickBoxes()[0])
    await user.click(screen.getByRole('link', { name: /Unavailable\s*2/ }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Unavailable accounts' })).toBeInTheDocument()
    expect(screen.getByText('1-2 of 2')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Unavailable accounts statistics' })).toBeInTheDocument()

    await user.click(screen.getAllByRole('button', { name: /^Restore / })[0])
    expect(await screen.findByText('1-1 of 1')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: /^Restore / })[0])

    expect(await screen.findByText('No accounts are marked as unavailable.')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Overview' }))
    expect(await screen.findByRole('link', { name: /Not following back: 80 accounts/ })).toBeInTheDocument()
    expect(screen.queryByText(/marked unavailable/)).toBeNull()
  })

  it('closes the gap with Instagram: ticking the dead accounts makes the figures match what the app shows', async () => {
    const user = userEvent.setup()

    renderApp()
    await importExport(user)
    await user.click(screen.getByRole('button', { name: 'Check against Instagram' }))
    await user.type(await screen.findByLabelText('Following in the Instagram app'), '50')
    expect(await screen.findByText('The export lists 10 more accounts than Instagram shows')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Not following back' })).toHaveAttribute('href', '/app/lists/not-following-back')
    await user.keyboard('{Escape}')

    await user.click(card(/Not following back: 60 accounts/))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })

    for (let i = 0; i < 10; i++) await user.click(tickBoxes()[0])

    await user.click(screen.getByRole('link', { name: 'Overview' }))
    await screen.findByRole('heading', { level: 1, name: /your network/i })

    expect(card(/Following: 50 following/)).toBeInTheDocument()
    expect(card(/Not following back: 50 accounts/)).toBeInTheDocument()

    // Typing the same number now matches exactly, and the panel says what is left out.
    await user.click(screen.getByRole('button', { name: 'Check against Instagram' }))
    await user.type(await screen.findByLabelText('Following in the Instagram app'), '50')
    expect(await screen.findByText('Following match exactly')).toBeInTheDocument()
    expect(screen.getByText(/exclude the 10 accounts you marked as unavailable/)).toHaveTextContent(/lists 40 followers and 60\s+following/)
  })

  it('marks every account on the page at once with the chosen reason, and the reason can be changed later', async () => {
    const user = userEvent.setup()
    const { store } = renderApp()

    await importExport(user, { save: true })
    await user.click(card(/Not following back: 60 accounts/))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })
    await user.selectOptions(screen.getByLabelText('Reason to record when you mark accounts'), 'deactivated')
    await user.click(screen.getByRole('button', { name: 'Mark these 25 as unavailable' }))

    expect(screen.getByText('1-25 of 35')).toBeInTheDocument()
    expect(await screen.findByRole('link', { name: /Unavailable\s*25/ })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: /Unavailable\s*25/ }))
    await screen.findByRole('heading', { level: 1, name: 'Unavailable accounts' })

    const dialog = await openFirstAccount(user)
    const reason = within(dialog).getByLabelText(/^Reason for /)

    expect(reason).toHaveValue('deactivated')
    await user.selectOptions(reason, 'blocked')
    expect(reason).toHaveValue('blocked')

    await waitFor(async () => {
      const [saved] = await store.list()

      expect(Object.values(saved.unavailableReasons ?? {}).filter(r => r === 'blocked')).toHaveLength(1)
      expect(Object.values(saved.unavailableReasons ?? {}).filter(r => r === 'deactivated')).toHaveLength(24)
      expect(saved.unavailable).toHaveLength(25)
    })

    // Restoring an account also forgets its reason.
    await user.click(within(dialog).getByRole('button', { name: 'Restore to my figures' }))
    await waitFor(async () => {
      const [saved] = await store.list()

      expect(saved.unavailable).toHaveLength(24)
      expect(Object.keys(saved.unavailableReasons ?? {})).toHaveLength(24)
    })
  })

  it('gives each card a safe Open link and shows brief details in a dialog', async () => {
    const user = userEvent.setup()

    renderApp()
    await importExport(user)
    await user.click(card(/Not following back: 60 accounts/))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })

    const [open] = screen.getAllByRole('link', { name: /^Open .* on Instagram \(new tab\)$/ })

    expect(open).toHaveAttribute('href', expect.stringMatching(/^https:\/\/www\.instagram\.com\/g\d+\/?$/))
    expect(open).toHaveAttribute('target', '_blank')
    expect(open).toHaveAttribute('rel', 'noopener noreferrer')

    const dialog = await openFirstAccount(user)

    expect(within(dialog).getByText('You follow them')).toBeInTheDocument()
    expect(within(dialog).getByText(/^Yes, since /)).toBeInTheDocument()
    expect(within(dialog).getByText('They follow you')).toBeInTheDocument()
    expect(within(dialog).getByText('No')).toBeInTheDocument()
  })

  it('records no reason unless one is chosen', async () => {
    const user = userEvent.setup()
    const { store } = renderApp()

    await importExport(user, { save: true })
    await user.click(card(/Not following back: 60 accounts/))
    await user.click(tickBoxes()[0])

    await waitFor(async () => {
      const [saved] = await store.list()

      expect(saved.unavailable).toHaveLength(1)
      expect('unavailableReasons' in saved).toBe(false)
    })
  })

  it('can mark an account from its details dialog', async () => {
    const user = userEvent.setup()

    renderApp()
    await importExport(user)
    await user.click(card(/Not following back: 60 accounts/))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })

    const dialog = await openFirstAccount(user)

    await user.click(within(dialog).getByRole('button', { name: 'Mark as unavailable' }))

    // The account leaves the list, so its dialog closes with it.
    expect(await screen.findByText('1-25 of 59')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps marks in memory only when nothing was saved', async () => {
    const user = userEvent.setup()
    const { store } = renderApp()

    await importExport(user)
    await user.click(card(/Not following back: 60 accounts/))
    await user.click(tickBoxes()[0])
    await user.click(screen.getByRole('link', { name: /Unavailable\s*1/ }))

    expect(await store.list()).toEqual([])
    expect(await screen.findByText(/kept only while this tab is open; save a snapshot to keep them/i)).toBeInTheDocument()
  })

  it('saves marks with the snapshot, keeps the complete lists, and restores them on reload', async () => {
    const user = userEvent.setup()
    const { store, unmount } = renderApp()

    await importExport(user, { save: true })
    await user.click(card(/Not following back: 60 accounts/))
    await user.click(tickBoxes()[0])
    await user.click(tickBoxes()[0])

    await waitFor(async () => expect((await store.list())[0].unavailable).toHaveLength(2))

    const [saved] = await store.list()

    expect(saved.followers).toHaveLength(40)
    expect(saved.following).toHaveLength(60)
    expect(saved.counts).toEqual({ followers: 40, following: 60 })

    await user.click(screen.getByRole('link', { name: /Unavailable\s*2/ }))
    expect(await screen.findByText(/saved with this snapshot, in this browser only/i)).toBeInTheDocument()

    // A fresh app on the same store opens the snapshot with its marks applied.
    unmount()
    render(tree('/app/dashboard', store))

    expect(await screen.findByRole('link', { name: /Following: 58 following/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Not following back: 58 accounts/ })).toBeInTheDocument()
  })

  it('is cleared from Settings, and the figures return to the full export', async () => {
    const user = userEvent.setup()

    renderApp()
    await importExport(user)
    await user.click(card(/Not following back: 60 accounts/))
    await user.click(tickBoxes()[0])
    await user.click(screen.getByRole('link', { name: 'Settings' }))

    expect(await screen.findByText('Accounts marked unavailable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear unavailable marks' }))
    expect(await screen.findByText(/every account counts in the figures again/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear unavailable marks' })).toBeDisabled()

    await user.click(screen.getByRole('link', { name: 'Overview' }))
    expect(await screen.findByRole('link', { name: /Not following back: 60 accounts/ })).toBeInTheDocument()
  })

  it('never makes a network call beyond the health check', async () => {
    const user = userEvent.setup()

    renderApp()
    await importExport(user, { save: true })
    await user.click(card(/Not following back: 60 accounts/))
    await user.click(tickBoxes()[0])
    await user.click(screen.getByRole('link', { name: /Unavailable\s*1/ }))
    await user.click(screen.getByRole('button', { name: /^Restore / }))

    const calls = (fetch as unknown as { mock: { calls: [string][] } }).mock.calls

    expect(calls.every(([url]) => url === '/api/v1/health/ready')).toBe(true)
  })
})
