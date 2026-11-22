type PropsDotGrid = {
  /** Fraction to light, 0-1. */
  fraction: number
  color: string
  cols?: number
  rows?: number
  label: string
}

/** A small grid of squares filled left to right, top to bottom, like a pixel progress field. */
const DotGrid = ({ fraction, color, cols = 20, rows = 3, label }: PropsDotGrid) => {
  const total = cols * rows
  const lit = Math.round(Math.min(1, Math.max(0, fraction)) * total)

  return (
    <div role='img' aria-label={label} className='ix-dotgrid' style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className='ix-sq' style={i < lit ? { background: color } : undefined} />
      ))}
    </div>
  )
}

export default DotGrid
