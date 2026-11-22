import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import LandingPage from '@/pages/LandingPage'

describe('LandingPage', () => {
  it('exposes the headline to assistive technology as one sentence', () => {
    render(<LandingPage />)

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Your Instagram, decoded.')
  })

  it('links the page navigation to sections that exist', () => {
    const { container } = render(<LandingPage />)
    const pages = screen.getByRole('navigation', { name: 'Pages' })

    for (const link of within(pages).getAllByRole('link')) {
      const target = link.getAttribute('href')!

      expect(target.startsWith('#')).toBe(true)
      expect(container.querySelector(target)).not.toBeNull()
    }
  })

  it('points every in-page link at an existing section', () => {
    const { container } = render(<LandingPage />)

    for (const link of container.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) {
      expect(container.querySelector(link.getAttribute('href')!), link.textContent).not.toBeNull()
    }
  })

  it('has no links that leave the site', () => {
    const { container } = render(<LandingPage />)

    expect(container.querySelectorAll('a[href^="http"]')).toHaveLength(0)
  })

  it('states the privacy promises and never asks for credentials', () => {
    const { container } = render(<LandingPage />)

    expect(screen.getByRole('heading', { name: 'No Instagram login' })).toBeInTheDocument()
    expect(container.querySelector('input, form')).toBeNull()
  })

  it('carries the INYX branding and privacy line', async () => {
    const user = userEvent.setup()

    render(<LandingPage />)
    await user.click(screen.getByRole('button', { name: /info\.exe/i }))

    expect(screen.getByText('INYX')).toBeInTheDocument()
    expect(screen.getByText('No login. No credentials. Just your data.', { selector: '.sr-only' })).toBeInTheDocument()
    expect(screen.queryByText(/kiln/i)).toBeNull()
  })

  it('does not present invented testimonials or availability claims', () => {
    render(<LandingPage />)

    expect(screen.queryByText(/slots? left/i)).toBeNull()
    expect(screen.queryByText(/what clients say/i)).toBeNull()
  })

  it('folds and unfolds the info window', async () => {
    const user = userEvent.setup()

    render(<LandingPage />)

    const toggle = screen.getByRole('button', { name: /info\.exe/i })

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })

  it('steps the background intensity within its limits', async () => {
    const user = userEvent.setup()

    render(<LandingPage />)

    const hotter = screen.getByRole('button', { name: 'Intensify the background' })
    const cooler = screen.getByRole('button', { name: 'Calm the background' })

    expect(hotter).toBeEnabled()
    await user.click(hotter)
    expect(hotter).toBeDisabled()
    await user.click(cooler)
    await user.click(cooler)
    expect(cooler).toBeDisabled()
  })

  it('toggles the crawling word', async () => {
    const user = userEvent.setup()

    render(<LandingPage />)

    await user.click(screen.getByRole('button', { name: 'Stop the word' }))
    expect(screen.getByRole('button', { name: 'Start the word' })).toBeInTheDocument()
  })
})
