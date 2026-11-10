import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Art } from './Art'
import { LiveBadge } from './Badges'
import { Rail } from './Rails'
import { arabicChannelLabel } from '../lib/arabicChannels'
import { feedDefinition } from '../lib/liveFeeds'
import { channelArtSrc } from '../lib/normalize'
import type { Title } from '../types'

/**
 * One channel of a Home feed: its logo, name and LIVE tag — nothing else.
 *
 * A panel logo URL can be dead; the card then shows the feed's own brand logo
 * instead of a placeholder, so every card in the row keeps a real image.
 */
function FeedChannelTile({ channel, fallback }: { channel: Title; fallback: string }) {
  const [failed, setFailed] = useState(false)
  // Panel prefixes like "|AR.MBC|" are section tags, not part of the name.
  const label = arabicChannelLabel(channel.name)
  return (
    <Link
      to={`/watch/live/${channel.id}`}
      data-nav="true"
      aria-label={`${label}, live`}
      className="group flex w-[8.5rem] shrink-0 flex-col gap-1.5 focus-visible:outline-none md:w-[10rem]"
    >
      <span className="relative block aspect-video w-full overflow-hidden rounded-[4px] border border-stroke bg-gradient-to-br from-layer-2 to-canvas transition-colors group-hover:border-white/30">
        <Art
          src={failed ? fallback : channelArtSrc(channel)}
          title={label}
          kind="channel"
          seed={label}
          onFail={failed ? undefined : () => setFailed(true)}
          className="h-full w-full object-contain p-2 transition-transform duration-300 group-hover:scale-105"
        />
        <span className="absolute left-1 top-1">
          <LiveBadge />
        </span>
      </span>
      <span className="truncate text-center text-[10px] font-semibold leading-tight text-ink-soft transition-colors group-hover:text-white md:text-[11px]">
        {label}
      </span>
    </Link>
  )
}

/**
 * A plain live-channel row for one panel feed (ZEE TV, TOD beIN EVENTS …).
 * Deliberately unadorned: no stage artwork, no oversized heading, so it reads
 * as a quiet sibling of the brand rails it sits beside.
 */
export function LiveFeedRail({ feedKey, channels }: { feedKey: string; channels: Title[] }) {
  const feed = feedDefinition(feedKey)
  if (!feed || !channels.length) return null
  return (
    <Rail title={feed.label} meta={`${channels.length} live`} arrows={false} minItems={1}>
      {channels.map((channel) => (
        <FeedChannelTile key={channel.id} channel={channel} fallback={feed.fallbackLogo} />
      ))}
    </Rail>
  )
}
