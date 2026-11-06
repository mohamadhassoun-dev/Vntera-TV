import { useEffect } from 'react'
import { Icon } from './Icons'
import { useOffline } from '../store/offline'
import { jobId, type EnqueueInput } from '../lib/offline/types'

export interface DownloadTarget extends Omit<EnqueueInput, 'id' | 'lookahead' | 'byteLimit'> {}

/**
 * The Download control on a title page and on each episode.
 *
 * It reads the queue rather than local state, so a download started from the
 * phone's notification or another screen shows the same progress here.
 */
export function DownloadButton({
  target,
  compact = false,
  className = '',
}: {
  target: DownloadTarget
  /** Icon-only, for episode rows. */
  compact?: boolean
  className?: string
}) {
  const jobs = useOffline((s) => s.jobs)
  const init = useOffline((s) => s.init)
  const enqueue = useOffline((s) => s.enqueue)
  const pause = useOffline((s) => s.pause)
  const resume = useOffline((s) => s.resume)

  useEffect(() => {
    void init()
  }, [init])

  const id = jobId(target.kind, target.titleId, target.streamId)
  const job = jobs.find((entry) => entry.id === id)
  const percent = job && job.bytesTotal ? Math.max(0, Math.min(99, Math.round((job.bytesDone / job.bytesTotal) * 100))) : 0

  const label = (() => {
    if (!job) return 'Download'
    if (job.state === 'completed') return 'Downloaded'
    if (job.state === 'failed') return 'Retry download'
    if (job.state === 'paused') return `Resume ${percent}%`
    if (job.state === 'downloading') return `${percent}%`
    return 'Queued'
  })()

  const onClick = async () => {
    if (!job) {
      await enqueue(target)
      return
    }
    if (job.state === 'completed') return
    if (job.state === 'paused' || job.state === 'failed') {
      await resume(job.id)
      return
    }
    await pause(job.id)
  }

  if (compact) {
    const done = job?.state === 'completed'
    const active = job && job.state !== 'completed'
    return (
      <button
        className={`icon-btn !h-8 !w-8 ${done ? 'text-live' : active ? 'text-crimson' : ''} ${className}`}
        onClick={() => void onClick()}
        aria-label={done ? `${target.title} is downloaded` : `Download ${target.title}`}
        title={label}
        data-nav="true"
      >
        <Icon name={done ? 'check' : 'download'} size={13} />
      </button>
    )
  }

  return (
    <button
      className={`btn ${job?.state === 'completed' ? 'btn-secondary' : 'btn-ghost'} ${className}`}
      onClick={() => void onClick()}
      data-nav="true"
      disabled={job?.state === 'completed'}
    >
      <Icon name={job?.state === 'completed' ? 'check' : 'download'} size={17} />
      {label}
    </button>
  )
}
