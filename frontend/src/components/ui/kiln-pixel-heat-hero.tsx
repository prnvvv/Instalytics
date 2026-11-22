import {
  Fragment,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
  type SVGProps
} from 'react'
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { ArrowUpRight, Eye, EyeClosed, Minus, Pause, Play, Plus } from 'lucide-react'
import { preconnect } from 'react-dom'

const BRAND = {
  // The product name, shown bold at the start of the info window
  name: 'INYX'
}

// Motion's ease-out used by every entrance
const EASE_OUT = [0.22, 1, 0.36, 1] as const

// The curve the nav windows open and close on: quick to start, long soft landing
const WINDOW_EASE = [0.32, 0.72, 0, 1] as const

const COPY = {
  /**
   * The headline, bottom left, one array per line; the stylesheet sets it in capitals. A segment marked pixel
   * is set in the pixel face even at rest. Spaces belong to the segments, so punctuation can sit flush
   */
  title: [[{ text: 'Your Instagram,' }], [{ text: 'decoded', pixel: true }, { text: '.' }]]
}

/**
 * The giant word the heat spells as it crawls sideways through the field. It reads the brand at rest and
 * switches to a link's own word while that link in the bottom bar is hovered or focused
 */
const MARQUEE = {
  text: 'INYX',

  // How fast the letters travel, squares per second. Higher = quicker crawl
  speed: 8,

  // Empty squares between one pass of the word and the next
  gap: 18,

  // Letter height as a share of the band above the drips, 0–1. Lower = smaller word
  height: 0.5,

  // At least this many letters always fit across the panel, so narrow screens get smaller, readable letters
  across: 4,

  // How hot the letters burn, on the HEAT scale. 0.8 = orange, 0.92 = yellow
  heat: 0.84,

  // How far the squares right around each letter are cooled, so the word reads against the clouds
  outline: 0.16
}

const NAV = {
  // The page links, shown as the toggle in the middle of the bottom bar. spell is what the field writes on hover
  links: [
    { label: 'Index', href: '#home', spell: 'INYX' },
    { label: 'How it works', href: '#how-it-works', spell: 'DECODE' },
    { label: 'Privacy', href: '#privacy', spell: 'PRIVATE' }
  ],

  // The one action at the top right
  action: { label: 'Get started', href: '#how-it-works' },

  // How far the page scrolls before the nav frosts and the windows fold shut, px
  scrollThreshold: 12
}

/**
 * The pill beside the action: − and + step the background's intensity, the middle key stops and starts the
 * word crawling through the field, and a line of dot-matrix text crawls past
 */
const STATUS = {
  message: 'No login. No credentials. Just your data.',

  // Seconds for one lap of the crawl. Higher = slower
  lap: 9
}

/**
 * The card beside the headline, from 1024px up: one topic open at a time, stepping on by itself
 */
const INSIGHTS = {
  label: 'Connection insights',
  status: 'Privacy-first',
  items: [
    {
      name: 'Followers',
      line: 'Everyone who follows you, searchable and one tap from their profile.',
      href: '#how-it-works'
    },
    {
      name: 'Following',
      line: 'Every account you follow, sorted and filterable in one place.',
      href: '#how-it-works'
    },
    { name: 'Mutuals', line: 'The connections that follow you back, and nothing more.', href: '#how-it-works' },
    {
      name: 'One-sided',
      line: 'Who you follow that does not follow back, and the other way round.',
      href: '#how-it-works'
    }
  ],
  footer: { note: 'No credentials, ever', link: { label: 'How it works', href: '#how-it-works' } },

  // Seconds each topic stays open before the next. Hovering or focusing the card holds it
  hold: 3.6,

  // Width of the card, px. The headline shrinks to leave this much room (plus the gap) on its right
  width: 320,
  gap: 32
}

const INFO = {
  // The label on the window's title bar
  label: 'Info.exe',

  // Follows the bold product name inside the window
  statement:
    'is Instagram analytics, decoded. Follower insights and connection analysis from the data export you download yourself. No login. No credentials. Just your data.',

  // Widest the window opens, px. On phones it takes the row's full width instead
  width: 420
}

const STEPS = {
  label: 'How it works',
  intro: 'Three steps from export to insight. No login.',
  items: [
    { title: 'Request your export', detail: 'From Instagram, in JSON format', href: '#how-it-works' },
    { title: 'Upload the ZIP', detail: 'Checked before it is read', href: '#how-it-works' },
    { title: 'Decode your network', detail: 'Followers, following, mutuals', href: '#how-it-works' }
  ],

  // How wide the window opens, px
  width: 320
}

/**
 * The heat colours, coolest first: periwinkle, lavender, pink, coral, butter. All sit at a similar mid-light
 * value with no near-black, so neighbouring squares never flash hard contrast at the eye. A cell
 * cooler than the first threshold is left empty; each threshold after that is where the next colour takes over
 */
const HEAT = {
  palette: ['#8593ea', '#a98ae6', '#e88bb3', '#f5a07a', '#f6d08a'],
  thresholds: [0.3, 0.44, 0.6, 0.76, 0.9]
}

/**
 * The steps − and + move the background through, in the pill beside the action. heat warms (+) or cools (−)
 * the whole field, speed scales how fast the clouds drift, touch scales how strongly the pointer, clicks and
 * hot cores work on it. start picks the step the hero opens on
 */
const INTENSITY = {
  levels: [
    { heat: -0.08, speed: 0.6, touch: 0.7 },
    { heat: 0, speed: 1, touch: 1 },
    { heat: 0.09, speed: 1.7, touch: 1.45 }
  ],
  start: 1,

  // Seconds the field takes to settle into a new step
  ease: 0.6
}

const FIELD = {
  // Size of one pixel square, px. Smaller = finer, busier field
  cell: 10,

  // The white line between squares, px
  gap: 1,

  // How often the field redraws, per second. Lower feels more like pixel art, higher is smoother
  fps: 30,

  // How fast the heat drifts. 1 = calm, 2 = twice as lively
  speed: 1,

  // Size of a heat cloud, px. Bigger = broader patches of one colour
  blob: 300,

  // The clouds' resting heat on the HEAT scale. 0.42 sits in violet; raise it for more magenta everywhere
  warmth: 0.42,

  // How sharply the clouds separate into colours. Higher = more contrast, more empty holes
  contrast: 0.9,

  /**
   * The hottest the drifting clouds alone can get, on the HEAT scale. Kept under orange so orange and yellow
   * only appear in the letters, the wandering cores and under the pointer, never as whole regions
   */
  cloudCap: 0.72,

  // Extra heat at the top of the field, fading to none at the drips. Higher = denser top, fewer holes
  body: 0.1,

  // Speckle where two colours meet, 0–0.2. 0 = clean borders, 0.12 = crunchy. Low keeps the field calm to look at
  grain: 0.05,

  // How many times a second the speckle (and the drips' frayed edge) reshuffles. Low = less flicker
  flicker: 1.2,

  // Seconds the field takes to drip down into place when the page opens
  reveal: 1.4
}

const EDGE = {
  // Clear space kept between the lowest pixel and the copy, px
  gapAboveCopy: 32,

  // How far the ragged bottom edge reaches up into the field, px. Deeper = longer drips
  drip: 160,

  // The same on phones (below 640px)
  dripPhone: 100,

  // Width of one drip, in squares. Bigger = chunkier, fewer drips
  dripWidth: 4,

  // How fast the drips grow and shrink. 1 = slow ooze
  dripSpeed: 1
}

const FLAMES = {
  // The slow hot cores that wander through the field
  count: 2,

  // Radius of one core, px
  size: 160,

  // How hot a core burns, 0–0.6. Higher = more orange and yellow at its centre
  strength: 0.36,

  // How fast the cores travel. 1 = slow drift
  speed: 1
}

const CURSOR = {
  // Radius of the heat the pointer leaves behind, px
  size: 96,

  // How hot the pointer's trail burns, 0–0.6. 0.45 lights orange and yellow at its centre
  strength: 0.45,

  // How hot the wandering ghost brush burns while the pointer rests, 0–0.6
  ghost: 0.24,

  // Share of the heat kept each frame. 0.97 = long glowing trail, 0.9 = quick fade
  cool: 0.972,

  // A click or tap sends out a ring of heat: its widest reach and how long it takes, px and seconds
  burstReach: 340,
  burstTime: 1.1,

  // Seconds of stillness before a ghost brush starts wandering the field (on touch screens it always wanders)
  idleAfter: 2.5
}

type PropsBottomBar = {
  // Called with a link's word while it is hovered or focused, and with null when it lets go
  onSpell: (text: string | null) => void
}

/**
 * The bar under the panel: the page links as a toggle in the middle. The toggle's dark marker rests on the
 * current link and slides to whichever is hovered or focused, and the field spells that link's word
 * meanwhile. The bar measures itself so the panel above fills exactly what the nav and this bar leave
 */
