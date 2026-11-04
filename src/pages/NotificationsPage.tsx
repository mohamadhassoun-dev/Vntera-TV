import { Link } from 'react-router-dom'
import { EmptyState } from '../components/Feedback'
import { Icon } from '../components/Icons'
import { useLibrary } from '../store/library'
import { relativeTime } from '../lib/format'
import type { NotificationItem } from '../types'

const ICONS: Record<NotificationItem['kind'], 'film' | 'tv' | 'bell'> = {
  content: 'film',
  live: 'tv',
  system: 'bell',
}

export default function NotificationsPage() {
  const notifications = useLibrary((s) => s.notifications)
  const markAllRead = useLibrary((s) => s.markAllRead)
  const clearNotifications = useLibrary((s) => s.clearNotifications)

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="shell-x py-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-crimson">In-app centre</p>
            <h1 className="mt-1.5 text-2xl font-black tracking-tight md:text-3xl">Notifications</h1>
            <p className="mt-1 text-sm text-ink-soft">
              New movies, catalog removals and live football, updated automatically. {notifications.filter((n) => !n.read).length} unread.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn btn-ghost !py-2 text-xs" onClick={markAllRead} data-nav="true">
              <Icon name="check" size={14} /> Mark all read
            </button>
            <button
              className="btn btn-ghost !py-2 text-xs"
              onClick={() => {
                clearNotifications()
              }}
              data-nav="true"
            >
              <Icon name="trash" size={14} /> Clear all
            </button>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          {notifications.length ? (
            notifications.map((n) => {
              const inner = (
                <>
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                      n.read ? 'bg-layer-2 text-ink-mute' : 'bg-crimson/15 text-crimson'
                    }`}
                  >
                    <Icon name={ICONS[n.kind]} size={16} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold">{n.title}</span>
                      {!n.read ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-crimson" /> : null}
                    </span>
                    <span className="mt-0.5 block text-[12px] text-ink-soft">{n.body}</span>
                    <span className="mt-0.5 block text-[10px] uppercase tracking-wider text-ink-mute">{relativeTime(n.createdAt)}</span>
                  </span>
                  {n.href ? <Icon name="chevronRight" size={16} className="shrink-0 text-ink-mute" /> : null}
                </>
              )
              return n.href ? (
                <Link
                  key={n.id}
                  to={n.href}
                  className="flex items-start gap-3 rounded-lg border border-stroke bg-layer-1 p-3 transition-colors hover:bg-layer-2"
                  data-nav="true"
                >
                  {inner}
                </Link>
              ) : (
                <div key={n.id} className="flex items-start gap-3 rounded-lg border border-stroke bg-layer-1 p-3">
                  {inner}
                </div>
              )
            })
          ) : (
            <EmptyState
              icon="bell"
              title="No notifications"
              body="When your catalog syncs, new and removed movies and upcoming football matches will appear here."
            />
          )}
        </div>

      </div>
    </div>
  )
}
