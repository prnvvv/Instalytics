export type DotPart = { value: number; color: string; label: string }

type PropsDotBar = {
  parts: DotPart[]
  /** Number of squares across. */
  segments?: number
  /** Value that fills the whole bar; defaults to the sum of the parts. */
  total?: number
  label: string
}

// Largest-remainder allocation, so the lit squares always add up and a non-zero part always shows.
const allocate = (parts: readonly DotPart[], segments: number, total: number) => {
  if (total <= 0) return parts.map(() => 0)

  const exact = parts.map(p => (Math.max(0, p.value) / total) * segments)
  const counts = exact.map(Math.floor)
  let remaining = Math.min(segments, Math.round(exact.reduce((a, b) => a + b, 0))) - counts.reduce((a, b) => a + b, 0)

  const order = exact.map((value, i) => ({ i, fraction: value - Math.floor(value) })).sort((a, b) => b.fraction - a.fraction)

  for (const { i } of order) {
    if (remaining <= 0) break
    counts[i]++
    remaining--
  }

  // A part that exists but rounded to nothing still gets one square, taken from the largest part.
  parts.forEach((part, i) => {
    if (part.value > 0 && counts[i] === 0) {
      const largest = counts.indexOf(Math.max(...counts))

      if (counts[largest] > 1) {
        counts[largest]--
        counts[i] = 1
      }
    }
  })

  return counts
}

/** A segmented pixel bar: a row of squares split between the parts, the rest dark. */
const DotBar = ({ parts, segments = 24, total, label }: PropsDotBar) => {
  const sum = total ?? parts.reduce((acc, p) => acc + Math.max(0, p.value), 0)
  const counts = allocate(parts, segments, sum)
  const cells: (string | null)[] = []

  counts.forEach((count, i) => {
    for (let n = 0; n < count; n++) cells.push(parts[i].color)
  })

  while (cells.length < segments) cells.push(null)

  return (
    <div role='img' aria-label={label} className='ix-dotbar' style={{ gridTemplateColumns: `repeat(${segments}, 1fr)` }}>
      {cells.map((color, i) => (
        <span key={i} className='ix-sq' style={color ? { background: color } : undefined} />
      ))}
    </div>
  )
}

export default DotBar