const BottomBar = ({ onSpell }: PropsBottomBar) => {
  // States
  const [current, setCurrent] = useState<string>(NAV.links[0].label)
  const [hovered, setHovered] = useState<string | null>(null)

  // Refs
  const barRef = useRef<HTMLDivElement>(null)

  // Vars
  const marked = hovered ?? current

  useEffect(() => {
    const bar = barRef.current
    const root = bar?.parentElement

    if (!bar || !root) return

    const measure = () => {
      root.style.setProperty('--kln-bar-space', `${bar.offsetHeight}px`)
    }

    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(bar)

    return () => observer.disconnect()
  }, [])

  const handleEnter = (label: string, spell: string) => () => {
    setHovered(label)
    onSpell(spell)
  }

  const handleLeave = () => {
    setHovered(null)
    onSpell(null)
  }

  const handleSelect = (label: string) => () => {
    setCurrent(label)
  }

  return (
    <motion.div
      ref={barRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.5, ease: EASE_OUT }}
      className='kln-bar kln-frame'
    >
      <nav aria-label='Pages' className='kln-tabs'>
        <ul onPointerLeave={handleLeave} className='flex gap-0.5'>
          {NAV.links.map(link => (
            <li key={link.label}>
              <a
                href={link.href}
                aria-current={link.label === current ? 'page' : undefined}
                onPointerEnter={handleEnter(link.label, link.spell)}
                onFocus={handleEnter(link.label, link.spell)}
                onBlur={handleLeave}
                onClick={handleSelect(link.label)}
                className={cn('kln-tab', marked === link.label && 'kln-tab-on')}
              >
                {marked === link.label && (
                  <motion.span
                    layoutId='kln-tab-marker'
                    transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                    className='kln-tab-marker'
                  />
                )}
                <span className='relative'>{link.label}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </motion.div>
  )
}

// A repeatable 0–1 value for an integer cell, so the same square always gets the same speckle on a given beat
const hash2 = (x: number, y: number, seed: number) => {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453

  return n - Math.floor(n)
}

const smooth = (t: number) => t * t * (3 - 2 * t)

// Value noise: hashed lattice corners blended with a smoothstep, so neighbouring cells share their heat
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

/**
 * Three octaves of noise, each drifting its own way over time, behind a soft domain warp so the clouds curl
 * rather than slide. Returns roughly 0–1 with its middle at 0.5
 */
const heatClouds = (x: number, y: number, t: number, seed: number) => {
  const wx = x + (noise2(x * 0.45 + t * 0.06, y * 0.45, seed + 3) - 0.5) * 1.3
  const wy = y + (noise2(x * 0.45, y * 0.45 - t * 0.05, seed + 7) - 0.5) * 1.3

  const a = noise2(wx + t * 0.11, wy - t * 0.07, seed)
  const b = noise2(wx * 2.1 - t * 0.17, wy * 2.1 + t * 0.09, seed + 11)
  const c = noise2(wx * 4.3 + t * 0.23, wy * 4.3 + t * 0.19, seed + 19)

  return a * 0.58 + b * 0.29 + c * 0.13
}

// '#rrggbb' as one little-endian RGBA word, the layout ImageData's Uint32 view expects
const packColour = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)

  return ((255 << 24) | ((n & 255) << 16) | (((n >> 8) & 255) << 8) | ((n >> 16) & 255)) >>> 0
}

type PropsHeatField = {
  copyRef: RefObject<HTMLDivElement | null>

  // Whether the spelled word crawls; the rest of the field keeps moving either way
  playing: boolean

  // Which INTENSITY step the background runs at
  intensity: number
  text: string
}

type WaveType = { x: number; y: number; age: number }

type ControlsType = { sync: () => void; draw: () => void; spell: () => void }

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * A grid of square pixels coloured by heat, read like a thermal camera: drifting noise clouds, wandering hot
 * cores, the pointer's trail and the product's name burning through in giant letters that crawl sideways
 * (pause stops only the letters; intensity changes how hot, fast and touchable everything else is).
 * The field fills the panel from the top and drips off, full width, just above the copy
 */
