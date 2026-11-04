import { Link } from 'react-router-dom'
import { Icon, type IconName } from './Icons'

const STYLES: Record<string, { icon: IconName; gradient: string; hint: string }> = {
  kids: { icon: 'sparkles', gradient: 'from-[#1d4ed8]/70 via-[#0f172a] to-canvas', hint: 'Cartoons & kids only' },
  anime: { icon: 'star', gradient: 'from-[#9d174d]/70 via-[#1a0b14] to-canvas', hint: 'Anime only' },
  category: { icon: 'tv', gradient: 'from-[#0f766e]/70 via-[#0b1a1a] to-canvas', hint: 'Live category' },
}

/** Non-channel Shortcut card: Kids, Anime, or a whole live category. */
export function CollectionCard({
  kind,
  label,
  href,
  view = 'grid',
}: {
  kind: 'kids' | 'anime' | 'category'
  label: string
  href: string
  view?: 'grid' | 'list'
}) {
  const style = STYLES[kind] ?? STYLES.category

  if (view === 'list') {
    return (
      <Link
        to={href}
        data-nav="true"
        className="group flex items-center gap-3 rounded-[4px] border border-stroke bg-layer-1 p-2.5 transition-colors hover:bg-layer-2 focus-visible:outline-none"
        aria-label={`Open ${label}`}
      >
        <span className={`flex h-14 w-20 shrink-0 items-center justify-center rounded-[3px] bg-gradient-to-br ${style.gradient}`}>
          <Icon name={style.icon} size={22} className="text-white/90" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{label}</span>
          <span className="block truncate text-[11px] text-ink-mute">{style.hint}</span>
        </span>
        <Icon name="chevronRight" size={15} className="shrink-0 text-ink-mute" />
      </Link>
    )
  }

  return (
    <Link
      to={href}
      data-nav="true"
      className="group block w-full overflow-hidden rounded-[4px] border border-stroke bg-layer-1 transition-colors hover:border-white/30 focus-visible:outline-none"
      aria-label={`Open ${label}`}
    >
      <span className={`relative flex aspect-video w-full items-center justify-center bg-gradient-to-br ${style.gradient}`}>
        <Icon name={style.icon} size={38} className="text-white/85 transition-transform duration-500 group-hover:scale-110" />
      </span>
      <span className="block p-2">
        <span className="block truncate text-[13px] font-semibold">{label}</span>
        <span className="block truncate text-[11px] text-ink-mute">{style.hint}</span>
      </span>
    </Link>
  )
}
