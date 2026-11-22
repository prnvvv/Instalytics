import './landing-sections.css'
import PixelDrips from './PixelDrips'

const NEVER = [
  { name: 'Your password', line: 'INYX never asks for your Instagram password.' },
  { name: 'Cookies or tokens', line: 'No session cookies, no tokens and no account authorisation.' },
  { name: 'Scraping', line: 'Nothing is pulled from Instagram. INYX only reads the export you give it.' },
  { name: 'Acting for you', line: 'It never follows, unfollows or messages anyone on your behalf.' }
]

const ALWAYS = [
  { name: 'Your own export', line: 'Only the archive you download yourself.' },
  { name: 'Your decision', line: 'You choose what to upload, and when.' },
  { name: 'Explainable numbers', line: 'Every figure is a documented set comparison.' }
]

const PrivacySection = () => {
  return (
    <div className='inyx-wrap'>
      <section id='privacy' aria-labelledby='privacy-title' className='inyx-panel inyx-panel-drips'>
        <PixelDrips seed={4} />

        <div className='inyx-split'>
          <div>
            <p className='kln-mono inyx-muted'>02 / Privacy first</p>

            <h2 id='privacy-title' className='inyx-title inyx-title-tight'>
              <span className='inyx-title-line'>No login.</span>{' '}
              <span className='inyx-title-line'>No credentials.</span>{' '}
              <span className='inyx-title-line'>
                Just your <span className='kln-px-word'>data</span>.
              </span>
            </h2>

            <p className='inyx-lede'>
              INYX is an analytics tool, not an Instagram client. It works from your own export and nothing else, so
              there is nothing to log into and nothing to hand over.
            </p>
          </div>

          <div className='inyx-card inyx-card-flat'>
            <div className='inyx-card-head'>
              <p className='kln-mono inyx-muted'>What INYX never does</p>
              <p className='kln-services-status'>
                <span aria-hidden className='kln-services-dot' />
                By design
              </p>
            </div>

            <ul>
              {NEVER.map((item, i) => (
                <li key={item.name} className='inyx-row'>
                  <span className='kln-mono inyx-muted'>{String(i + 1).padStart(2, '0')}</span>
                  <span className='inyx-row-name'>{item.name}</span>
                  <span className='inyx-row-line'>{item.line}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <ul className='inyx-always'>
          {ALWAYS.map(item => (
            <li key={item.name}>
              <p className='inyx-always-name'>
                <span aria-hidden className='kln-hot-dot' />
                {item.name}
              </p>
              <p className='inyx-always-line'>{item.line}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default PrivacySection
