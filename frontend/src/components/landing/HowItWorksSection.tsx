import type { CSSProperties } from 'react'

import './landing-sections.css'

const HEAT = ['#8593ea', '#a98ae6', '#e88bb3', '#f5a07a', '#f6d08a']

// Squares in the progress strip at the top of each card
const STRIP = 10

const FORMAT_ROWS = [
  { label: 'Information', value: 'Followers and following' },
  { label: 'Format', value: 'JSON' }
]

const CHECKS = ['Safe paths', 'Sizes', 'File types']

const RESULTS = ['Followers', 'Following', 'Mutuals', 'One-sided']

const STEPS = [
  {
    name: 'Request your export',
    body: 'In Instagram, open Accounts Center, then Your information and permissions, then Export your information. Menu names change from time to time.',
    lit: 3
  },
  {
    name: 'Upload the ZIP',
    body: 'Download the archive Instagram prepares, then add it here. It is checked for safe paths, sizes and file types before anything is read.',
    lit: 6
  },
  {
    name: 'Decode your network',
    body: 'See your followers, following and mutual connections, plus who does not follow back, each with a direct profile link.',
    lit: 10
  }
]

// The progress strip: the first `lit` squares glow along the heat ramp, the rest stay empty
const Strip = ({ lit }: { lit: number }) => {
  return (
    <div aria-hidden className='inyx-strip'>
      {Array.from({ length: STRIP }, (_, i) => (
        <span
          key={i}
          className='inyx-sq'
          style={i < lit ? ({ '--sq': HEAT[Math.min(HEAT.length - 1, Math.floor((i / STRIP) * HEAT.length))] } as CSSProperties) : undefined}
          data-lit={i < lit}
        />
      ))}
    </div>
  )
}

const StepDetail = ({ index }: { index: number }) => {
  if (index === 0) {
    return (
      <div className='inyx-window'>
        <p className='inyx-window-bar'>Export.settings</p>
        <dl className='inyx-window-card'>
          {FORMAT_ROWS.map(row => (
            <div key={row.label} className='inyx-window-row'>
              <dt className='kln-mono'>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  if (index === 1) {
    return (
      <ul className='inyx-chips'>
        {CHECKS.map(check => (
          <li key={check} className='inyx-chip'>
            <span aria-hidden className='kln-services-dot' />
            {check}
          </li>
        ))}
      </ul>
    )
  }

  return (
    <ul className='inyx-chips'>
      {RESULTS.map((result, i) => (
        <li key={result} className='inyx-chip'>
          <span aria-hidden className='inyx-chip-sq' style={{ '--sq': HEAT[i + 1] } as CSSProperties} />
          {result}
        </li>
      ))}
    </ul>
  )
}

const HowItWorksSection = () => {
  return (
    <div className='inyx-wrap'>
      <section id='how-it-works' aria-labelledby='how-title' className='inyx-panel'>
        <div className='inyx-head'>
          <p className='kln-mono inyx-muted'>01 / How it works</p>
          <p className='kln-services-status'>
            <span aria-hidden className='kln-services-dot' />3 steps, no login
          </p>
        </div>

        <h2 id='how-title' className='inyx-title'>
          <span className='inyx-title-line'>From export</span>{' '}
          <span className='inyx-title-line'>
            to <span className='kln-px-word'>insight</span>.
          </span>
        </h2>

        <p className='inyx-lede'>
          INYX reads the data Instagram already gives you. Request your export, drop it in, and decode your
          connections.
        </p>

        <ol className='inyx-steps'>
          {STEPS.map((step, index) => (
            <li key={step.name} className='inyx-card'>
              <Strip lit={step.lit} />
              <p className='kln-mono inyx-muted inyx-card-index'>{String(index + 1).padStart(2, '0')}</p>
              <h3 className='inyx-card-name'>{step.name}</h3>
              <p className='inyx-card-body'>{step.body}</p>
              <StepDetail index={index} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  )
}

export default HowItWorksSection
