import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { Icon } from './Icons'

export interface SelectOption {
  value: string
  label: string
  /** Small trailing note, e.g. how many titles the option matches. */
  meta?: string
}

/**
 * The app's dropdown.
 *
 * A native <select> paints the operating system's own list — a bright popup on
 * Android and desktop, and on a television it cannot be reached with the D-pad
 * at all. This draws the list in the app's own surface, with large rows for a
 * thumb, a crimson frame for the remote, and full keyboard support.
 */
export function Select({
  label,
  value,
  onChange,
  options,
  align = 'left',
  className = '',
  compact = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  align?: 'left' | 'right'
  className?: string
  /** Tighter trigger, for filter bars. */
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const id = useId()
  const current = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, options.findIndex((option) => option.value === value)))
    const onDocPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDocPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, options, value])

  // Keep the highlighted row in view when the list is longer than the screen.
  useLayoutEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(options.length - 1, index + 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(0, index - 1))
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActive(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActive(options.length - 1)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[active]
      if (option) choose(option.value)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        data-nav="true"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-label={`${label}: ${current?.label ?? ''}`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onKeyDown}
        className={`flex min-h-11 w-full items-center gap-2 rounded-[4px] border transition-colors sm:min-h-0 ${
          open ? 'border-crimson/70 bg-layer-3' : 'border-stroke bg-layer-1 hover:border-white/25'
        } ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
      >
        <span className="shrink-0 text-[9px] font-extrabold uppercase tracking-[0.14em] text-ink-mute">{label}</span>
        <span className="min-w-0 flex-1 truncate text-left text-[12px] font-semibold text-white">{current?.label ?? '—'}</span>
        <Icon name="chevronDown" size={13} className={`shrink-0 text-ink-mute transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open ? (
        <div
          id={`${id}-list`}
          ref={listRef}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
          className={`absolute z-50 mt-1.5 max-h-[min(22rem,60vh)] w-full min-w-[11rem] overflow-y-auto rounded-lg border border-stroke bg-[#151515]/98 p-1 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.95)] backdrop-blur-xl ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
          style={{ scrollbarWidth: 'thin' }}
        >
          {options.map((option, index) => {
            const selected = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selected}
                data-nav="true"
                data-index={index}
                onPointerEnter={() => setActive(index)}
                onClick={() => choose(option.value)}
                className={`flex w-full items-center gap-2 rounded-[5px] px-3 py-2.5 text-left text-[13px] transition-colors ${
                  index === active ? 'bg-layer-3 text-white' : 'text-ink-soft'
                } ${selected ? 'font-bold' : 'font-medium'}`}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${selected ? 'bg-crimson' : 'bg-transparent'}`} />
                <span className="min-w-0 flex-1 truncate">{option.label}</span>
                {option.meta ? <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink-mute">{option.meta}</span> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
