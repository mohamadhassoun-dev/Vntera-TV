import { useEffect, useRef, useState } from 'react'
import type { ProgressEntry, Title } from '../types'
import { PosterCard, NumberedCard, ContinueCard, ChannelCard } from './cards'
import { CollectionCard } from './CollectionCard'
import { SectionHeading } from './Badges'
import { Icon } from './Icons'
import { scrollRail } from '../lib/platform'
import { loadProgressMap } from '../lib/progress'
import type { ResolvedShortcut } from '../store/shortcuts'

/**
 * Rails below the first screen attach a couple per frame instead of all inside
 * the tap that opened the page.
 *
 * Home mounts fifteen rails, roughly 340 posters: rendering them in one commit
 * was a 300 ms task on the click, and every card is below the fold anyway. The
 * first few rails, which are what the opening frame actually shows, still mount
 * synchronously; the rest queue up behind two animation frames and land within a
 * fifth of a second — off screen, in the same order, with the same markup. The
 * rail's own height is already reserved by containIntrinsicSize, so nothing
 * shifts when they arrive.
 */
const IMMEDIATE_RAILS = 3
let immediateBudget = IMMEDIATE_RAILS
let mountQueue: Array<() => void> = []
let drainScheduled = false

function scheduleRailMount(mount: () => void) {
  mountQueue.push(mount)
  if (drainScheduled) return
  drainScheduled = true
  const drain = () => {
    drainScheduled = false
    for (const run of mountQueue.splice(0, 2)) run()
    if (mountQueue.length) {
      drainScheduled = true
      requestAnimationFrame(drain)
    }
  }
  requestAnimationFrame(drain)
}

/** The next page starts with a fresh synchronous allowance. */
function resetImmediateBudget() {
  immediateBudget = IMMEDIATE_RAILS
}

