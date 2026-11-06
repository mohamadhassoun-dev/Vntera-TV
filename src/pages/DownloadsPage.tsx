import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { Art } from '../components/Art'
import { useOffline } from '../store/offline'
import { formatBytes, type DownloadJob } from '../lib/offline/types'
import { stateLabel } from '../lib/offline/scheduler'

function progressPercent(job: DownloadJob): number {
  if (job.state === 'completed') return 100
  if (!job.bytesTotal) return 0
  return Math.max(0, Math.min(99, Math.round((job.bytesDone / job.bytesTotal) * 100)))
}

function watchHref(job: DownloadJob): string {
  const query = new URLSearchParams({ local: job.id })
  if (job.kind === 'series') {
    query.set('season', String(job.season ?? 1))
    query.set('episode', String(job.episode ?? 1))
  }
  query.set('resume', '1')
  return `/watch/${job.kind}/${job.titleId}?${query.toString()}`
}

function JobRow({ job }: { job: DownloadJob }) {
  const navigate = useNavigate()
  const pause = useOffline((s) => s.pause)
  const resume = useOffline((s) => s.resume)
  const cancel = useOffline((s) => s.cancel)
  const remove = useOffline((s) => s.remove)
  const localUrl = useOffline((s) => s.localUrl)
  const [busy, setBusy] = useState(false)
  const percent = progressPercent(job)
  const ready = job.state === 'completed'
  const running = job.state === 'downloading' || job.state === 'queued'
  const size = job.bytesTotal || job.bytesDone

  const play = async () => {
    setBusy(true)
    try {
      const url = await localUrl(job)
      if (url) navigate(watchHref(job))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel flex items-center gap-3 p-2.5" data-nav="true">
      <div className="h-16 w-11 shrink-0 overflow-hidden rounded-[3px] bg-layer-2">
        <Art src={job.poster} title={job.title} seed={`${job.titleId}-${job.title}`} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-[13px] font-semibold text-white">{job.title}</p>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider ${ready ? 'text-live' : job.state === 'failed' ? 'text-crimson' : 'text-ink-mute'}`}>
            {stateLabel(job.state)}
          </span>
        </div>
        {job.subtitle ? <p className="truncate text-[11px] text-ink-mute">{job.subtitle}</p> : null}
        {ready ? (
          <p className="mt-1 text-[11px] text-ink-soft">{formatBytes(size)} · ready offline</p>
        ) : (
          <>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-crimson transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-ink-mute">
              {formatBytes(job.bytesDone)}
              {job.bytesTotal ? ` of ${formatBytes(job.bytesTotal)}` : ''} · {percent}%
              {job.state === 'queued' ? ' · waiting for playback to stop' : ''}
              {job.error ? ` · ${job.error}` : ''}
            </p>
          </>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {ready ? (
          <button className="icon-btn" onClick={() => void play()} aria-label={`Play ${job.title} offline`} data-nav="true" disabled={busy}>
            <Icon name="play" size={16} />
          </button>
        ) : null}
        {running ? (
          <button className="icon-btn" onClick={() => void pause(job.id)} aria-label={`Pause ${job.title}`} data-nav="true">
            <Icon name="pause" size={16} />
          </button>
        ) : null}
        {job.state === 'paused' || job.state === 'failed' ? (
          <button className="icon-btn" onClick={() => void resume(job.id)} aria-label={`Resume ${job.title}`} data-nav="true">
            <Icon name="download" size={16} />
          </button>
        ) : null}
        {!ready ? (
          <button className="icon-btn" onClick={() => void cancel(job.id)} aria-label={`Cancel ${job.title}`} data-nav="true">
            <Icon name="close" size={16} />
          </button>
        ) : (
          <button className="icon-btn" onClick={() => void remove(job.id)} aria-label={`Delete ${job.title}`} data-nav="true">
            <Icon name="trash" size={16} />
          </button>
        )}
      </div>
    </div>
  )
}

export default function DownloadsPage() {
  // Look-ahead buffers are internal prefetches, not titles the viewer asked for.
  const allJobs = useOffline((s) => s.jobs)
  const jobs = useMemo(() => allJobs.filter((job) => !job.lookahead), [allJobs])
  const storage = useOffline((s) => s.storage)
  const ready = useOffline((s) => s.ready)
  const native = useOffline((s) => s.native)
  const playing = useOffline((s) => s.playing)
  const error = useOffline((s) => s.error)
  const clearError = useOffline((s) => s.clearError)
  const init = useOffline((s) => s.init)
  const refreshStorage = useOffline((s) => s.refreshStorage)

  useEffect(() => {
    void init()
    void refreshStorage()
  }, [init, refreshStorage])

  const [filter, setFilter] = useState<'all' | 'ready' | 'active'>('all')
  const visible = useMemo(() => {
    if (filter === 'ready') return jobs.filter((job) => job.state === 'completed')
    if (filter === 'active') return jobs.filter((job) => job.state !== 'completed')
    return jobs
  }, [jobs, filter])

  const finished = jobs.filter((job) => job.state === 'completed')
  const totalBytes = finished.reduce((sum, job) => sum + job.bytesDone, 0)

  return (
    <div className="shell-x pb-28 pt-[5.25rem] md:pb-12 md:pt-24">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-[0.24em] text-crimson">On this device</p>
          <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-white md:text-3xl">Downloads</h1>
          <p className="mt-1 text-[12px] text-ink-mute">
            {native
              ? 'Saved by the Android download service — playable with the network off.'
              : 'Saved in this browser — playable with the network off. The phone app adds system notifications.'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-ink-soft">
          <Icon name="cloud" size={15} />
          <span>
            {formatBytes(totalBytes)} used by {finished.length} {finished.length === 1 ? 'title' : 'titles'}
            {!native && storage.quota ? ` · ${formatBytes(Math.max(0, storage.remaining))} free` : ''}
          </span>
        </div>
      </div>

      {playing ? (
        <p className="mt-3 rounded-[4px] border border-azure/40 bg-azure/10 px-3 py-2 text-[11px] text-azure-soft">
          Playback is running, so downloads are paused to protect the stream. They resume a few seconds after you stop.
        </p>
      ) : null}
      {error ? (
        <button className="mt-3 w-full rounded-[4px] border border-crimson/40 bg-crimson/10 px-3 py-2 text-left text-[11px] text-crimson" onClick={clearError}>
          {error} — tap to dismiss
        </button>
      ) : null}

      <div className="mt-4 flex items-center gap-1.5">
        {(['all', 'active', 'ready'] as const).map((key) => (
          <button
            key={key}
            data-nav="true"
            onClick={() => setFilter(key)}
            className={`tab ${filter === key ? 'tab-active' : ''}`}
          >
            {key === 'all' ? 'All' : key === 'active' ? 'In progress' : 'Ready offline'}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {!ready ? (
          <div className="skeleton h-20 w-full" />
        ) : visible.length ? (
          visible.map((job) => <JobRow key={job.id} job={job} />)
        ) : (
          <div className="panel px-4 py-10 text-center">
            <Icon name="download" size={26} className="mx-auto text-ink-mute" />
            <p className="mt-3 text-sm font-semibold text-white">Nothing downloaded yet</p>
            <p className="mt-1 text-[12px] text-ink-mute">
              Open a movie or an episode and choose Download to keep it on this device.
            </p>
            <Link to="/movies" className="btn btn-secondary mt-4" data-nav="true">
              Browse movies
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
