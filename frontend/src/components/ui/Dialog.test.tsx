import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import Dialog from './Dialog'

const Harness = () => {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button type='button' onClick={() => setOpen(true)}>
        Open it
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title='A dialog' description='About it'>
        <button type='button'>First</button>
        <button type='button'>Second</button>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('renders nothing while closed and a labelled modal dialog when open', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open it' }))

    const dialog = screen.getByRole('dialog', { name: 'A dialog' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleDescription('About it')
    expect(dialog).toHaveFocus()
  })

  it('closes on Escape and hands focus back to what opened it', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('button', { name: 'Open it' })).toHaveFocus()
  })

  it('closes with the Close button and on a click outside, but not on a click inside', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.click(screen.getByRole('button', { name: 'First' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Open it' }))
    await user.pointer({ keys: '[MouseLeft]', target: screen.getByRole('dialog').parentElement! })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps Tab inside the dialog in both directions', async () => {
    const user = userEvent.setup()

    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Open it' }))

    const close = screen.getByRole('button', { name: 'Close' })
    const second = screen.getByRole('button', { name: 'Second' })

    second.focus()
    await user.tab()
    expect(close).toHaveFocus()

    await user.tab({ shift: true })
    expect(second).toHaveFocus()
  })
})
