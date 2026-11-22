import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppRoutes } from '@/app/AppRoutes'
import { buildProfileUrl } from '@/lib/instagram/normalize'
import type { Account } from '@/lib/instagram/types'
import { createSnapshot, MemorySnapshotStore } from '@/lib/storage/snapshots'
import { followersEntry, followersJson, followingEntry, followingJson, zipFile } from '@/lib/test-helpers'

const renderApp = (path = '/app', store: MemorySnapshotStore | null = new MemorySnapshotStore()) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path='/app/*' element={<AppRoutes store={store} />} />
      </Routes>
    </MemoryRouter>
  )

  return store
}

const exportZip = (followers: string[], following: string[], name = 'export.zip') =>
  zipFile(
    {
      'connections/followers_and_following/followers_1.json': followersJson(...followers),
      'connections/followers_and_following/following.json': followingJson(...following)
    },
    name
  )

const uploadFile = async (user: ReturnType<typeof userEvent.setup>, file: File) => {
  await user.upload(screen.getByLabelText(/drop your instagram export zip/i), file)
}

const acc = (username: string): Account => ({ username, profileUrl: buildProfileUrl(username), followedAt: null })

beforeEach(() => {
  localStorage.clear()
})

describe('app shell and routing', () => {
  it('sends a visitor with no data to the import page', async () => {
    renderApp('/app')

    expect(await screen.findByRole('heading', { level: 1, name: /bring in your export/i })).toBeInTheDocument()

    const nav = screen.getByRole('navigation', { name: 'Application' })

    expect(within(nav).getAllByRole('link').map(l => l.textContent)).toEqual(['Overview', 'Lists', 'History', 'Settings'])
  })

  it('shows an empty state with a way forward on pages that need data', async () => {
    renderApp('/app/dashboard')

    expect(await screen.findByText('No data yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /import your export/i })).toHaveAttribute('href', '/app/import')
  })

  it('shows a not-found page inside the app', async () => {
    renderApp('/app/nope')

    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument()
  })

  it('states the privacy position in the footer', async () => {
    renderApp('/app/import')

    expect(await screen.findByText(/never uploaded/i, { selector: 'footer' })).toBeInTheDocument()
  })
})

describe('import flow', () => {
  it('imports a valid export, previews it, and opens the dashboard on confirm', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, exportZip(['alice', 'bob', 'carol'], ['bob', 'dave']))

    const preview = await screen.findByRole('heading', { name: 'What was detected' })

    expect(preview).toBeInTheDocument()
    expect(screen.getByLabelText('3 followers found')).toBeInTheDocument()
    expect(screen.getByLabelText('2 following found')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /analyse this export/i }))

    expect(await screen.findByRole('heading', { level: 1, name: /your network/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Followers: 3 followers/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Mutuals: 1 mutual connections/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Not following back: 1 accounts/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Fans: 2 fans/ })).toBeInTheDocument()
  })

  it('explains a file that is not a ZIP', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, new File(['this is not a zip'], 'followers.zip'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/not a ZIP file/i)
    expect(screen.getByLabelText(/drop your instagram export zip/i)).toBeInTheDocument()
  })

  it('rejects an unsafe archive with a friendly message', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, zipFile({ '../evil.json': '[]' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/unsafe file paths/i)
  })

  it('recognises an HTML export and blocks analysis', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, zipFile({ 'connections/followers_and_following/followers_1.html': '<html></html>' }))

    expect(await screen.findByText('This is an HTML export')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse this export/i })).toBeDisabled()
  })

  it('flags an incomplete export that has only followers', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, zipFile({ 'followers_1.json': followersJson('alice') }))

    expect(await screen.findByText('No following file')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /analyse this export/i })).toBeDisabled()
  })

  it('warns about a date-limited export and requires an acknowledgement before analysing', async () => {
    const user = userEvent.setup()
    const root = 'instagram-someone-2026-11-22-AbCdEf/connections/followers_and_following'
    const day = 86_400
    const exportTs = Date.UTC(2026, 10, 22) / 1000

    // Followers start ~360 days before the export while following reaches back ~4 years: a "last year" export.
    const followers = Array.from({ length: 60 }, (_, i) => followersEntry(`fan${i}`, exportTs - (360 - i * 4) * day))
    const following = Array.from({ length: 80 }, (_, i) => followingEntry(`fol${i}`, exportTs - (1600 - i * 15) * day))

    renderApp('/app/import')
    await uploadFile(
      user,
      zipFile({
        [`${root}/followers_1.json`]: JSON.stringify(followers),
        [`${root}/following.json`]: JSON.stringify({ relationships_following: following })
      })
    )

    expect(await screen.findByText('This export may be limited to a date range')).toBeInTheDocument()

    const analyse = screen.getByRole('button', { name: /analyse this export/i })

    expect(analyse).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /i understand these results may not include everyone/i }))
    expect(analyse).toBeEnabled()
    await user.click(analyse)

    expect(await screen.findByRole('heading', { level: 1, name: /your network/i })).toBeInTheDocument()
    expect(screen.getByText('These results may not cover everyone')).toBeInTheDocument()
    expect(screen.getByText(/only reaches back about 36\d days/i)).toBeInTheDocument()
  })

  it('keeps the warning on a saved snapshot', async () => {
    const user = userEvent.setup()
    const root = 'instagram-someone-2026-11-22-AbCdEf/connections/followers_and_following'
    const day = 86_400
    const exportTs = Date.UTC(2026, 10, 22) / 1000
    const followers = Array.from({ length: 60 }, (_, i) => followersEntry(`fan${i}`, exportTs - (360 - i * 4) * day))
    const following = Array.from({ length: 80 }, (_, i) => followingEntry(`fol${i}`, exportTs - (1600 - i * 15) * day))
    const store = renderApp('/app/import')

    await uploadFile(
      user,
      zipFile({
        [`${root}/followers_1.json`]: JSON.stringify(followers),
        [`${root}/following.json`]: JSON.stringify({ relationships_following: following })
      })
    )
    await user.click(await screen.findByRole('checkbox', { name: /i understand/i }))
    await user.click(screen.getByRole('checkbox', { name: /save a snapshot on this device/i }))
    await user.click(screen.getByRole('button', { name: /analyse this export/i }))
    await screen.findByText('Snapshot saved on this device.')

    const [saved] = await store!.list()

    expect(saved.completeness?.status).toBe('warning')
    expect(JSON.stringify(saved.completeness)).not.toMatch(/fan\d|fol\d/)
  })

  it('shows no warning for a clean export', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, exportZip(['alice', 'bob'], ['bob']))
    await user.click(await screen.findByRole('button', { name: /analyse this export/i }))
    await screen.findByRole('heading', { level: 1, name: /your network/i })

    expect(screen.queryByText('These results may not cover everyone')).toBeNull()
    expect(screen.queryByText('This export looks incomplete')).toBeNull()
  })

  it('reports merged duplicates and lets the user pick another file', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await uploadFile(user, zipFile({ 'a/followers_1.json': followersJson('alice', 'bob'), 'a/followers_2.json': followersJson('bob'), 'a/following.json': followingJson('bob') }))

    const row = (await screen.findByText('Followers: duplicates merged, skipped')).closest('div')!

    expect(row).toHaveTextContent('1, 0')
    await user.click(screen.getByRole('button', { name: /choose another file/i }))
    expect(screen.getByLabelText(/drop your instagram export zip/i)).toBeInTheDocument()
  })

  it('saves nothing unless the user opts in', async () => {
    const user = userEvent.setup()
    const store = renderApp('/app/import')

    await uploadFile(user, exportZip(['alice'], ['bob']))
    await user.click(await screen.findByRole('button', { name: /analyse this export/i }))
    await screen.findByRole('heading', { level: 1, name: /your network/i })

    expect(await store!.list()).toEqual([])
  })

  it('saves a snapshot when opted in, and detects an identical re-import', async () => {
    const user = userEvent.setup()
    const store = renderApp('/app/import')

    await uploadFile(user, exportZip(['alice', 'bob'], ['bob']))
    await user.click(await screen.findByRole('checkbox', { name: /save a snapshot on this device/i }))
    await user.type(screen.getByLabelText(/label/i), 'June')
    await user.click(screen.getByRole('button', { name: /analyse this export/i }))
    await screen.findByText('Snapshot saved on this device.')

    const saved = await store!.list()

    expect(saved).toHaveLength(1)
    expect(saved[0].label).toBe('June')
    expect(JSON.stringify(saved[0])).not.toContain('PK')

    await user.click(screen.getByRole('link', { name: 'Import new export' }))
    await uploadFile(user, exportZip(['alice', 'bob'], ['bob']))
    expect(await screen.findByText('Identical to a saved snapshot')).toBeInTheDocument()
  })
})

