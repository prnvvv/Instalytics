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
  const style = { '--tile-c': color, '--ix-icon': color } as CSSProperties

  const body = (
    <>
      <div className='ix-tile-head'>
        <div style={{ minWidth: 0 }}>
          <h3 className='ix-tile-title'>{title}</h3>
          <p className='ix-tile-sub'>{subtitle}</p>
        </div>
        <span aria-hidden className='ix-tile-icon'>
          <Icon size={14} strokeWidth={1.75} />
        </span>
      </div>

      <div className='ix-metric'>
        <DotText text={value.toUpperCase()} label={valueLabel} dot={5} color={color} />
      </div>

      <div className='ix-tile-foot'>
        {chart}
        {note && <p className='ix-tile-note'>{note}</p>}
      </div>
    </>
  )

  return to ? (
    <Link to={to} className='ix-tile' style={style} aria-label={`${title}: ${valueLabel}. Open the list.`}>
      {body}
    </Link>
  ) : (
    <article className='ix-tile' style={style} aria-label={`${title}: ${valueLabel}`}>
      {body}
    </article>
  )
}

export default StatCard
