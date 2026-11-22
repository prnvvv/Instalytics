import PixelHeatHero from '@/components/ui/kiln-pixel-heat-hero'

const STEPS = [
  {
    title: 'Request your export',
    body: 'In the Instagram app or website, open Accounts Center, then Your information and permissions, then Export your information. Choose Followers and following and select the JSON format. Menu names change from time to time.'
  },
  {
    title: 'Download the ZIP',
    body: 'Instagram prepares the archive and tells you when it is ready. It is your own data, downloaded by you, straight from Instagram.'
  },
  {
    title: 'Explore your network',
    body: 'Upload the ZIP to see your followers, following, mutual connections and the accounts that do not follow back, each with a direct profile link.'
  }
]

const PROMISES = [
  {
    title: 'No Instagram login',
    body: 'Instalytics never asks for your password, session cookies or any account authorisation.'
  },
  {
    title: 'No scraping, no automation',
    body: 'It only reads the export you give it. It never follows, unfollows or messages anyone for you.'
  },
  {
    title: 'You stay in control',
    body: 'You choose what to upload, and the analysis is explainable: every number comes from simple, documented set comparisons.'
  }
]

const LandingPage = () => {
  return (
    <>
      <PixelHeatHero />

      <div className='mx-auto w-full max-w-5xl px-4 sm:px-6'>
        <section id='how-it-works' aria-labelledby='how-title' className='scroll-mt-20 py-20 sm:py-28'>
          <h2 id='how-title' className='text-3xl font-semibold tracking-tight sm:text-4xl'>
            How it works
          </h2>
          <p className='mt-3 max-w-2xl text-neutral-600'>
            Three steps, and Instagram never learns that Instalytics exists.
          </p>
          <ol className='mt-10 grid gap-4 sm:grid-cols-3'>
            {STEPS.map((step, index) => (
              <li key={step.title} className='rounded-2xl border border-neutral-200 p-6'>
                <span className='text-sm font-medium text-neutral-500'>{String(index + 1).padStart(2, '0')}</span>
                <h3 className='mt-2 text-lg font-semibold'>{step.title}</h3>
                <p className='mt-2 text-sm leading-relaxed text-neutral-600'>{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section id='privacy' aria-labelledby='privacy-title' className='scroll-mt-20 pb-20 sm:pb-28'>
          <h2 id='privacy-title' className='text-3xl font-semibold tracking-tight sm:text-4xl'>
            Privacy first
          </h2>
          <ul className='mt-10 grid gap-4 sm:grid-cols-3'>
            {PROMISES.map(promise => (
              <li key={promise.title} className='rounded-2xl bg-neutral-100 p-6'>
                <h3 className='text-lg font-semibold'>{promise.title}</h3>
                <p className='mt-2 text-sm leading-relaxed text-neutral-600'>{promise.body}</p>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <footer className='border-t border-neutral-200 py-8 text-center text-sm text-neutral-500'>
        Instalytics is an independent analytics tool and is not affiliated with Instagram or Meta.
      </footer>
    </>
  )
}

export default LandingPage
