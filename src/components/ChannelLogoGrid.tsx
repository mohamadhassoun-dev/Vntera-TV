import { Link } from 'react-router-dom'
import { Art } from './Art'
import { arabicChannelLabel } from '../lib/arabicChannels'
import type { ChannelFamily } from '../lib/channelFamilies'

/** Compact logo tile: seven fit a row on a phone, so three rows show everything. */
function ChannelLogoTile({ family }: { family: ChannelFamily }) {
  const channel = family.primary
  const label = arabicChannelLabel(family.label)
  return (
    <Link
      to={`/watch/live/${channel.id}`}
      data-nav="true"
      aria-label={`${label}, live${family.members.length > 1 ? `, ${family.members.length} feeds` : ''}`}
      className="group flex min-w-0 flex-col gap-1.5 focus-visible:outline-none"
    >
      <span className="relative block aspect-square w-full overflow-hidden rounded-[4px] border border-stroke bg-gradient-to-br from-layer-2 to-canvas transition-colors group-hover:border-white/30">
        <Art
          src={channel.poster}
          title={label}
          kind="channel"
          seed={label}
          className="h-full w-full object-contain p-1.5 transition-transform duration-300 group-hover:scale-105"
        />
        <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-live" />
      </span>
      <span className="truncate text-center text-[9px] font-semibold leading-tight text-ink-soft transition-colors group-hover:text-white sm:text-[10px]">
        {label}
      </span>
    </Link>
  )
}

/** Three rows of seven Arabic broadcasters, each with its logo. */
export function ChannelLogoGrid({ families, limit = 21 }: { families: readonly ChannelFamily[]; limit?: number }) {
  if (!families.length) return null
  return (
    <div className="grid grid-cols-7 gap-x-2 gap-y-3">
      {families.slice(0, limit).map((family) => (
        <ChannelLogoTile key={family.key} family={family} />
      ))}
    </div>
  )
}
