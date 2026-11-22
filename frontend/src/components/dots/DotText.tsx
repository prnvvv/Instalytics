import { useMemo } from 'react'

import { GLYPH_ROWS, layoutText } from './font'

type PropsDotText = {
  text: string
  /** Size of one dot cell, px. The display scales down to fit narrow containers. */
  dot?: number
  /** Colour of lit dots. */
  color?: string
  /** Show the dark, unlit dots like a real dot-matrix display. */
  showUnlit?: boolean
  className?: string
  /** Accessible text; defaults to `text`. */
  label?: string
}

/** Numerals and short labels drawn as a dot-matrix display, in crisp pixel squares. */
const DotText = ({ text, dot = 6, color = '#f6d08a', showUnlit = true, className, label }: PropsDotText) => {
  const columns = useMemo(() => layoutText(text), [text])
  const width = columns.length

  return (
    <svg
      role='img'
      aria-label={label ?? text}
      viewBox={`0 0 ${width} ${GLYPH_ROWS}`}
      width={width * dot}
      height={GLYPH_ROWS * dot}
      shapeRendering='crispEdges'
      className={className}
      style={{ maxWidth: '100%', height: 'auto' }}
    >
      {columns.map((column, x) =>
        column.map((cell, y) =>
          cell === '1' ? (
            <rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} fill={color} />
          ) : showUnlit ? (
            <rect key={`${x}-${y}`} x={x + 0.08} y={y + 0.08} width={0.84} height={0.84} fill='var(--ix-dot-off, #2b2b2b)' />
          ) : null
        )
      )}
    </svg>
  )
}

export default DotText
