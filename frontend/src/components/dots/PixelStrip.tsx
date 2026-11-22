// The landing page's heat ramp, coolest first.
const RAMP = ['#8593ea', '#a98ae6', '#e88bb3', '#f5a07a', '#f6d08a']

type PropsPixelStrip = {
  /** How many squares to draw. */
  count?: number
  /** Which colours may appear; defaults to the whole ramp. */
  colors?: readonly string[]
  /** Changes the pattern without changing its character. */
  seed?: number
  className?: string
}

/**
 * A row of pixel squares in the landing page's heat colours, fading out to the right like its pixel field.
 * Purely decorative: the pattern is fixed by the seed, never random.
 */
const PixelStrip = ({ count = 18, colors = RAMP, seed = 0, className }: PropsPixelStrip) => (
  <span aria-hidden className={className ? `ix-pxstrip ${className}` : 'ix-pxstrip'} style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}>
    {Array.from({ length: count }, (_, i) => {
      // A small integer hash: stable, and spread well enough to look scattered.
      const hash = Math.imul(i + 1 + seed * 7, 2654435761) >>> 0
      const lit = (hash >>> 8) % count > i * 0.9
      const color = colors[(hash >>> 4) % colors.length]

      return <i key={i} style={lit ? { background: color } : undefined} />
    })}
  </span>
)

export default PixelStrip
