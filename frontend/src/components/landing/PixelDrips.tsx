import { useMemo } from 'react'

// The hero's heat ramp, coolest first, and where each colour takes over
const PALETTE = ['#8593ea', '#a98ae6', '#e88bb3', '#f5a07a', '#f6d08a']
const THRESHOLDS = [0.3, 0.44, 0.6, 0.76, 0.9]

const COLS = 140
const ROWS = 11

const hash2 = (x: number, y: number, seed: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453

  return n - Math.floor(n)
}

const smooth = (t: number) => t * t * (3 - 2 * t)

const noise2 = (x: number, y: number, seed: number) => {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smooth(x - ix)
  const fy = smooth(y - iy)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)

  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

type CellType = { x: number; y: number; fill: string }

// A still frame of the hero's heat field: dense at the top edge, dripping down in ragged columns
const buildCells = (seed: number) => {
  const cells: CellType[] = []

  for (let x = 0; x < COLS; x++) {
    const ooze = noise2(Math.floor(x / 4) * 0.9 + seed, 3.1, seed + 31)
    const reach = 0.12 + 0.88 * ooze * ooze

    for (let y = 0; y < ROWS; y++) {
      const depth = y / ROWS
      const fray = hash2(x, y, seed + 41) * 0.18

      if (depth > reach - fray) continue

      let heat = 0.42 + (noise2(x * 0.14, y * 0.22, seed) - 0.5) * 0.9 + (1 - depth) * 0.2

      if (hash2(x, y, seed + 7) > 0.97) heat += 0.25

      if (heat < THRESHOLDS[0]) continue

      let band = THRESHOLDS.length - 1

      while (band > 0 && heat < THRESHOLDS[band]) band--

      cells.push({ x, y, fill: PALETTE[band] })
    }
  }

  return cells
}

type PropsPixelDrips = {
  // Picks which arrangement of squares is drawn, so two fields on one page never match
  seed: number
}

/**
 * A static strip of the hero's pixel heat field. It hangs from the top edge of the panel it sits in; the
 * squares keep their shape at any width because the strip is cropped, never stretched
 */
const PixelDrips = ({ seed }: PropsPixelDrips) => {
  const cells = useMemo(() => buildCells(seed), [seed])

  return (
    <svg
      viewBox={`0 0 ${COLS} ${ROWS}`}
      preserveAspectRatio='xMidYMin slice'
      shapeRendering='crispEdges'
      aria-hidden
      className='inyx-drips'
    >
      {cells.map(cell => (
        <rect key={`${cell.x}-${cell.y}`} x={cell.x} y={cell.y} width={0.9} height={0.9} fill={cell.fill} />
      ))}
    </svg>
  )
}

export default PixelDrips
