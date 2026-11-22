import type { LucideIcon } from 'lucide-react'
import type { CSSProperties, ReactNode } from 'react'
import { Link } from 'react-router'

import DotText from '@/components/dots/DotText'

type PropsStatCard = {
  title: string
  subtitle: string
  icon: LucideIcon
  /** Heat colour for the display, icon and chart. */
  color: string
  /** The big dot-matrix value, for example "1,204" or "52%". */
  value: string
  /** Accessible reading of the value. */
  valueLabel: string
  /** Opens the matching detail list when given. */
  to?: string
  /** The minimal pixel visualisation. */
  chart: ReactNode
  note?: ReactNode
}

const StatCard = ({ title, subtitle, icon: Icon, color, value, valueLabel, to, chart, note }: PropsStatCard) => {
  const body = (
    <>
      <div className='ix-card-head'>
        <div>
          <h3 className='ix-card-title'>{title}</h3>
          <p className='ix-card-sub'>{subtitle}</p>
        </div>
        <span aria-hidden className='ix-card-icon' style={{ '--ix-icon': color } as CSSProperties}>
          <Icon size={15} strokeWidth={1.75} />
        </span>
      </div>

      <div className='ix-metric'>
        <DotText text={value.toUpperCase()} label={valueLabel} dot={6} color={color} />
      </div>

      <div className='ix-card-foot'>
        {chart}
        {note && <p className='ix-card-note'>{note}</p>}
      </div>
    </>
  )

  return to ? (
    <Link to={to} className='ix-card' aria-label={`${title}: ${valueLabel}. Open the list.`}>
      {body}
    </Link>
  ) : (
    <article className='ix-card' aria-label={`${title}: ${valueLabel}`}>
      {body}
    </article>
  )
}

export default StatCard