const HeatField = ({ copyRef, playing, intensity, text }: PropsHeatField) => {
  // Refs
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const liveRef = useRef({ playing, intensity, text })
  const controlsRef = useRef<ControlsType | null>(null)

  useEffect(() => {
    liveRef.current.playing = playing
    controlsRef.current?.sync()
  }, [playing])

  useEffect(() => {
    liveRef.current.intensity = intensity
    controlsRef.current?.draw()
  }, [intensity])

  useEffect(() => {
    liveRef.current.text = text
    controlsRef.current?.spell()
  }, [text])

  useEffect(() => {
    const canvas = canvasRef.current
    const panel = canvas?.parentElement
    const ctx = canvas?.getContext('2d')
    const off = document.createElement('canvas')
    const offCtx = off.getContext('2d')

    if (!canvas || !panel || !ctx || !offCtx) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches
    const palette = HEAT.palette.map(packColour)
    const seed = Math.random() * 100
    const cell = FIELD.cell

    // The grid is centred in the panel, so the columns cut by its left and right edges are equal and mostly whole
    let gridX = 0

    let width = 0
    let height = 0
    let cols = 0
    let rows = 0
    let heat = new Float32Array(0)
    let image: ImageData | null = null
    let pixels = new Uint32Array(0)
    let floorPx = 0
    let dripPx: number = EDGE.drip

    // The word as a cell-sized stencil: 2 = letter, 1 = the ring of squares around it, 0 = clear
    const stencil = document.createElement('canvas')
    const stencilCtx = stencil.getContext('2d', { willReadFrequently: true })
    let mask = new Uint8Array(0)
    let maskW = 0
    let bandTop = 0
    let bandRows = 0

    // Shifts the crawl so a newly spelled word starts just past the right edge instead of popping in mid-screen
    let shift = 0

    // How far the word has crawled, in squares; it only advances while the word is playing
    let crawlPos = seed * MARQUEE.speed

    // The intensity the field is actually running at, easing toward the chosen step so a change never jumps
    const level = { ...INTENSITY.levels[liveRef.current.intensity] }

    let time = seed
    let revealTime: number = reduce ? FIELD.reveal : 0
    let last = 0
    let pending = 0
    let raf = 0
    let running = false
    let onScreen = true

    let pointerX = -1
    let pointerY = -1
    let lastMove = -Infinity
    let ghostX = -1
    let ghostY = -1
    const waves: WaveType[] = []

    // Rasterises the current word at one canvas pixel per cell, then marks the ring of cells around each letter
    const spell = () => {
      const text = liveRef.current.text

      if (!stencilCtx || bandRows < 5) {
        maskW = 0

        return
      }

      const size = Math.round(bandRows / 0.72)
      const font = `600 ${size}px "Host Grotesk", ui-sans-serif, system-ui, sans-serif`

      stencilCtx.font = font
      maskW = Math.ceil(stencilCtx.measureText(text).width) + 2
      stencil.width = maskW
      stencil.height = bandRows
      stencilCtx.font = font
      stencilCtx.textBaseline = 'alphabetic'
      stencilCtx.fillStyle = '#000'
      stencilCtx.fillText(text, 1, bandRows)

      const alpha = stencilCtx.getImageData(0, 0, maskW, bandRows).data

      mask = new Uint8Array(maskW * bandRows)

      for (let i = 0; i < mask.length; i++) if (alpha[i * 4 + 3] > 110) mask[i] = 2

      // The outline thickens with the letters, so giant letters keep a ring wide enough to read
      const ring = Math.max(1, Math.round(bandRows / 14))

      for (let y = 0; y < bandRows; y++) {
        for (let x = 0; x < maskW; x++) {
          const i = y * maskW + x

          if (mask[i] !== 0) continue

          for (let dy = -ring; dy <= ring && mask[i] === 0; dy++) {
            for (let dx = -ring; dx <= ring; dx++) {
              const nx = x + dx
              const ny = y + dy

              if (nx >= 0 && ny >= 0 && nx < maskW && ny < bandRows && mask[ny * maskW + nx] === 2) {
                mask[i] = 1
                break
              }
            }
          }
        }
      }
    }

    const measure = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)

      width = panel.clientWidth
      height = panel.clientHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false

      const nextCols = Math.ceil(width / cell)
      const nextRows = Math.ceil(height / cell)

      gridX = Math.round((width - nextCols * cell) / 2)
      panel.style.setProperty('--kln-grid-x', `${gridX}px`)

      if (nextCols !== cols || nextRows !== rows) {
        cols = nextCols
        rows = nextRows
        off.width = cols
        off.height = rows
        image = offCtx.createImageData(cols, rows)
        pixels = new Uint32Array(image.data.buffer)
        heat = new Float32Array(cols * rows)
      }

      /**
       * The drips stop above the headline itself, not the taller card beside it, which sits over the
       * field's lower edge. offsetTop ignores transforms, so the entrance slides can't skew the floor
       */
      const copy = copyRef.current
      const headline = copy?.querySelector('h1')
      const copyTop = copy ? copy.offsetTop + (headline?.offsetTop ?? 0) : height * 0.62

      floorPx = Math.max(cell * 6, copyTop - EDGE.gapAboveCopy)
      dripPx = Math.min(width < 640 ? EDGE.dripPhone : EDGE.drip, floorPx * 0.4)

      // The word runs in the full-width band above the drips
      const laneRows = Math.floor((floorPx - dripPx) / cell) - 2

      // A letter runs about 0.86 of its height wide, which caps the height on narrow panels
      const fitRows = Math.floor(width / cell / (0.86 * MARQUEE.across))

      bandRows = Math.min(Math.floor(laneRows * MARQUEE.height), fitRows)
      bandTop = 1 + Math.floor((laneRows - bandRows) / 2)

      spell()
    }

    // A soft round dab of heat (panel px) that raises cells to its level, so a lingering brush never boils over
    const deposit = (x: number, y: number, amount: number, radius: number) => {
      const cx = (x - gridX) / cell
      const cy = y / cell
      const r = radius / cell
      const inv = 1 / (2 * (r * 0.5) * (r * 0.5))
      const c0 = Math.max(0, Math.floor(cx - r))
      const c1 = Math.min(cols - 1, Math.ceil(cx + r))
      const r0 = Math.max(0, Math.floor(cy - r))
      const r1 = Math.min(rows - 1, Math.ceil(cy + r))

      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const dx = col + 0.5 - cx
          const dy = row + 0.5 - cy
          const w = Math.exp(-(dx * dx + dy * dy) * inv)

          if (w < 0.02) continue

          const i = row * cols + col

          heat[i] = Math.max(heat[i], amount * w)
        }
      }
    }

    // Dabs along a segment so a fast flick leaves a continuous trail instead of spaced dots
    const stroke = (x0: number, y0: number, x1: number, y1: number, amount: number) => {
      const steps = Math.max(1, Math.min(40, Math.round(Math.hypot(x1 - x0, y1 - y0) / (cell * 0.8))))

      for (let s = 1; s <= steps; s++) {
        const f = s / steps

        deposit(x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, amount, CURSOR.size * (0.7 + 0.3 * level.touch))
      }
    }

    const render = () => {
      if (!image) return

      const reveal = easeOut(Math.min(1, revealTime / FIELD.reveal))
      const floor = floorPx * reveal
      const zoneTop = floor - dripPx
      const unit = FIELD.blob / cell
      const speckleBeat = Math.floor(time * FIELD.flicker)
      const edgeBeat = Math.floor(time * FIELD.flicker * 0.5)
      const thresholds = HEAT.thresholds
      const flameR = FLAMES.size / cell
      const flameInv = 1 / (2 * flameR * flameR * 0.25)
      const flames: number[] = []

      for (let f = 0; f < FLAMES.count; f++) {
        const s = FLAMES.speed

        flames.push(
          (width / cell) * (0.5 + 0.42 * Math.sin(time * 0.13 * s * (1 + f * 0.37) + f * 2.1)),
          (floorPx / cell) * (0.36 + 0.24 * Math.sin(time * 0.11 * s * (1 + f * 0.23) + f * 1.3 + 1))
        )
      }

      // Auto-exposure: a coarse sample of the clouds re-centres them on FIELD.warmth, so every seed and moment mixes alike
      const fieldRows = Math.max(1, floorPx / cell)
      let sampled = 0

      for (let sy = 0; sy < 8; sy++) {
        for (let sx = 0; sx < 16; sx++) {
          sampled += heatClouds(((sx + 0.5) / 16) * (cols / unit), ((sy + 0.5) / 8) * (fieldRows / unit), time, seed)
        }
      }

      const centre = sampled / 128

      // The word crawls left: each column reads the stencil this many squares further along, wrapping every period
      const period = maskW + MARQUEE.gap
      const crawl = Math.floor(crawlPos)

      for (let row = 0; row < rows; row++) {
        const y = (row + 0.5) * cell
        const base = row * cols

        if (y > floor) {
          pixels.fill(0, base, base + cols)
          continue
        }

        const inZone = y > zoneTop
        const depth = inZone ? (y - zoneTop) / dripPx : 0
        const body = FIELD.body * (1 - y / Math.max(floor, 1))
        const stencilRow = maskW > 0 && row >= bandTop && row < bandTop + bandRows ? (row - bandTop) * maskW : -1

        for (let col = 0; col < cols; col++) {
          const i = base + col
          let h = Math.min(
            FIELD.cloudCap,
            (heatClouds(col / unit, row / unit, time, seed) - centre) * FIELD.contrast + FIELD.warmth
          )

          for (let f = 0; f < flames.length; f += 2) {
            const dx = col - flames[f]
            const dy = row - flames[f + 1]

            h += FLAMES.strength * level.touch * Math.exp(-(dx * dx + dy * dy) * flameInv)
          }

          h += body + heat[i] + level.heat + (hash2(col, row, seed + speckleBeat) - 0.5) * FIELD.grain * 2

          if (stencilRow >= 0) {
            const u = (col + crawl + shift) % period
            const mark = u < maskW ? mask[stencilRow + u] : 0

            // Letters stay orange and their ring stays below magenta, so the word reads at every intensity
            if (mark === 2) h = Math.min(Math.max(h + 0.1, MARQUEE.heat), thresholds[4] - 0.01)
            else if (mark === 1) h = Math.min(h - MARQUEE.outline, thresholds[2] - 0.02)
          }

          if (inZone) {
            const group = Math.floor(col / EDGE.dripWidth)
            const ooze = noise2(group * 0.9 + seed, time * 0.12 * EDGE.dripSpeed, seed + 31)
            const reach = 0.1 + 0.95 * ooze * ooze + heat[i] * 0.6
            const fray = hash2(col, row, seed + 41 + edgeBeat) * 0.2

            if (depth > reach - fray) {
              pixels[i] = 0
              continue
            }

            h -= depth * 0.12
          }

          if (h < thresholds[0]) {
            pixels[i] = 0
            continue
          }

          let band = thresholds.length - 1

          while (band > 0 && h < thresholds[band]) band--

          pixels[i] = palette[band]
        }
      }

      offCtx.putImageData(image, 0, 0)
      ctx.clearRect(0, 0, width, height)
      ctx.drawImage(off, gridX, 0, cols * cell, rows * cell)

      // The white seams between squares are cleared out of the canvas so the panel's faint grid shows through
      const gap = FIELD.gap
      const seamDepth = Math.min(height, floor + cell)

      for (let col = 1; col <= cols; col++) ctx.clearRect(gridX + col * cell - gap, 0, gap, seamDepth)

      for (let row = 1; row * cell - gap < seamDepth; row++) ctx.clearRect(0, row * cell - gap, width, gap)
    }

    const step = (dt: number) => {
      const goal = INTENSITY.levels[liveRef.current.intensity]
      const follow = 1 - Math.exp(-dt / (INTENSITY.ease / 3))

      level.heat += (goal.heat - level.heat) * follow
      level.speed += (goal.speed - level.speed) * follow
      level.touch += (goal.touch - level.touch) * follow
      time += dt * FIELD.speed * level.speed
      revealTime += dt

      if (liveRef.current.playing) crawlPos += dt * MARQUEE.speed

      const keep = Math.pow(CURSOR.cool, dt * 60)

      for (let i = 0; i < heat.length; i++) heat[i] *= keep

      const idle = !finePointer || performance.now() - lastMove > CURSOR.idleAfter * 1000

      if (idle) {
        const targetX = width * (0.5 + 0.4 * Math.sin(time * 0.31))
        const targetY = floorPx * (0.42 + 0.3 * Math.sin(time * 0.47 + 1))

        if (ghostX < 0) {
          ghostX = pointerX >= 0 ? pointerX : targetX
          ghostY = pointerY >= 0 ? pointerY : targetY
        }

        const follow = 1 - Math.exp(-dt * 1.2)
        const nextX = ghostX + (targetX - ghostX) * follow
        const nextY = ghostY + (targetY - ghostY) * follow

        stroke(ghostX, ghostY, nextX, nextY, Math.min(0.6, CURSOR.ghost * level.touch))
        ghostX = nextX
        ghostY = nextY
      } else {
        ghostX = -1
      }

      for (let w = waves.length - 1; w >= 0; w--) {
        const wave = waves[w]

        wave.age += dt

        const p = wave.age / CURSOR.burstTime

        if (p >= 1) {
          waves.splice(w, 1)
          continue
        }

        const radius = CURSOR.burstReach * level.touch * easeOut(p)
        const dots = Math.max(8, Math.ceil((2 * Math.PI * radius) / (cell * 1.4)))

        for (let d = 0; d < dots; d++) {
          const a = (d / dots) * Math.PI * 2

          deposit(wave.x + Math.cos(a) * radius, wave.y + Math.sin(a) * radius, 0.5 * (1 - p), cell * 2.2)
        }
      }
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)

      const dt = Math.min(0.1, (now - last) / 1000)

      last = now
      pending += dt

      if (pending < 1 / FIELD.fps) return

      step(Math.min(pending, 0.25))
      pending = 0
      render()
    }

    const start = () => {
      if (running) return

      running = true
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }

    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }

    // Reduced motion keeps a still frame until the visitor presses play, which counts as asking for motion
    const sync = () => {
      if (onScreen && !document.hidden && (!reduce || liveRef.current.playing)) start()
      else stop()
    }

    // A still field (reduced motion) answers a new size, word or intensity at once, with one fresh frame
    const draw = () => {
      if (running) return

      Object.assign(level, INTENSITY.levels[liveRef.current.intensity])
      render()
    }

    // A new word is spelled at once and slides in from the right edge; a paused field draws it straight away
    const respell = () => {
      spell()

      const period = maskW + MARQUEE.gap

      shift = (period - ((cols + Math.floor(crawlPos)) % period)) % period
      draw()
    }

    controlsRef.current = { sync, draw, spell: respell }

    const handlePointerMove = (event: PointerEvent) => {
      if (!finePointer || !running) return

      const rect = panel.getBoundingClientRect()
      const x = event.clientX - rect.left
      const y = event.clientY - rect.top

      const strength = Math.min(0.7, CURSOR.strength * level.touch)

      if (pointerX >= 0 && performance.now() - lastMove < 120) stroke(pointerX, pointerY, x, y, strength)
      else deposit(x, y, strength, CURSOR.size * (0.7 + 0.3 * level.touch))

      pointerX = x
      pointerY = y
      lastMove = performance.now()
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!running || (event.target as HTMLElement).closest('a, button')) return

      const rect = panel.getBoundingClientRect()

      waves.push({ x: event.clientX - rect.left, y: event.clientY - rect.top, age: 0 })
    }

    // Resizing a canvas wipes it, so the new frame is drawn at once rather than on the next tick
    const handleResize = () => {
      measure()
      render()
    }

    const resizeObserver = new ResizeObserver(handleResize)

    const viewObserver = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      sync()
    })

    measure()
    render()
    sync()
    resizeObserver.observe(panel)

    if (copyRef.current) resizeObserver.observe(copyRef.current)

    viewObserver.observe(canvas)
    document.fonts?.ready.then(handleResize)
    panel.addEventListener('pointermove', handlePointerMove, { passive: true })
    panel.addEventListener('pointerdown', handlePointerDown, { passive: true })
    document.addEventListener('visibilitychange', sync)

    return () => {
      stop()
      controlsRef.current = null
      resizeObserver.disconnect()
      viewObserver.disconnect()
      panel.removeEventListener('pointermove', handlePointerMove)
      panel.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [copyRef])

  return <canvas ref={canvasRef} aria-hidden className='kln-field' />
}