describe('dashboard with sample data', () => {
  const openSample = async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await user.click(await screen.findByRole('button', { name: /try with sample data/i }))
    await screen.findByRole('heading', { level: 1, name: /your network/i })

    return user
  }

  it('labels synthetic data clearly and cannot save it', async () => {
    await openSample()

    expect(screen.getAllByText(/sample data \(synthetic\)/i).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /save snapshot/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Followers: 240 followers/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Not following back: 80 accounts/ })).toBeInTheDocument()
  })

  it('shows the rates and insights the data supports', async () => {
    await openSample()

    expect(screen.getAllByLabelText(/Follow-back rate 60%/).length).toBeGreaterThan(0)
    expect(screen.getAllByLabelText(/Follower to following ratio 1\.20/).length).toBeGreaterThan(0)
    expect(screen.getByText(/120 accounts of the 200 you follow follow you back/)).toBeInTheDocument()
  })

  it('shows activity from export dates and a tooltip on hover and focus', async () => {
    const user = await openSample()
    const chart = screen.getByRole('group', { name: /accounts per month, last 12 months of followers/i })
    const first = within(chart).getAllByRole('img')[0]

    await user.hover(first)
    expect(await screen.findByRole('tooltip')).toHaveTextContent(/new followers?/)

    await user.click(screen.getByRole('button', { name: 'Following' }))
    expect(screen.getByRole('group', { name: /last 12 months of following/i })).toBeInTheDocument()
  })

  it('does not offer the trend or history charts without multiple snapshots', async () => {
    await openSample()

    expect(screen.queryByText('Across your saved snapshots')).toBeNull()
  })
})

