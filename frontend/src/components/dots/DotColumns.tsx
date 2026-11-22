import { useId, useState } from 'react'

export type DotColumn = { key: string; label: string; value: number; tooltip: string }

type PropsDotColumns = {
  columns: DotColumn[]
  color: string
  /** Colour of the tallest column, to pick out the peak. */
  peakColor?: string
  rows?: number
  /** Value range mapped onto the rows. Defaults to 0..max. */
  domain?: [number, number]
  label: string
}

/**
 * A pixel column chart: each column is a stack of squares. Columns are keyboard-focusable, and hovering or
 * focusing one opens a tooltip in the same pixel-pill style as the rest of the app.
 */
const DotColumns = ({ columns, color, peakColor, rows = 8, domain, label }: PropsDotColumns) => {
  const [active, setActive] = useState<number | null>(null)
  const id = useId()

  const values = columns.map(c => c.value)
  const min = domain ? domain[0] : 0
  const max = domain ? domain[1] : Math.max(1, ...values)
  const span = Math.max(1, max - min)
  const peak = Math.max(...values)

  const lit = (value: number) => (value <= min ? 0 : Math.max(1, Math.round(((value - min) / span) * rows)))

  return (
    <div role='group' aria-label={label} className='ix-columns' onMouseLeave={() => setActive(null)}>
      {columns.map((column, i) => {
        const count = Math.min(rows, lit(column.value))
        const isPeak = column.value === peak && peak > min

        return (
          <div
            key={column.key}
            role='img'
            tabIndex={0}
            aria-label={column.tooltip}
            aria-describedby={active === i ? `${id}-tip` : undefined}
            className={active === i ? 'ix-col ix-col-on' : 'ix-col'}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
          >
            <div className='ix-col-stack'>
              {Array.from({ length: rows }, (_, row) => {
                // Rows are drawn top to bottom; the bottom `count` squares are lit.
                const on = row >= rows - count

                return <span key={row} className='ix-sq' style={on ? { background: isPeak && peakColor ? peakColor : color } : undefined} />
              })}
            </div>
            <span className='ix-col-label'>{column.label}</span>
            {active === i && (
              <span id={`${id}-tip`} role='tooltip' className='ix-tip'>
                {column.tooltip}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default DotColumns