const GLYPHS = 'ABCDEFGHJKLMNPRSTUVXYZ0123456789#%&'

// Characters that stay put while the rest of a label scrambles, so its shape still reads
const FIXED = ' .·&'

/**
 * A label that decodes itself: on scramble() each character flickers through random glyphs and settles left
 * to right, about 0.3s in all. Does nothing for people who ask for less motion
 */
const useScramble = (text: string) => {
  // States
  const [display, setDisplay] = useState(text)

  // Refs
  const timerRef = useRef<number | null>(null)

  // Hooks
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current)
    }
  }, [])

  const scramble = useCallback(() => {
    if (reduceMotion) return

    if (timerRef.current) window.clearInterval(timerRef.current)

    const total = text.length + 4
    let frame = 0

    timerRef.current = window.setInterval(() => {
      frame++

      const settled = Math.floor((frame / total) * text.length)

      if (frame >= total) {
        if (timerRef.current) window.clearInterval(timerRef.current)
        timerRef.current = null
        setDisplay(text)

        return
      }

      setDisplay(
        text
          .split('')
          .map((char, i) =>
            i < settled || FIXED.includes(char) ? char : GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
          )
          .join('')
      )
    }, 32)
  }, [reduceMotion, text])

  return { display, scramble }
}

type PropsNavPill = {
  label: string
  href: string
  hot?: boolean
  className?: string
}

/**
 * A light grey pill with a caps label that decodes itself on hover or focus. The real label is laid out
 * invisibly underneath so the pill never changes width while the glyphs flicker
 */
const NavPill = ({ label, href, hot = false, className }: PropsNavPill) => {
  // Hooks
  const { display, scramble } = useScramble(label)

  return (
    <a href={href} onPointerEnter={scramble} onFocus={scramble} className={cn('kln-pill', className)}>
      {hot && <span aria-hidden className='kln-hot-dot' />}
      <span className='relative'>
        <span className='invisible'>{label}</span>
        <span aria-hidden className='absolute inset-0 whitespace-nowrap'>
          {display}
        </span>
        <span className='sr-only'>{label}</span>
      </span>
    </a>
  )
}

/**
 * The card to the right of the headline, from 1024px up. One topic is open at a time: its name set in the
 * headline's condensed capitals and its line unfolding beneath. Every INSIGHTS.hold seconds the next opens;
 * hovering or focusing the card holds it, hovering a row opens that one, and with reduced motion
 * nothing steps on by itself
 */
const InsightsCard = () => {
  // States
  const [active, setActive] = useState(0)
  const [held, setHeld] = useState(false)

  // Hooks
  const reduceMotion = useReducedMotion()

  // A fresh countdown starts whenever the open row changes, so a row opened by hand gets its full time too
  useEffect(() => {
    if (held || reduceMotion) return

    const id = window.setTimeout(() => {
      setActive(index => (index + 1) % INSIGHTS.items.length)
    }, INSIGHTS.hold * 1000)

    return () => window.clearTimeout(id)
  }, [active, held, reduceMotion])

  const handleOpen = (index: number) => () => {
    setActive(index)
  }

  const handleHold = () => {
    setHeld(true)
  }

  // Focus moving between rows stays inside the card, so only a focus that leaves it lets the card step on again
  const handleRelease = (event: { currentTarget: Element; relatedTarget: EventTarget | null }) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return

    setHeld(false)
  }

  return (
    <motion.aside
      aria-labelledby='kln-services-title'
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6, ease: EASE_OUT }}
      onPointerEnter={handleHold}
      onPointerLeave={handleRelease}
      onFocus={handleHold}
      onBlur={handleRelease}
      className='kln-services hidden lg:block'
    >
      <div className='kln-services-head'>
        <p id='kln-services-title' className='kln-mono text-(color:--color-kln-muted)'>
          {INSIGHTS.label}
        </p>
        <p className='kln-services-status'>
          <span aria-hidden className='kln-services-dot' />
          {INSIGHTS.status}
        </p>
      </div>

      <ul>
        {INSIGHTS.items.map((item, i) => (
          <li key={item.name}>
            <a
              href={item.href}
              aria-current={active === i ? 'true' : undefined}
              onPointerEnter={handleOpen(i)}
              onFocus={handleOpen(i)}
              className={cn('kln-svc', active === i && 'kln-svc-on')}
            >
              <span className='kln-svc-row'>
                <span className='kln-mono kln-svc-index'>{String(i + 1).padStart(2, '0')}</span>
                <span className='kln-svc-name'>{item.name}</span>
                <ArrowUpRight aria-hidden className='kln-svc-arrow size-4' strokeWidth={1.75} />
              </span>
              <span className='kln-svc-more'>
                <span className='kln-svc-line'>{item.line}</span>
              </span>
            </a>
          </li>
        ))}
      </ul>

      <div className='kln-services-foot'>
        <span>{INSIGHTS.footer.note}</span>
        {/* The same pill as the action in the nav, so the two actions match */}
        <NavPill label={INSIGHTS.footer.link.label} href={INSIGHTS.footer.link.href} hot />
      </div>
    </motion.aside>
  )
}

type SegmentType = { text: string; pixel?: boolean }

// The lens radius while the pointer is over the headline, as a multiple of the font size
const LENS = 0.8

// The lens opens only while the pointer is over the headline's box, give or take this many font sizes
const NEAR = 0.05

const LINES: readonly (readonly SegmentType[])[] = COPY.title

// The whole headline as one plain sentence, for screen readers
const SPOKEN = LINES.map(line => line.map(segment => segment.text).join('')).join(' ')