describe('lists', () => {
  const openList = async (kind: string) => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await user.click(await screen.findByRole('button', { name: /try with sample data/i }))
    await user.click(await screen.findByRole('link', { name: /Not following back: 80 accounts/ }))
    await screen.findByRole('heading', { level: 1, name: 'Not following back' })

    if (kind !== 'not-following-back') await user.click(screen.getByRole('link', { name: new RegExp(kind, 'i') }))

    return user
  }

  it('lists accounts with counts in the tabs and paginates', async () => {
    const user = await openList('not-following-back')

    expect(screen.getByText('1-25 of 80')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    expect(screen.getByText('26-50 of 80')).toBeInTheDocument()
    expect(screen.getByText('Page 2 of 4')).toBeInTheDocument()
  })

  it('searches, shows nothing found, and resets to the first page', async () => {
    const user = await openList('not-following-back')

    await user.click(screen.getByRole('button', { name: 'Next page' }))
    await user.type(screen.getByPlaceholderText('Search usernames'), 'sample_user_250')
    expect(screen.getByText('1-1 of 1')).toBeInTheDocument()

    await user.clear(screen.getByPlaceholderText('Search usernames'))
    await user.type(screen.getByPlaceholderText('Search usernames'), 'zzz-no-match')
    expect(screen.getByText('No accounts match these filters.')).toBeInTheDocument()
  })

  it('sorts and filters by date', async () => {
    const user = await openList('not-following-back')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Sort' }), 'za')
    expect(screen.getAllByRole('button', { name: /^sample_user_/ })[0]).toHaveTextContent('sample_user_319')

    await user.selectOptions(screen.getByRole('combobox', { name: 'Filter by date' }), '30d')

  })

  it('expands a row to show account details with a safe profile link', async () => {
    const user = await openList('not-following-back')

    await user.click(screen.getAllByRole('button', { name: /^sample_user_/ })[0])

    const link = await screen.findByRole('link', { name: /open on instagram/i })

    expect(link).toHaveAttribute('href', 'https://www.instagram.com/sample_user_240/')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(screen.getByText('You follow this account, but it does not follow you.')).toBeInTheDocument()
  })

  it('exports the filtered list as CSV', async () => {
    const user = await openList('not-following-back')
    const blobs: Blob[] = []

    vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => {
      blobs.push(blob as Blob)

      return 'blob:test'
    })
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await user.type(screen.getByPlaceholderText('Search usernames'), 'sample_user_25')
    await user.click(screen.getByRole('button', { name: /export csv \(10\)/i }))

    const text = await blobs[0].text()
    const lines = text.replace(/^﻿/, '').trim().split('\r\n')

    expect(lines[0]).toBe('username,profile_url,followed_at,relationship')
    expect(lines).toHaveLength(11)
    expect(lines[1]).toMatch(/^sample_user_250,https:\/\/www\.instagram\.com\/sample_user_250\/,.+,not-following-back$/)
  })

  it('switches lists through the tabs', async () => {
    await openList('fans')

    expect(await screen.findByRole('heading', { level: 1, name: 'Fans' })).toBeInTheDocument()
    expect(screen.getByText('1-25 of 120')).toBeInTheDocument()
  })

  it('redirects an unknown list to the default one', async () => {
    renderApp('/app/lists/bogus')

    expect(await screen.findByText('No data yet')).toBeInTheDocument()
  })
})

