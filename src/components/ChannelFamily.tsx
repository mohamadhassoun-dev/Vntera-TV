import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Art } from './Art'
import { LiveBadge, QualityBadge } from './Badges'
import { Icon } from './Icons'
import { channelVariantMeta, type ChannelFamily } from '../lib/channelFamilies'

/** One card for every feed of a brand (Al Jazeera, MTV, beIN …). */
export function ChannelFamilyCard({
  family,
  view = 'grid',
  onOpen,
}: {
  family: ChannelFamily
  view?: 'grid' | 'list'
  onOpen: (family: ChannelFamily) => void
}) {
  const channel = family.primary
  const feeds = family.members.length

  if (view === 'list') {
    return (
      <button
        type="button"
        onClick={() => onOpen(family)}
        data-nav="true"
        className="group flex w-full items-center gap-3 rounded-[4px] border border-stroke bg-layer-1 p-2.5 text-left transition-colors hover:bg-layer-2 focus-visible:outline-none"
        aria-label={`${family.label}, ${feeds} feeds. Choose a feed`}
      >
        <div className="relative h-14 w-20 shrink-0 overflow-hidden rounded-[3px] bg-layer-2">
          <Art src={channel.poster} title={channel.name} kind="channel" seed={channel.name} className="h-full w-full object-contain" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold">{family.label}</p>
            <QualityBadge quality={channel.quality} />
            <LiveBadge />
          </div>
          <p className="mt-0.5 truncate text-[11px] text-ink-mute">
            {feeds} feeds · {channelVariantMeta(channel)}
          </p>
        </div>
        <span className="flex h-8 shrink-0 items-center gap-1 rounded-[3px] border border-white/25 px-2 text-[10px] font-bold uppercase tracking-wide text-white">
          {feeds} <Icon name="layers" size={13} />
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(family)}
      data-nav="true"
      className="group block w-full overflow-hidden rounded-[4px] border border-stroke bg-layer-1 text-left transition-colors hover:border-white/30 focus-visible:outline-none"
      aria-label={`${family.label}, ${feeds} feeds. Choose a feed`}
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-layer-2 to-canvas">
        <Art
          src={channel.poster}
          title={channel.name}
          kind="channel"
          seed={channel.name}
          className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute left-1.5 top-1.5 flex gap-1">
          <LiveBadge />
        </div>
        <div className="absolute right-1.5 top-1.5 flex gap-1">
          <QualityBadge quality={channel.quality} />
        </div>
        <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-[3px] bg-black/75 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          <Icon name="layers" size={11} /> {feeds} feeds
        </span>
      </div>
      <div className="p-2">
        <p className="truncate text-[13px] font-semibold">{family.label}</p>
        <p className="truncate text-[11px] text-ink-mute">{channelVariantMeta(channel)}</p>
      </div>
    </button>
  )
}

/** Variant picker shown when a grouped channel card is pressed. */
export function ChannelFamilyDialog({ family, onClose }: { family: ChannelFamily; onClose: () => void }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={`${family.label} feeds`}
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-hidden rounded-t-xl border border-stroke bg-layer-1 shadow-2xl sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stroke px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{family.label}</p>
            <p className="text-[11px] text-ink-mute">{family.members.length} feeds · choose one to play</p>
          </div>
          <button className="icon-btn !h-8 !w-8" onClick={onClose} aria-label="Close feed picker" data-nav="true">
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto p-2">
          {family.members.map((channel) => (
            <Link
              key={channel.id}
              to={`/watch/live/${channel.id}`}
              data-nav="true"
              className="flex items-center gap-3 rounded-[4px] px-2 py-2 transition-colors hover:bg-layer-3"
            >
              <div className="relative h-10 w-14 shrink-0 overflow-hidden rounded-[2px] bg-layer-2">
                <Art src={channel.poster} title={channel.name} kind="channel" seed={channel.name} className="h-full w-full object-contain" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{channel.name}</p>
                <p className="truncate text-[11px] text-ink-mute">{channelVariantMeta(channel)}</p>
              </div>
              <QualityBadge quality={channel.quality} />
              <Icon name="play" size={15} className="shrink-0 text-ink-soft" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