// One line's words as the ink shows them; the pixel segment is set in Handjet
const InkText = ({ line }: { line: readonly SegmentType[] }) => {
  return (
    <>
      {line.map((segment, i) => (
        <Fragment key={i}>
          {segment.pixel ? <span className='kln-px-word'>{segment.text}</span> : segment.text}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The same line as the lens shows it, in Instrument Serif italic. Each letter sits in a cell sized by an
 * invisible copy of its ink glyph, so every serif letter lands exactly over the capital it replaces
 */
const HeatText = ({ line }: { line: readonly SegmentType[] }) => {
  return (
    <>
      {line.map((segment, i) => (
        <Fragment key={i}>
          {segment.text.split('').map((char, c) =>
            char === ' ' ? (
              ' '
            ) : (
              <span key={c} className='kln-hc'>
                <span className={segment.pixel ? 'kln-hc-size kln-px-word' : 'kln-hc-size'}>{char}</span>
                <span className='kln-hc-face'>{char}</span>
              </span>
            )
          )}
        </Fragment>
      ))}
    </>
  )
}

/**
 * The headline seen through a thermal camera, on hover only. It rests as plain ink; while the pointer is over
 * it a small round lens follows, and inside it the letters turn to Instrument Serif italic in the heat ramp,
 * striped with scanlines. Ink and heat are stacked copies masked by the same lens, so nothing moves.
 * Lines wipe in from the left
 */
const ThermalHeadline = () => {
  // Refs
  const titleRef = useRef<HTMLHeadingElement>(null)

  // Hooks
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const title = titleRef.current

    if (!title || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const lines = Array.from(title.querySelectorAll<HTMLElement>('[data-line]'))
    const lens = { x: -9999, y: 0, r: 0 }
    let rect = title.getBoundingClientRect()
    let fontSize = 100
    let pointerX = -1e4
    let pointerY = -1e4
    let lineTops = lines.map(() => 0)
    let raf = 0
    let onScreen = true
    let open = false
    let measuredAt = 0

    // Every read of layout happens here, never inside the frame loop, so a frame only writes styles
    const measure = () => {
      measuredAt = performance.now()
      rect = title.getBoundingClientRect()
      fontSize = parseFloat(getComputedStyle(title).fontSize) || 100
      lineTops = lines.map(line => line.offsetTop)
    }

    const isNear = () => {
      const margin = fontSize * NEAR

      return (
        pointerX > rect.left - margin &&
        pointerX < rect.right + margin &&
        pointerY > rect.top - margin &&
        pointerY < rect.bottom + margin
      )
    }

    const frame = () => {
      const near = isNear()

      let goalX = lens.x
      let goalY = lens.y
      let goalR = 0

      if (near) {
        goalX = pointerX - rect.left
        goalY = pointerY - rect.top
        goalR = fontSize * LENS
      }

      // The lens glides after its goal; a fresh lens jumps to it so it never sweeps in from far away
      if (lens.r < 1) {
        lens.x = goalX
        lens.y = goalY
      } else {
        lens.x += (goalX - lens.x) * 0.18
        lens.y += (goalY - lens.y) * 0.18
      }

      lens.r += (goalR - lens.r) * 0.12

      title.style.setProperty('--kln-lx', `${lens.x.toFixed(1)}px`)
      title.style.setProperty('--kln-ly', `${lens.y.toFixed(1)}px`)
      title.style.setProperty('--kln-lr', `${Math.max(0, lens.r).toFixed(1)}px`)
      lines.forEach((line, i) => line.style.setProperty('--kln-ly', `${(lens.y - lineTops[i]).toFixed(1)}px`))

      // The heat copy is only shown while the lens is open; CSS keeps it hidden otherwise
      if (lens.r > 0.5 !== open) {
        open = lens.r > 0.5

        if (open) title.dataset.lens = 'open'
        else delete title.dataset.lens
      }

      // Once the lens has closed and the pointer is away, the loop stops until the pointer comes back
      raf = onScreen && (near || open) ? requestAnimationFrame(frame) : 0
    }

    const wake = () => {
      if (!raf && onScreen && isNear()) raf = requestAnimationFrame(frame)
    }

    const handlePointerMove = (event: PointerEvent) => {
      pointerX = event.clientX
      pointerY = event.clientY

      if (performance.now() - measuredAt > 400) measure()

      wake()
    }

    // A finger lifting, or the pointer leaving the window, closes the lens
    const handlePointerAway = (event: PointerEvent) => {
      if (event.type === 'pointerout' && event.relatedTarget) return

      if (event.type === 'pointerup' && event.pointerType === 'mouse') return

      pointerX = -1e4
      pointerY = -1e4
    }

    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting
      wake()
    })

    const resizeObserver = new ResizeObserver(measure)

    measure()
    observer.observe(title)
    resizeObserver.observe(title)
    document.fonts?.ready.then(measure)
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerup', handlePointerAway, { passive: true })
    window.addEventListener('pointercancel', handlePointerAway, { passive: true })
    document.documentElement.addEventListener('pointerout', handlePointerAway, { passive: true })
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerAway)
      window.removeEventListener('pointercancel', handlePointerAway)
      document.documentElement.removeEventListener('pointerout', handlePointerAway)
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [])

  return (
    <h1 ref={titleRef} id='kln-title' className='kln-title'>
      <span className='sr-only'>{SPOKEN}</span>

      {LINES.map((line, i) => (
        <motion.span
          key={i}
          aria-hidden
          data-line
          initial={reduceMotion ? false : { clipPath: 'inset(-12% 100% -12% 0%)' }}
          animate={{ clipPath: 'inset(-12% 0% -12% 0%)' }}
          transition={{ duration: 0.9, delay: 0.25 + i * 0.14, ease: EASE_OUT }}
          className='kln-title-line'
        >
          <span className='kln-ink'>
            <InkText line={line} />
          </span>
          <span className='kln-heat'>
            <HeatText line={line} />
          </span>
        </motion.span>
      ))}
    </h1>
  )
}

/**
 * The copy along the panel's foot: the headline at the left, as large as the room allows, and from 1024px the
 * card at the right. The field stops its drips above this block
 */
const HeroCopy = ({ copyRef }: { copyRef: RefObject<HTMLDivElement | null> }) => {
  return (
    <div ref={copyRef} className='kln-copy'>
      <ThermalHeadline />
      <InsightsCard />
    </div>
  )
}

// A pixel "I" on a 5 × 5 grid, its foot ending in one hot square that takes the accent colour
const KilnPixelMark = (props: SVGProps<SVGSVGElement>) => {
  return (
    <svg viewBox='0 0 5 5' fill='currentColor' shapeRendering='crispEdges' aria-hidden {...props}>
      <path d='M0 0h5v1H0zM2 1h1v3H2zM0 4h3v1H0z' />
      <path d='M3 4h2v1H3z' fill='var(--kln-mark-hot, currentColor)' />
    </svg>
  )
}

type PropsNavWindow = {
  id: string
  label: string
  open: boolean
  onToggle: () => void

  // Open width, px; folded, the window shrinks to fit its title bar
  width: number
  mark?: ReactNode
  children: ReactNode
}

// Width and height share one duration and curve, so the window grows as a single shape rather than in two steps
const SIZE = { duration: 0.5, ease: WINDOW_EASE }

// What the folded window adds around its label, px: bar gap 14 + eye 14 + bar padding 2 × 12 + window padding 2 × 4
const BAR_EXTRA = 60

// Folded, the 38px window is a full pill (radius = half its height); unfolded it keeps a soft 20px corner
const RADIUS = { folded: 19, open: 20 }

/**
 * A grey window with a title bar that folds and unfolds a white card. The window's width and the card's height
 * move together on one curve; the card's content fades and sharpens in a beat later and leaves first, so text
 * is never seen squeezing. The card keeps the open width throughout and the window clips it
 */
const NavWindow = ({ id, label, open, onToggle, width, mark, children }: PropsNavWindow) => {
  // States
  const [folded, setFolded] = useState(0)

  // Refs
  const labelRef = useRef<HTMLSpanElement>(null)

  /**
   * Motion can't tween a width to 'auto', so the folded width is measured from the label and both ends of
   * the move are plain px. It re-measures when the label's font lands or its size changes
   */
  useEffect(() => {
    const label = labelRef.current

    if (!label) return

    const measure = () => {
      setFolded(Math.ceil(label.getBoundingClientRect().width) + BAR_EXTRA)
    }

    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(label)
    document.fonts?.ready.then(measure)

    return () => observer.disconnect()
  }, [])

  return (
    <motion.div
      initial={false}
      animate={{ width: open ? width : folded || 'auto', borderRadius: open ? RADIUS.open : RADIUS.folded }}
      transition={SIZE}
      className='kln-window'
    >
      <button
        type='button'
        aria-expanded={open}
        aria-controls={id}
        aria-label={open ? `Hide ${label}` : `Show ${label}`}
        onClick={onToggle}
        className='kln-window-bar'
      >
        <span ref={labelRef} className='flex shrink-0 items-center gap-2'>
          {mark}
          <span className='kln-window-label'>{label}</span>
        </span>
        <span aria-hidden className='relative grid size-3.5 place-items-center'>
          <AnimatePresence initial={false} mode='popLayout'>
            <motion.span
              key={open ? 'closed' : 'open'}
              initial={{ opacity: 0, scale: 0.6, rotate: -30 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, scale: 0.6, rotate: 30 }}
              transition={{ duration: 0.22, ease: WINDOW_EASE }}
              className='absolute'
            >
              {open ? (
                <EyeClosed className='size-3.5' strokeWidth={1.75} />
              ) : (
                <Eye className='size-3.5' strokeWidth={1.75} />
              )}
            </motion.span>
          </AnimatePresence>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            id={id}
            key='body'
            initial={{ height: 0 }}
            animate={{ height: 'auto', transition: SIZE }}
            exit={{ height: 0, transition: { ...SIZE, duration: 0.42 } }}
            className='overflow-hidden'
          >
            <motion.div
              initial={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              animate={{
                opacity: 1,
                y: 0,
                filter: 'blur(0px)',
                transition: { duration: 0.34, delay: 0.1, ease: WINDOW_EASE }
              }}
              exit={{ opacity: 0, y: -4, filter: 'blur(2px)', transition: { duration: 0.16 } }}
              style={{ width: width - 8 }}
              className='kln-window-card'
            >
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

type PropsInfoWindow = {
  open: boolean
  onToggle: () => void
  width: number
}

// The product's window: what Instalytics is, in one short statement
const InfoWindow = ({ open, onToggle, width }: PropsInfoWindow) => {
  return (
    <NavWindow
      id='kln-info-body'
      label={INFO.label}
      open={open}
      onToggle={onToggle}
      width={width}
      mark={<KilnPixelMark className='kln-mark size-3' />}
    >
      <p className='kln-info-card kln-info-text'>
        <strong className='kln-info-brand'>{BRAND.name}</strong> {INFO.statement}
      </p>
    </NavWindow>
  )
}

type PropsStatusPill = {
  playing: boolean
  onTogglePlay: () => void
  intensity: number
  onIntensityChange: (by: number) => void
}

/**
 * The pill beside the action, laid out like a small player: − and + calm and intensify the background, the
 * middle key stops and starts its crawling word, and a short message crawls past in grey dot-matrix
 * type. Hidden on phones, where the top row keeps just Info.exe and the action
 */
const StatusPill = ({ playing, onTogglePlay, intensity, onIntensityChange }: PropsStatusPill) => {
  const handleCooler = () => {
    onIntensityChange(-1)
  }

  const handleHotter = () => {
    onIntensityChange(1)
  }

  return (
    <div className='kln-status hidden sm:flex'>
      <div className='flex items-center gap-px'>
        <button
          type='button'
          aria-label='Calm the background'
          disabled={intensity === 0}
          onClick={handleCooler}
          className='kln-round-key'
        >
          <Minus aria-hidden className='size-3' strokeWidth={2.5} />
        </button>
        <button
          type='button'
          aria-label={playing ? 'Stop the word' : 'Start the word'}
          onClick={onTogglePlay}
          className='kln-round-key'
        >
          {playing ? (
            <Pause aria-hidden className='size-2.5' fill='currentColor' strokeWidth={0} />
          ) : (
            <Play aria-hidden className='size-2.5 translate-x-px' fill='currentColor' strokeWidth={0} />
          )}
        </button>
        <button
          type='button'
          aria-label='Intensify the background'
          disabled={intensity === INTENSITY.levels.length - 1}
          onClick={handleHotter}
          className='kln-round-key'
        >
          <Plus aria-hidden className='size-3' strokeWidth={2.5} />
        </button>
      </div>

      <p className='kln-readout hidden sm:block'>
        <span className='sr-only'>{STATUS.message}</span>
        <span aria-hidden className='kln-crawl' style={{ '--kln-lap': `${STATUS.lap}s` } as CSSProperties}>
          <span>{STATUS.message}</span>
          <span>{STATUS.message}</span>
        </span>
      </p>
    </div>
  )
}

type PropsStepsWindow = {
  open: boolean
  onToggle: () => void
}

// A second window beside the product's: folded to its title bar until opened, then the three steps
const StepsWindow = ({ open, onToggle }: PropsStepsWindow) => {
  return (
    <NavWindow id='kln-work-body' label={STEPS.label} open={open} onToggle={onToggle} width={STEPS.width}>
      <div className='kln-work-card'>
        <p className='kln-work-intro'>{STEPS.intro}</p>
        <ol className='mt-3'>
          {STEPS.items.map((item, i) => (
            <li key={item.title}>
              <a href={item.href} className='kln-work-row group'>
                <span className='kln-mono text-(color:--color-kln-muted)'>{String(i + 1).padStart(2, '0')}</span>
                <span className='min-w-0'>
                  <span className='text-(color:--color-kln-ink) block truncate font-medium'>{item.title}</span>
                  <span className='text-(color:--color-kln-muted) block'>{item.detail}</span>
                </span>
                <ArrowUpRight
                  aria-hidden
                  className='text-(color:--color-kln-muted) group-hover:text-(color:--color-kln-ink) size-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5'
                  strokeWidth={1.75}
                />
              </a>
            </li>
          ))}
        </ol>
      </div>
    </NavWindow>
  )
}

// False on the server and during hydration, then the real answer, so the markup always matches what was sent
const useMediaQuery = (query: string) => {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)

      list.addEventListener('change', onChange)

      return () => list.removeEventListener('change', onChange)
    },
    [query]
  )

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

const subscribeResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange)

  return () => window.removeEventListener('resize', onChange)
}

// 0 on the server and during hydration, then the live window width
const useViewportWidth = () => {
  return useSyncExternalStore(
    subscribeResize,
    () => window.innerWidth,
    () => 0
  )
}

type PropsNavbar = {
  playing: boolean
  onTogglePlay: () => void
  intensity: number
  onIntensityChange: (by: number) => void
}

// The page's outer margin at a given window width, matching --kln-frame-x in the stylesheet
const frameFor = (width: number) => (width >= 1024 ? 20 : width >= 640 ? 16 : 12)

/**
 * The page's sticky nav, laid out like a desktop: two windows at the left whose bodies hang down over the
 * hero, the pill that drives the field's word, and the one action pill at the right. Each window sits in a
 * slot of fixed height, so opening one never changes the height the hero is measured against
 */
const Navbar = ({ playing, onTogglePlay, intensity, onIntensityChange }: PropsNavbar) => {
  // States
  const [infoChoice, setInfoChoice] = useState<boolean | null>(null)
  const [workOpen, setWorkOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  // Refs
  const headerRef = useRef<HTMLElement>(null)
  const workRef = useRef<HTMLDivElement>(null)

  // Hooks
  const wide = useMediaQuery('(min-width: 1024px)')
  const viewport = useViewportWidth()

  // Vars
  const infoOpen = infoChoice ?? (wide && !scrolled)
  const infoWidth = viewport ? Math.min(INFO.width, viewport - 2 * frameFor(viewport)) : INFO.width

  // Under 900px an open info window needs the whole row, so the right side steps aside until it folds
  const crowded = infoOpen && viewport > 0 && viewport < 900

  useEffect(() => {
    const header = headerRef.current
    const root = header?.parentElement

    if (!header || !root) return

    const measure = () => {
      root.style.setProperty('--kln-nav-space', `${header.offsetHeight}px`)
    }

    const observer = new ResizeObserver(measure)

    measure()
    observer.observe(header)
    document.fonts?.ready.then(measure)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let wasScrolled = false

    const handleScroll = () => {
      const now = window.scrollY > NAV.scrollThreshold

      if (now === wasScrolled) return

      wasScrolled = now
      setScrolled(now)

      // The windows fold shut as the page moves, so they never sit over the content below
      if (now) {
        setInfoChoice(null)
        setWorkOpen(false)
      }
    }

    handleScroll()
    window.addEventListener('scroll', handleScroll, { passive: true })

    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (!workOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!workRef.current?.contains(event.target as Node)) setWorkOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWorkOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [workOpen])

  const handleInfoToggle = () => {
    setInfoChoice(!infoOpen)
  }

  const handleWorkToggle = () => {
    setWorkOpen(value => !value)
  }

  return (
    <header ref={headerRef} data-scrolled={scrolled} className='kln-header kln-frame'>
      <nav aria-label='Primary' className='flex items-start justify-between gap-2'>
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
          className='relative z-10 flex min-w-0 items-start gap-2'
        >
          <div className='kln-slot'>
            <InfoWindow open={infoOpen} onToggle={handleInfoToggle} width={infoWidth} />
          </div>
          <div ref={workRef} className='kln-slot hidden xl:block'>
            <StepsWindow open={workOpen} onToggle={handleWorkToggle} />
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.08, ease: EASE_OUT }}
          className={cn('flex shrink-0 items-center gap-1.5', crowded && 'hidden')}
        >
          <StatusPill
            playing={playing}
            onTogglePlay={onTogglePlay}
            intensity={intensity}
            onIntensityChange={onIntensityChange}
          />
          <NavPill label={NAV.action.label} href={NAV.action.href} hot />
        </motion.div>
      </nav>
    </header>
  )
}

// The cell size and heat colours the stylesheet reads, handed over once so the stylesheet never repeats config
const DIAL_VARS = {
  '--kln-cell': `${FIELD.cell}px`,
  '--kln-seam': `${FIELD.gap}px`,
  '--kln-card-px': INSIGHTS.width,
  '--kln-card-gap-px': INSIGHTS.gap,
  ...Object.fromEntries(HEAT.palette.map((hex, i) => [`--kln-heat-${i}`, hex]))
} as CSSProperties

/**
 * The page-level nav, one panel and the bottom bar; the field drips off above the copy at the bottom left.
 * Shared state lives here: whether the field's word crawls and how intense the field runs (both from the
 * nav's pill) and which word it spells (from the bottom bar's links)
 */
const HeroSection = () => {
  // States
  const [playChoice, setPlayChoice] = useState<boolean | null>(null)
  const [spell, setSpell] = useState<string | null>(null)
  const [intensity, setIntensity] = useState<number>(INTENSITY.start)

  // Refs
  const copyRef = useRef<HTMLDivElement>(null)

  // Hooks
  const reduceMotion = useReducedMotion()

  // Vars
  const playing = playChoice ?? !reduceMotion

  const handleTogglePlay = () => {
    setPlayChoice(!playing)
  }

  const handleIntensity = (by: number) => {
    setIntensity(step => Math.min(INTENSITY.levels.length - 1, Math.max(0, step + by)))
  }

  /**
   * reducedMotion='user': transforms are skipped for people who ask for less motion, fades still play,
   * and the field holds one still frame until they press play
   */
  return (
    <MotionConfig reducedMotion='user'>
      <div style={DIAL_VARS} className='kln-root'>
        <Navbar
          playing={playing}
          onTogglePlay={handleTogglePlay}
          intensity={intensity}
          onIntensityChange={handleIntensity}
        />

        <div className='kln-frame'>
          <section id='home' aria-labelledby='kln-title' className='kln-panel'>
            <HeatField copyRef={copyRef} playing={playing} intensity={intensity} text={spell ?? MARQUEE.text} />
            <HeroCopy copyRef={copyRef} />
          </section>
        </div>

        <BottomBar onSpell={setSpell} />
      </div>
    </MotionConfig>
  )
}

/**
 * Adds a font stylesheet once the page has hydrated, so it never holds up the first paint. A stylesheet
 * rendered as JSX with `precedence` would be hoisted into the head and block rendering; added from an effect
 * it loads in the background and its fonts swap in when they land
 */
const LateFonts = ({ href }: { href: string }) => {
  useEffect(() => {
    if (document.querySelector(`link[data-late-fonts="${href}"]`)) return

    const link = document.createElement('link')

    link.rel = 'stylesheet'
    link.href = href
    link.dataset.lateFonts = href
    document.head.appendChild(link)
  }, [href])

  return null
}

/**
 * The fonts the first screen needs, loaded before it paints: Archivo at the one width and weight the headline
 * uses, Handjet for the pixel word (left out, it would flash in a stand-in face) and Host Grotesk for the interface
 */
const CRITICAL_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@75,800&family=Handjet:wght@600&family=Host+Grotesk:wght@400;500;600&display=swap'

/**
 * Fonts that can arrive after the first paint: Instrument Serif shows only inside the hover lens, Doto in the
 * pill's crawl (hidden on phones) and Martian Mono in small labels
 */
const LATE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Doto:wght@600&family=Instrument+Serif:ital@1&family=Martian+Mono:wght@400&display=swap'

const PixelHeatHero = () => {
  // React places these hints at the top of the head, ahead of the stylesheet they speed up
  preconnect('https://fonts.googleapis.com')
  preconnect('https://fonts.gstatic.com', { crossOrigin: 'anonymous' })

  return (
    <>
      <link rel='stylesheet' href={CRITICAL_FONTS_URL} precedence='default' />
      <LateFonts href={LATE_FONTS_URL} />
      <style>{BLOCK_CSS}</style>
      <main className='w-full antialiased'>
        <HeroSection />
      </main>
    </>
  )
}

const BLOCK_CSS = `
/* Classes and tokens are prefixed kln- (kiln) so they never collide with another block's. */
:root {
  /* The white page and panel, and the faint grid the field's squares sit on */
  --color-kln-page: #ffffff;
  --color-kln-grid: #f1f1f1;
  /* Window and pill chrome, and its hover step */
  --color-kln-chrome: #f1f1f1;
  --color-kln-chrome-hi: #e6e6e6;
  --color-kln-card: #ffffff;
  /* Headline, labels and dark keys */
  --color-kln-ink: #141414;
  /* Supporting line and the info window's statement */
  --color-kln-body: #5e5e5e;
  /* Small secondary labels (4.5:1 on white) */
  --color-kln-muted: #767676;
  --color-kln-line: #e8e8e8;
  /* The hairline that boxes the panel in */
  --color-kln-line-box: #dcdcdc;

  --font-kln-sans: 'Host Grotesk', 'Kln Host Grotesk Fallback', ui-sans-serif, system-ui, sans-serif;
  --font-kln-mono: 'Martian Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
  --font-kln-display: 'Archivo', 'Kln Archivo Fallback', var(--font-kln-sans);
  --font-kln-serif: 'Instrument Serif', ui-serif, Georgia, serif;
  --font-kln-pixel: 'Handjet', 'Kln Handjet Fallback', var(--font-kln-mono);
  --font-kln-dot: 'Doto', var(--font-kln-mono);
}

/**
 * Stand-ins shown until the web fonts land: Arial scaled to each font's measured width and line metrics, so
 * the text takes the same room in either face and nothing moves when the real one swaps in
 */
@font-face {
  font-family: 'Kln Archivo Fallback';
  src: local('Arial Bold'), local('Arial-BoldMT');
  size-adjust: 81.3%;
  ascent-override: 108.2%;
  descent-override: 25.8%;
  line-gap-override: 0%;
}

@font-face {
  font-family: 'Kln Host Grotesk Fallback';
  src: local('Arial'), local('ArialMT');
  font-weight: 100 550;
  size-adjust: 104.3%;
  ascent-override: 96.9%;
  descent-override: 30.7%;
  line-gap-override: 0%;
}

@font-face {
  font-family: 'Kln Host Grotesk Fallback';
  src: local('Arial Bold'), local('Arial-BoldMT');
  font-weight: 551 900;
  size-adjust: 92.9%;
  ascent-override: 108.7%;
  descent-override: 34.4%;
  line-gap-override: 0%;
}

@font-face {
  font-family: 'Kln Handjet Fallback';
  src: local('Arial Bold'), local('Arial-BoldMT');
  size-adjust: 56.4%;
  ascent-override: 156%;
  descent-override: 42.6%;
  line-gap-override: 0%;
}

/* The pill's line is written twice, so sliding by half its width lands exactly where it started */
@keyframes kln-crawl {
  to {
    transform: translateX(calc(-50% - 1.25em));
  }
}

@layer components {
  /**
   * One alignment system: --kln-frame-x is the page's outer margin (nav and panel edges), --kln-inset-x the
   * padding inside the panel. interpolate-size lets a window ease between fit-content and its open width
   */
  .kln-root {
    --kln-frame-x: 12px;
    --kln-inset-x: 16px;
    --kln-nav-space: 50px;
    --kln-bar-space: 46px;

    /* The card's room beside the headline; zero below 1024px, where the card is hidden */
    --kln-card-w: 0px;
    --kln-card-gap: 0px;
    --kln-ease: cubic-bezier(0.22, 1, 0.36, 1);
    --kln-lift: 0 1px 0 rgb(0 0 0 / 0.03), 0 10px 28px -14px rgb(20 20 20 / 0.3);

    min-height: 100dvh;
    background-color: var(--color-kln-page);
    color: var(--color-kln-ink);
    font-family: var(--font-kln-sans);
    interpolate-size: allow-keywords;
  }

  @media (min-width: 640px) {
    .kln-root {
      --kln-frame-x: 16px;
      --kln-inset-x: 24px;
    }
  }

  @media (min-width: 1024px) {
    .kln-root {
      --kln-frame-x: 20px;
      --kln-inset-x: 32px;
      --kln-card-w: calc(var(--kln-card-px) * 1px);
      --kln-card-gap: calc(var(--kln-card-gap-px) * 1px);
    }
  }

  .kln-root :focus-visible {
    outline: 2px solid var(--kln-heat-1);
    outline-offset: 2px;
  }

  .kln-frame {
    padding-inline: var(--kln-frame-x);
  }

  .kln-mono {
    font-family: var(--font-kln-mono);
    font-size: 0.6875rem;
    letter-spacing: 0.02em;
    text-transform: uppercase;
  }

  /* A single square in the hottest colour that still reads on white */
  .kln-hot-dot {
    flex: none;
    width: 7px;
    height: 7px;
    background-color: var(--kln-heat-3);
  }

  /* ---------- Nav ---------- */

  /* backdrop-filter doesn't transition, so the colour and hairline ease while the blur switches */
  .kln-header {
    position: sticky;
    top: 0;
    z-index: 40;
    padding-block: 10px;
    border-bottom: 1px solid transparent;
    transition:
      background-color 0.25s ease,
      border-color 0.25s ease;
  }

  .kln-header[data-scrolled='true'] {
    background-color: rgb(255 255 255 / 0.78);
    border-bottom-color: var(--color-kln-line);
    -webkit-backdrop-filter: blur(14px);
    backdrop-filter: blur(14px);
  }

  /* A window's bar sits in this slot; its body overflows below without changing the nav's height */
  .kln-slot {
    position: relative;
    height: 38px;
    min-width: 0;
  }

  /* Motion animates the width and the corner: a full pill folded, a soft 20px corner unfolded */
  .kln-window {
    position: relative;
    overflow: hidden;
    padding: 4px;
    border-radius: 19px;
    background-color: var(--color-kln-chrome);
    box-shadow: var(--kln-lift);
  }

  .kln-window-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    height: 30px;
    padding-inline: 12px;
    border-radius: 999px;
    color: var(--color-kln-muted);
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.2s ease;
  }

  /* On the narrowest phones a window with a mark folds to just the mark and its eye, so the top row fits */
  @media (max-width: 399px) {
    .kln-window-bar:has(.kln-mark) .kln-window-label {
      display: none;
    }
  }

  .kln-window-bar:hover {
    color: var(--color-kln-ink);
  }

  .kln-window-card {
    border-radius: 16px;
    background-color: var(--color-kln-card);
  }

  /* Only a window with a title bar spaces its card from the bar */
  .kln-window-bar + * > .kln-window-card {
    margin-top: 4px;
  }

  .kln-mark {
    --kln-mark-hot: var(--kln-heat-3);

    color: var(--color-kln-ink);
  }

  .kln-info-card {
    padding: 14px;
  }

  .kln-info-text {
    color: var(--color-kln-muted);
    font-size: clamp(1.0625rem, 0.95rem + 0.35vw, 1.25rem);
    line-height: 1.42;
    letter-spacing: -0.015em;
    text-wrap: pretty;
  }

  .kln-info-brand {
    color: var(--color-kln-ink);
    font-weight: 600;
    letter-spacing: -0.035em;
  }

  .kln-work-card {
    padding: 12px;
  }

  .kln-work-intro {
    color: var(--color-kln-body);
    font-size: 0.875rem;
    line-height: 1.4;
  }

  .kln-work-row {
    display: grid;
    grid-template-columns: 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 9px 6px;
    border-top: 1px solid var(--color-kln-line);
    font-size: 0.875rem;
    line-height: 1.3;
    transition: background-color 0.2s ease;
  }

  .kln-work-row:hover {
    background-color: #f7f7f7;
  }

  .kln-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 38px;
    padding-inline: 16px;
    border-radius: 999px;
    background-color: var(--color-kln-chrome);
    box-shadow: var(--kln-lift);
    color: #252525;
    font-size: 0.8rem;
    font-weight: 600;
    letter-spacing: -0.02em;
    text-transform: uppercase;
    white-space: nowrap;
    transition:
      background-color 0.2s ease,
      color 0.2s ease;
  }

  .kln-pill:hover {
    background-color: var(--color-kln-ink);
    color: #ffffff;
  }

  /* ---------- Status pill ---------- */

  /**
   * After a player strip: three small dark keys nearly touching at the left, then grey dot-matrix text
   * crawling out from behind them and running off the pill's rounded right edge, which clips it
   */
  .kln-status {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 38px;
    overflow: hidden;
    padding-right: 5px;
    padding-left: 5px;
    border-radius: 999px;
    background-color: var(--color-kln-chrome);
    box-shadow: var(--kln-lift);
  }

  @media (min-width: 640px) {
    .kln-status {
      padding-right: 0;
    }
  }

  .kln-round-key {
    display: grid;
    flex: none;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 999px;
    background-color: var(--color-kln-ink);
    color: #ffffff;
    transition:
      background-color 0.2s ease,
      scale 0.15s ease;
  }

  .kln-round-key:hover:not(:disabled) {
    background-color: var(--kln-heat-1);
  }

  .kln-round-key:active:not(:disabled) {
    scale: 0.9;
  }

  .kln-round-key:disabled {
    cursor: not-allowed;
    opacity: 0.3;
  }

  /* Only the left edge fades, so the text slides out from behind the keys; the pill itself cuts the right */
  .kln-readout {
    width: 124px;
    overflow: hidden;
    color: var(--color-kln-muted);
    font-family: var(--font-kln-dot);
    font-size: 0.9375rem;
    font-weight: 600;
    white-space: nowrap;
    -webkit-mask-image: linear-gradient(to right, transparent, #000 10%);
    mask-image: linear-gradient(to right, transparent, #000 10%);
  }

  .kln-crawl {
    display: inline-flex;
    gap: 2.5em;
    padding-left: 4px;
    animation: kln-crawl var(--kln-lap) linear infinite;
  }

  /* ---------- Panel ---------- */

  /**
   * Fills exactly what the nav and the bottom bar leave, with the copy sat in its bottom left corner and
   * every corner rounded, since the bottom bar sits between it and anything below
   */
  .kln-panel {
    position: relative;
    isolation: isolate;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    min-height: calc(100dvh - var(--kln-nav-space) - var(--kln-bar-space));
    overflow: hidden;
    padding: clamp(180px, 34dvh, 420px) var(--kln-inset-x) clamp(24px, 4.5dvh, 44px);
    border: 1px solid var(--color-kln-line-box);
    border-radius: 18px;
    background-color: var(--color-kln-page);
  }

  /* The faint grid lines up with the field's seams, and shows through wherever the field has gaps */
  .kln-panel::before {
    content: '';
    position: absolute;
    inset: 0;
    z-index: -1;
    background-image:
      linear-gradient(to right, transparent calc(var(--kln-cell) - var(--kln-seam)), var(--color-kln-grid) 0),
      linear-gradient(to bottom, transparent calc(var(--kln-cell) - var(--kln-seam)), var(--color-kln-grid) 0);
    background-size: var(--kln-cell) var(--kln-cell);
    background-position: var(--kln-grid-x, 0) 0;
  }

  .kln-field {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  /* ---------- Copy ---------- */

  /* From 1024px the card sits to the right of the headline, both resting on the panel's foot */
  .kln-copy {
    position: relative;
    z-index: 1;
    width: 100%;
  }

  @media (min-width: 1024px) {
    .kln-copy {
      display: grid;
      grid-template-columns: minmax(0, 1fr) var(--kln-card-w);
      align-items: end;
      column-gap: var(--kln-card-gap);
    }
  }

  /* Condensed Archivo capitals; the longest line runs --kln-title-em wide, so the size fills the panel's width */
  .kln-title {
    --kln-title-em: 7.3;

    /* The lens starts closed and far off; thermal headline code moves it while the pointer is near */
    --kln-lx: -9999px;
    --kln-ly: 0px;
    --kln-lr: 0px;

    position: relative;
    color: var(--color-kln-ink);
    font-family: var(--font-kln-display);
    font-size: clamp(
      1.9rem,
      min(
        (100vw - 2 * var(--kln-frame-x) - 2 * var(--kln-inset-x) - var(--kln-card-w) - var(--kln-card-gap)) /
          var(--kln-title-em),
        17dvh
      ),
      11rem
    );
    font-stretch: 75%;
    font-weight: 800;
    line-height: 0.9;
    letter-spacing: -0.01em;
    text-transform: uppercase;
  }

  /**
   * Each line is two stacked copies: ink below, heat above. The lens (--kln-lx / --kln-ly / --kln-lr, written
   * by ThermalHeadline) cuts a crisp round hole in the ink and shows the heat copy through it
   */
  /**
   * Each line is pinned to the height it has with the real fonts (0.9em; a line holding the pixel word is
   * taller), so a stand-in face can never change the headline's height and move it
   */
  .kln-title-line {
    position: relative;
    display: block;
    height: 0.9em;
    white-space: nowrap;
  }

  .kln-title-line:has(.kln-px-word) {
    height: 0.968em;
  }

  .kln-ink {
    display: block;
    -webkit-mask-image: radial-gradient(
      circle var(--kln-lr) at var(--kln-lx) var(--kln-ly),
      transparent 97%,
      #000 98.5%
    );
    mask-image: radial-gradient(circle var(--kln-lr) at var(--kln-lx) var(--kln-ly), transparent 97%, #000 98.5%);
  }

  /* The heat copy: the thermal ramp clipped to the letters, striped with faint scanlines like a camera display */
  /* Hidden until the lens opens, so its reflow while fonts load is never painted or counted as a shift */
  .kln-heat {
    visibility: hidden;
    position: absolute;
    inset: 0;
    color: transparent;
    background-image: radial-gradient(
      circle var(--kln-lr) at var(--kln-lx) var(--kln-ly),
      var(--kln-heat-4) 0%,
      var(--kln-heat-3) 24%,
      var(--kln-heat-2) 48%,
      var(--kln-heat-1) 70%,
      var(--kln-heat-0) 92%,
      var(--kln-heat-0) 97%,
      transparent 98.5%
    );
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-mask-image: repeating-linear-gradient(to bottom, #000 0 2px, rgb(0 0 0 / 0.6) 2px 3px);
    mask-image: repeating-linear-gradient(to bottom, #000 0 2px, rgb(0 0 0 / 0.6) 2px 3px);
    pointer-events: none;
  }
  .kln-title[data-lens='open'] .kln-heat {
    visibility: visible;
  }

  /* Inside the lens: each letter's cell is sized by its invisible ink glyph, the serif italic sits centred on it */
  .kln-hc {
    display: inline-grid;
    align-items: baseline;
    justify-items: center;
  }

  .kln-hc > * {
    grid-area: 1 / 1;
  }

  .kln-hc-size {
    visibility: hidden;
  }

  .kln-hc-face {
    font-family: var(--font-kln-serif);
    font-size: 1.12em;
    font-stretch: normal;
    font-style: italic;
    font-weight: 400;
    letter-spacing: 0;
  }

  /* The pixel word in the pixel face, a touch larger since Handjet runs small; it heats under the lens too */
  .kln-px-word {
    font-family: var(--font-kln-pixel);
    font-size: 1.14em;
    font-stretch: normal;
    font-weight: 600;
    line-height: 0.84;
    letter-spacing: 0.02em;
    font-variation-settings:
      'ELSH' 2,
      'ELGR' 1,
      'wght' 600;
  }

  /* ---------- Insights card ---------- */

  /* A white card boxed like the panel: a status head, an accordion of topics, a footer with one link */
  .kln-services {
    padding: 6px;
    border: 1px solid var(--color-kln-line-box);
    border-radius: 22px;
    background-color: var(--color-kln-card);
    box-shadow:
      0 1px 0 rgb(0 0 0 / 0.02),
      0 18px 40px -24px rgb(20 20 20 / 0.28);
  }

  .kln-services-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 8px;
  }

  .kln-services-status {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-kln-ink);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .kln-services-dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background-color: #3fb27f;
    box-shadow: 0 0 0 3px rgb(63 178 127 / 0.18);
  }

  /* One topic; the open one sits on a soft grey plate and unfolds its line (grid rows 0fr → 1fr) */
  .kln-svc {
    position: relative;
    display: block;
    overflow: hidden;
    padding: 10px 12px;
    border-radius: 16px;
    transition: background-color 0.3s ease;
  }

  .kln-svc-on {
    background-color: #f5f5f4;
  }

  .kln-svc-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .kln-svc-index {
    color: var(--color-kln-muted);
    transition: color 0.3s ease;
  }

  .kln-svc-name {
    flex: 1;
    color: var(--color-kln-muted);
    font-family: var(--font-kln-display);
    font-size: 1.5rem;
    font-stretch: 75%;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.005em;
    text-transform: uppercase;
    transition: color 0.3s ease;
  }

  .kln-svc-on .kln-svc-name,
  .kln-svc-on .kln-svc-index {
    color: var(--color-kln-ink);
  }

  .kln-svc-arrow {
    color: var(--color-kln-ink);
    opacity: 0;
    translate: -6px 6px;
    transition:
      opacity 0.3s ease,
      translate 0.35s var(--kln-ease);
  }

  .kln-svc-on .kln-svc-arrow {
    opacity: 1;
    translate: 0 0;
  }

  .kln-svc-more {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.4s var(--kln-ease);
  }

  .kln-svc-on .kln-svc-more {
    grid-template-rows: 1fr;
  }

  .kln-svc-line {
    min-height: 0;
    overflow: hidden;
    padding-left: 30px;
    color: var(--color-kln-body);
    font-size: 0.8125rem;
    line-height: 1.45;
    opacity: 0;
    transition: opacity 0.3s ease;
  }

  .kln-svc-on .kln-svc-line {
    padding-top: 6px;
    opacity: 1;
    transition-delay: 0.1s;
  }

  .kln-services-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 4px;
    padding: 10px 6px 4px 12px;
    border-top: 1px solid var(--color-kln-line);
    color: var(--color-kln-muted);
    font-size: 0.8125rem;
    white-space: nowrap;
  }

  /* ---------- Bottom bar ---------- */

  /* Only the page links, centred under the panel */
  .kln-bar {
    display: grid;
    justify-items: center;
    padding-block: 8px;
  }

  .kln-tabs {
    padding: 3px;
    border-radius: 999px;
    background-color: var(--color-kln-chrome);
  }

  .kln-tab {
    position: relative;
    display: grid;
    place-items: center;
    height: 32px;
    padding-inline: 14px;
    border-radius: 999px;
    color: var(--color-kln-muted);
    font-size: 0.75rem;
    font-weight: 500;
    white-space: nowrap;
    transition: color 0.2s ease;
  }

  .kln-tab:hover {
    color: var(--color-kln-ink);
  }

  .kln-tab-on,
  .kln-tab-on:hover {
    color: #ffffff;
  }

  .kln-tab-marker {
    position: absolute;
    inset: 0;
    border-radius: 999px;
    background-color: var(--color-kln-ink);
  }

  @media (prefers-reduced-motion: reduce) {
    .kln-crawl {
      animation: none;
    }
  }
}
`

export default PixelHeatHero
