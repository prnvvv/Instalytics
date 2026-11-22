import HowItWorksSection from '@/components/landing/HowItWorksSection'
import PrivacySection from '@/components/landing/PrivacySection'
import SiteFooter from '@/components/landing/SiteFooter'
import PixelHeatHero from '@/components/ui/kiln-pixel-heat-hero'

const LandingPage = () => {
  return (
    <>
      <PixelHeatHero />
      <HowItWorksSection />
      <PrivacySection />
      <SiteFooter />
    </>
  )
}

export default LandingPage
