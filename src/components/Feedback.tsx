import { useEffect } from 'react'
import { Icon } from './Icons'
import type { IconName } from './Icons'

export function EmptyState({
  title,
  body,
  icon = 'info',
  action,
}: {
  title: string
  body?: string
  icon?: IconName
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-stroke bg-layer-1/60 px-6 py-16 text-center">
      <span className="mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-layer-3 text-ink-soft">
        <Icon name={icon} size={26} />
      </span>
      <h3 className="text-lg font-semibold">{title}</h3>
      {body ? <p className="mt-1.5 max-w-md text-sm text-ink-soft">{body}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width = 'max-w-lg',
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: React.ReactNode
  width?: string
}) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/80 p-0 backdrop-blur-md sm:items-center sm:p-4"
      data-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className={`w-full ${width} max-h-[92vh] overflow-y-auto rounded-t-xl border border-stroke bg-layer-1 p-5 shadow-2xl sm:rounded-lg sm:p-6`}>
        <div className="mb-4 flex items-start justify-between gap-4">
          {title ? <h2 className="text-lg font-bold">{title}</h2> : <span />}
          <button className="icon-btn !h-8 !w-8" onClick={onClose} data-nav="true" aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
