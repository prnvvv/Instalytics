import './landing-sections.css'
import PixelDrips from './PixelDrips'

const LINKS = [
  { label: 'Index', href: '#home' },
  { label: 'How it works', href: '#how-it-works' },
  { label: 'Privacy', href: '#privacy' }
]

const SiteFooter = () => {
  return (
    <div className='inyx-wrap inyx-wrap-last'>
      <footer className='inyx-panel inyx-panel-drips'>
        <PixelDrips seed={11} />

        <div className='inyx-foot-top'>
          <div>
            <p className='inyx-wordmark' aria-label='INYX'>
              INYX
            </p>
            <p className='inyx-foot-tagline'>
              Your Instagram, <span className='kln-px-word'>decoded</span>.
            </p>
          </div>

          <nav aria-label='Footer' className='inyx-foot-nav'>
            <p className='kln-mono inyx-muted'>Pages</p>
            <ul>
              {LINKS.map(link => (
                <li key={link.label}>
                  <a href={link.href} className='inyx-foot-link'>
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className='inyx-foot-note'>
            <p className='kln-mono inyx-muted'>Our promise</p>
            <p>No login. No credentials. Just your data.</p>
          </div>
        </div>

        <div className='inyx-foot-bottom'>
          <p>INYX is an independent analytics tool and is not affiliated with Instagram or Meta.</p>
          <a href='#home' className='kln-pill'>
            <span aria-hidden className='kln-hot-dot' />
            Back to top
          </a>
        </div>
      </footer>
    </div>
  )
}

export default SiteFooter
