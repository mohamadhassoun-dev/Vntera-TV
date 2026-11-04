import { useEffect, useMemo, useState } from 'react'
import { Icon, type IconName } from './Icons'
import type { Title } from '../types'
import { COLLECTIONS } from '../lib/collections'
import type { ShortcutItem } from '../store/shortcuts'

function itemKey(item: ShortcutItem): string {
  if (item.type === 'channel') return `channel:${item.id}`
  if (item.type === 'collection') return `collection:${item.slug}`
  return `category:${item.id}`
}

function itemIcon(item: ShortcutItem): IconName {
  if (item.type === 'collection') return item.slug === 'kids' ? 'sparkles' : 'star'
  if (item.type === 'category') return 'tv'
  return 'play'
}

function itemLabel(item: ShortcutItem): string {
  if (item.type === 'collection') return COLLECTIONS[item.slug].label
  return item.label
}

function itemKind(item: ShortcutItem): string {
  if (item.type === 'channel') return 'Channel'
  if (item.type === 'collection') return 'Collection'
  return 'Live category'
}

/** Lets the user rebuild the Home Shortcut channels column. */
export function ShortcutEditor({
  items,
  channels,
  categories,
  onChange,
  onReset,
  onClose,
}: {
  items: ShortcutItem[]
  channels: Title[]
  categories: Array<{ id: string; name: string }>
  onChange: (items: ShortcutItem[]) => void
  onReset: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(categories[0]?.id ?? '')

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const added = useMemo(() => new Set(items.map(itemKey)), [items])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return []
    const out: Title[] = []
    for (const channel of channels) {
      if (out.length >= 8) break
      if (added.has(`channel:${channel.id}`)) continue
      if (channel.name.toLowerCase().includes(needle)) out.push(channel)
    }
    return out
  }, [channels, query, added])

  const add = (item: ShortcutItem) => {
    if (added.has(itemKey(item))) return
    onChange([...items, item])
  }

  const remove = (key: string) => {
    onChange(items.filter((item) => itemKey(item) !== key))
  }

  const selectedCategory = categories.find((entry) => entry.id === category)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Edit shortcut channels"
      onClick={onClose}
    >
      <div
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-t-xl border border-stroke bg-layer-1 shadow-2xl sm:rounded-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stroke px-4 py-3">
          <div>
            <p className="text-sm font-bold">Edit shortcut channels</p>
            <p className="text-[11px] text-ink-mute">Add any channel or live category, remove what you do not use.</p>
          </div>
          <button className="icon-btn !h-8 !w-8" onClick={onClose} aria-label="Close editor" data-nav="true">
            <Icon name="close" size={16} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-mute">Your shortcuts</p>
          <div className="mt-2 space-y-1.5">
            {items.length ? (
              items.map((item) => (
                <div
                  key={itemKey(item)}
                  className="flex items-center gap-2 rounded-[4px] border border-stroke bg-layer-2/60 px-2.5 py-2"
                >
                  <Icon name={itemIcon(item)} size={15} className="shrink-0 text-ink-soft" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{itemLabel(item)}</span>
                  <span className="shrink-0 rounded-[2px] bg-layer-3 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-ink-mute">
                    {itemKind(item)}
                  </span>
                  <button
                    className="icon-btn !h-7 !w-7"
                    onClick={() => remove(itemKey(item))}
                    aria-label={`Remove ${itemLabel(item)}`}
                    data-nav="true"
                  >
                    <Icon name="close" size={13} />
                  </button>
                </div>
              ))
            ) : (
              <p className="text-xs text-ink-mute">No shortcuts yet — add a channel below.</p>
            )}
          </div>

          <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-mute">Add a channel</p>
          <div className="relative mt-2">
            <Icon name="search" size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-mute" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search any live channel"
              className="field !py-2 !pl-8"
              aria-label="Search channels to add"
            />
          </div>
          {matches.length ? (
            <div className="mt-1.5 space-y-1">
              {matches.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => {
                    add({ type: 'channel', id: channel.id, label: channel.name })
                    setQuery('')
                  }}
                  className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left transition-colors hover:bg-layer-3"
                  data-nav="true"
                >
                  <Icon name="plus" size={13} className="shrink-0 text-crimson" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{channel.name}</span>
                  <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-mute">{channel.quality}</span>
                </button>
              ))}
            </div>
          ) : query.trim() ? (
            <p className="mt-2 text-[11px] text-ink-mute">No channel matches that search.</p>
          ) : null}

          <p className="mt-5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-ink-mute">Add a live category</p>
          <div className="mt-2 flex gap-2">
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              className="min-w-0 flex-1 rounded-[3px] border border-stroke bg-layer-2 px-2 py-2 text-[12px] text-white"
              aria-label="Live category"
            >
              {categories.map((entry) => (
                <option key={entry.id} value={entry.id} className="bg-layer-2 text-white">
                  {entry.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary !py-2 text-xs"
              onClick={() => {
                if (!selectedCategory) return
                add({ type: 'category', id: selectedCategory.id, label: selectedCategory.name })
              }}
              data-nav="true"
            >
              <Icon name="plus" size={14} /> Add
            </button>
          </div>

        </div>

        <div className="flex items-center justify-between gap-2 border-t border-stroke px-4 py-3">
          <button className="btn btn-ghost !py-2 text-xs" onClick={onReset} data-nav="true">
            <Icon name="refresh" size={14} /> Restore defaults
          </button>
          <button className="btn btn-primary !py-2 text-xs" onClick={onClose} data-nav="true">
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