export function Rail({
  title,
  meta,
  action,
  arrows = true,
  minItems,
  children,
}: {
  title?: string
  meta?: string
  action?: React.ReactNode
  arrows?: boolean
  /** Hide the whole rail when fewer than this many cards survive. */
  minItems?: number
  children: React.ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [tooFew, setTooFew] = useState(false)
  const [mounted, setMounted] = useState(() => immediateBudget-- > 0)

  useEffect(() => {
    if (mounted) return
    let cancelled = false
    scheduleRailMount(() => {
      if (cancelled) return
      setMounted(true)
      // The budget refills once this page's rails have been handed out, so the
      // next route opened gets its own synchronous head start.
      resetImmediateBudget()
    })
    return () => {
      cancelled = true
    }
  }, [mounted])

  useEffect(() => {
    // Until this rail's cards are mounted there is nothing to count, and an
    // empty rail must not be mistaken for one with too few cards.
    if (!minItems || !mounted) return
    const el = ref.current
    if (!el) return
    const check = () => {
      // `offsetParent` is null for everything inside a `content-visibility:auto`
      // section that has not been laid out yet — which is every rail below the
      // first screen. Counting that as "no cards" removed those rails for good,
      // so the brand rows and IMDb never appeared at all. The DOM count is the
      // truthful one: a card whose artwork failed has already removed itself.
      const cards = [...el.querySelectorAll('a')].filter((a) => !a.hasAttribute('data-logo-card'))
      setTooFew(cards.length < minItems)
    }
    check()
    const observer = new MutationObserver(check)
    observer.observe(el, { childList: true, subtree: true })
    const settle = window.setTimeout(check, 1500)
    return () => {
      observer.disconnect()
      window.clearTimeout(settle)
    }
  }, [minItems, mounted])

  if (tooFew) return null

  return (
    <section
      className="rail-section min-w-0"
      style={{ contentVisibility: 'auto', containIntrinsicSize: '320px' }}
    >
      {title ? (
        <SectionHeading
          title={title}
          meta={meta}
          action={
            <div className="flex items-center gap-1">
              {action}
              {arrows ? (
                <>
                  <button
                    className="hidden h-8 w-8 items-center justify-center rounded-[4px] bg-layer-3 text-ink-soft transition-colors hover:bg-layer-4 hover:text-white md:flex"
                    onClick={() => ref.current && scrollRail(ref.current, -1)}
                    aria-label="Scroll left"
                    data-nav="true"
                  >
                    <Icon name="chevronLeft" size={16} />
                  </button>
                  <button
                    className="hidden h-8 w-8 items-center justify-center rounded-[4px] bg-layer-3 text-ink-soft transition-colors hover:bg-layer-4 hover:text-white md:flex"
                    onClick={() => ref.current && scrollRail(ref.current, 1)}
                    aria-label="Scroll right"
                    data-nav="true"
                  >
                    <Icon name="chevronRight" size={16} />
                  </button>
                </>
              ) : null}
            </div>
          }
        />
      ) : null}
      <div className="rail no-scrollbar" ref={ref}>
        {mounted ? children : null}
      </div>
    </section>
  )
}

export function PosterRail({
  title,
  meta,
  titles,
  action,
  progressByKey,
  arrows,
  lead,
  minItems,
}: {
  /** Optional: rows led by their own logo card need no heading. */
  title?: string
  meta?: string
  titles: Title[]
  action?: React.ReactNode
  progressByKey?: boolean
  arrows?: boolean
  lead?: React.ReactNode
  minItems?: number
}) {
  if (!titles.length) return null
  const map = progressByKey ? loadProgressMap() : {}
  return (
    <Rail title={title} meta={meta} action={action} arrows={arrows} minItems={minItems}>
      {/* Pinned on desktop and TV: the wordmark stays put while its posters
          scroll past, so the row never loses its label. */}
      {lead ? <div className="rail-lead">{lead}</div> : null}
      {titles.map((t, i) => (
        <PosterCard key={`${t.key}-${t.id}`} title={t} progress={map[`${t.kind}:${t.id}`]} priority={i < 4} />
      ))}
    </Rail>
  )
}

export function ChannelRail({
  title,
  channels,
  arrows,
  hideMeta,
  minItems,
}: {
  title: string
  channels: Title[]
  arrows?: boolean
  hideMeta?: boolean
  minItems?: number
}) {
  if (!channels.length) return null
  return (
    <Rail title={title} arrows={arrows} minItems={minItems}>
      {channels.map((c) => (
        <div key={c.id} className="w-[13.5rem] shrink-0 empty:hidden md:w-[16rem]">
          <ChannelCard channel={c} hideMeta={hideMeta} />
        </div>
      ))}
    </Rail>
  )
}

export function ShortcutChannelRail({ entries, onEdit }: { entries: ResolvedShortcut[]; onEdit?: () => void }) {
  if (!entries.length) {
    if (!onEdit) return null
    return (
      <div className="flex items-center gap-2 rounded-[4px] border border-dashed border-stroke px-3 py-2.5 text-[11px] text-ink-mute">
        <span className="flex-1">No shortcut channels yet.</span>
        <button className="font-bold uppercase tracking-wide text-white" onClick={onEdit} data-nav="true">
          Add
        </button>
      </div>
    )
  }
  return (
    <Rail
      title="Shortcut channels"
      arrows={false}
      action={
        onEdit ? (
          <button
            className="flex h-9 items-center gap-1 rounded-[3px] border border-stroke px-2.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft transition-colors hover:text-white"
            onClick={onEdit}
            data-nav="true"
            aria-label="Edit shortcut channels"
          >
            <Icon name="settings" size={12} /> Edit
          </button>
        ) : undefined
      }
    >
      {entries.map((entry) => (
        <div key={entry.key} className="w-[13.5rem] shrink-0 empty:hidden md:w-[16rem]">
          {entry.channel ? (
            <ChannelCard channel={entry.channel} displayName={entry.label} compact />
          ) : (
            <CollectionCard
              kind={entry.item.type === 'collection' ? entry.item.slug : 'category'}
              label={entry.label}
              href={entry.href ?? '/'}
            />
          )}
        </div>
      ))}
    </Rail>
  )
}

export function ContinueRail({
  entries,
  title = 'Continue Watching',
  arrows,
}: {
  entries: ProgressEntry[]
  title?: string
  arrows?: boolean
}) {
  if (!entries.length) return null
  return (
    <Rail title={title} arrows={arrows}>
      {entries.map((e) => (
        <ContinueCard key={`${e.contentType}:${e.contentId}:${e.season ?? 0}:${e.episode ?? 0}`} entry={e} />
      ))}
    </Rail>
  )
}

export function TopTenRail({ titles, arrows, minItems }: { titles: Title[]; arrows?: boolean; minItems?: number }) {
  if (!titles.length) return null
  return (
    <Rail title="Top 10 on Vntera Today" arrows={arrows} minItems={minItems}>
      {titles.map((t, i) => (
        <NumberedCard key={t.id} title={t} rank={i + 1} />
      ))}
    </Rail>
  )
}