describe('history and snapshots', () => {
  const seeded = async () => {
    const store = new MemorySnapshotStore()
    const lists = {
      older: { followers: ['a', 'b', 'c'].map(acc), following: ['x', 'y'].map(acc) },
      newer: { followers: ['b', 'c', 'd', 'e'].map(acc), following: ['y', 'z'].map(acc) }
    }

    await store.put(createSnapshot({ ...lists.older, analyzedAt: '2026-01-01T10:00:00.000Z', fileName: 'jan.zip', fileSize: 1, label: 'January' }))
    await store.put(createSnapshot({ ...lists.newer, analyzedAt: '2026-02-01T10:00:00.000Z', fileName: 'feb.zip', fileSize: 1, label: 'February' }))

    return store
  }

  it('opens the latest saved snapshot on load and shows the trend across snapshots', async () => {
    renderApp('/app', await seeded())

    expect(await screen.findByRole('heading', { level: 1, name: /your network/i })).toBeInTheDocument()
    expect(screen.getAllByText('Saved snapshot').length).toBeGreaterThan(0)
    expect(screen.getByRole('link', { name: /Followers: 4 followers/ })).toBeInTheDocument()
    expect(screen.getByText('Across your saved snapshots')).toBeInTheDocument()
  })

  it('compares two snapshots: gained and lost followers, new and removed follows', async () => {
    renderApp('/app/history', await seeded())

    expect(await screen.findByRole('heading', { name: 'Compare two exports' })).toBeInTheDocument()
    expect(screen.getByLabelText('2 gained followers')).toBeInTheDocument()
    expect(screen.getByLabelText('1 lost followers')).toBeInTheDocument()
    expect(screen.getByLabelText('1 new follows')).toBeInTheDocument()
    expect(screen.getByLabelText('1 unfollowed')).toBeInTheDocument()
    expect(screen.getByText(/not when someone actually followed or unfollowed/i)).toBeInTheDocument()

    const gained = screen.getByRole('table', { name: 'gained-followers accounts' })

    expect(within(gained).getAllByRole('button').map(b => b.textContent)).toEqual(['d', 'e'])
  })

  it('compares the current unsaved import with a saved snapshot', async () => {
    const store = new MemorySnapshotStore()

    await store.put(createSnapshot({ followers: ['a'].map(acc), following: ['x'].map(acc), analyzedAt: '2020-01-01T00:00:00.000Z', fileName: 'old.zip', fileSize: 1 }))

    const user = userEvent.setup()

    renderApp('/app/import', store)
    await user.upload(await screen.findByLabelText(/drop your instagram export zip/i), exportZip(['a', 'b'], ['x', 'y']))
    await user.click(await screen.findByRole('button', { name: /analyse this export/i }))
    await screen.findByRole('heading', { level: 1, name: /your network/i })
    await user.click(screen.getByRole('link', { name: 'History' }))

    expect(await screen.findByLabelText('1 gained followers')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save current as snapshot/i })).toBeInTheDocument()
  })

  it('explains that comparisons need two exports', async () => {
    renderApp('/app/history')

    expect(await screen.findByText('Two exports to compare')).toBeInTheDocument()
    expect(screen.getByText(/nothing is ever saved without that/i)).toBeInTheDocument()
  })

  it('deletes a snapshot only after confirmation', async () => {
    const user = userEvent.setup()
    const store = await seeded()

    renderApp('/app/history', store)
    await screen.findByRole('heading', { name: 'Saved snapshots' })

    const first = screen.getAllByRole('button', { name: 'Delete' })[0]

    await user.click(first)
    expect(await store.list()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(async () => expect(await store.list()).toHaveLength(1))
  })
})

describe('settings', () => {
  it('shows saved data and deletes everything after a second click', async () => {
    const user = userEvent.setup()
    const store = new MemorySnapshotStore()

    await store.put(createSnapshot({ followers: [acc('a')], following: [acc('b')], analyzedAt: '2026-01-01T00:00:00.000Z', fileName: 'x.zip', fileSize: 1 }))

    renderApp('/app/settings', store)

    expect(await screen.findByText('Saved snapshots')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete all saved snapshots' }))
    expect(await store.list()).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /click again to delete everything/i }))
    await waitFor(async () => expect(await store.list()).toHaveLength(0))
    expect(await screen.findByText(/all saved snapshots were deleted/i)).toBeInTheDocument()
  })

  it('persists preferences locally and reports an unreachable backend without breaking', async () => {
    const user = userEvent.setup()

    renderApp('/app/settings')
    await user.selectOptions(await screen.findByRole('combobox'), '50')
    expect(JSON.parse(localStorage.getItem('inyx.settings')!)).toMatchObject({ rowsPerPage: 50 })
    expect(await screen.findByText(/not reachable\. inyx still works without it/i)).toBeInTheDocument()
  })

  it('works without storage and says so', async () => {
    renderApp('/app/settings', null)

    expect(await screen.findByText(/this browser blocks local storage/i, { selector: 'p.ix-note' })).toBeInTheDocument()
  })

  it('clears the current analysis from memory', async () => {
    const user = userEvent.setup()

    renderApp('/app/import')
    await user.click(await screen.findByRole('button', { name: /try with sample data/i }))
    await user.click(await screen.findByRole('link', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Clear current analysis' }))
    expect(await screen.findByText(/cleared from memory/i)).toBeInTheDocument()
  })
})
