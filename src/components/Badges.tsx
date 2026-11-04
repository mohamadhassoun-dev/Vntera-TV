import type { Quality, Title } from '../types'
import { PROVIDER_COLORS, PROVIDER_LABELS, QUALITY_LABELS } from '../lib/config'
import { Icon } from './Icons'

export function QualityBadge({ quality, size = 'sm' }: { quality: Quality; size?: 'sm' | 'md' }) {
  if (quality === 'SD') return null
  return (
    <span className={`badge ${quality === '4K' ? 'badge-4k' : ''} ${size === 'md' ? '!h-[22px] !text-[11px]' : ''}`}>
      {quality === '4K' ? '4K UHD' : quality === 'FHD' ? 'FHD' : 'HD'}
    </span>
  )
}

export function qualityTitle(quality: Quality): string {
  return QUALITY_LABELS[quality]
}

export function LiveBadge({ label = 'LIVE' }: { label?: string }) {
  return (
    <span className="badge badge-live">
      <span className="dot" />
      {label}
    </span>
  )
}

export function RatingBadge({ rating }: { rating?: number }) {
  if (!rating) return null
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-bold tabular text-gold">
      <Icon name="star" size={11} strokeWidth={0} className="fill-gold" />
      {rating.toFixed(1)}
    </span>
  )
}

export function ProviderChip({ title }: { title: Title }) {
  if (title.provider === 'other') return null
  const color = PROVIDER_COLORS[title.provider]
  return (
    <span
      className="provider-chip"
      style={{
        background: `${color}22`,
        color: title.provider === 'apple' ? '#fff' : color,
        border: `1px solid ${color}66`,
      }}
    >
      {PROVIDER_LABELS[title.provider]}
    </span>
  )
}

export function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-[3px] w-full bg-white/20 ${className}`}>
      <div className="h-full bg-crimson" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  )
}

export function SectionHeading({
  title,
  meta,
  action,
}: {
  title: string
  meta?: string
  action?: React.ReactNode
}) {
  return (
    <div className="mb-2 flex items-end justify-between gap-3">
      <div className="flex items-baseline gap-2.5 min-w-0">
        <h2 className="section-title truncate">{title}</h2>
        {meta ? <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-widest text-crimson">{meta}</span> : null}
      </div>
      {action}
    </div>
  )
}
