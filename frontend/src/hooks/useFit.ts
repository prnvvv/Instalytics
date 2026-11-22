import { useEffect, useState, type RefObject } from 'react'

/**
 * The app is a fixed, no-scroll layout on screens that are big enough for it, and scrolls normally on phones and
 * short windows. This query must match the one in styles/app.css.
 */
export const FIT_QUERY = '(min-width: 1000px) and (min-height: 600px)'

const matches = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(FIT_QUERY).matches

/** Whether the no-scroll layout is active right now. */
export const useFitLayout = () => {
  const [fit, setFit] = useState(matches)

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return

    const query = window.matchMedia(FIT_QUERY)
    const update = () => setFit(query.matches)

    update()
    query.addEventListener('change', update)

    return () => query.removeEventListener('change', update)
  }, [])

  return fit
}

export type Size = { width: number; height: number }

/** The content size of an element, kept up to date. Zero until measured, and always zero without ResizeObserver. */
export const useElementSize = (ref: RefObject<HTMLElement | null>): Size => {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })

  useEffect(() => {
    const element = ref.current

    if (!element || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect

      if (box) setSize(current => (current.width === Math.round(box.width) && current.height === Math.round(box.height) ? current : { width: Math.round(box.width), height: Math.round(box.height) }))
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [ref])

  return size
}
