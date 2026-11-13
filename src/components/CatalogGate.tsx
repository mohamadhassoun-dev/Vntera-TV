import type { ReactNode } from 'react'
import { EmptyState } from './Feedback'
import { Icon } from './Icons'
import { useCatalog } from '../store/catalog'

/**
 * A screen that is built from the library must never answer for a library that
 * never arrived. Home and Live TV checked for themselves, so a provider outage
 * there showed the retry card while Movies, TV Shows, Search, My List, New &
 * Popular, Collections and the title page all drew their empty states instead —
 * "nothing here" for a catalogue that simply could not be fetched.
 *
 * Only the case with no snapshot at all is caught. Once anything is on disk the
 * viewer keeps browsing it — see the fallback in the store's load, which keeps a
 * half-finished library and finishes the sweep rather than throwing it away.
 */
export function CatalogGate({ title, children }: { title: string; children: ReactNode }) {
  const snapshot = useCatalog((s) => s.snapshot)
  const status = useCatalog((s) => s.status)
  const error = useCatalog((s) => s.error)
  const refresh = useCatalog((s) => s.refresh)

  if (snapshot || status !== 'error') return <>{children}</>

  return (
    <div className="shell-x pb-24 pt-28">
      <EmptyState
        icon="alert"
        title={title}
        body={error ?? 'The catalogue could not be loaded. Check your connection and try again.'}
        action={
          <button className="btn btn-primary" onClick={() => void refresh()} data-nav="true">
            <Icon name="refresh" size={16} /> Retry sync
          </button>
        }
      />
    </div>
  )
}
