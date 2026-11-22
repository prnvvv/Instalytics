import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

type PropsDialog = {
  open: boolean
  onClose: () => void
  title: string
  /** A short line under the title. */
  description?: string
  children: ReactNode
  /** A wider panel, for dialogs that hold a chart or a table. */
  wide?: boolean
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

/**
 * A modal dialog in the app's own style. It traps focus, closes on Escape or a click outside, and hands focus back
 * to whatever opened it. It scrolls inside itself, so the page behind never moves.
 */
const Dialog = ({ open, onClose, title, description, children, wide = false }: PropsDialog) => {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    const previous = document.activeElement as HTMLElement | null

    panel.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()

        return
      }

      if (event.key !== 'Tab' || !panel.current) return

      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)]

      if (items.length === 0) {
        event.preventDefault()

        return
      }

      const first = items[0]
      const last = items[items.length - 1]

      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className='ix-backdrop'
      onMouseDown={event => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panel}
        role='dialog'
        aria-modal='true'
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={wide ? 'ix-modal ix-modal-wide' : 'ix-modal'}
      >
        <div className='ix-modal-head'>
          <div>
            <h2 id={titleId} className='ix-h2'>
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className='ix-note' style={{ marginTop: 4 }}>
                {description}
              </p>
            )}
          </div>
          <button type='button' className='ix-btn ix-btn-icon' aria-label='Close' onClick={onClose}>
            <X aria-hidden size={16} />
          </button>
        </div>
        <div className='ix-modal-body'>{children}</div>
      </div>
    </div>
  )
}

export default Dialog
