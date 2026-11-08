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

/** Rate observed for each running job, so a row can estimate its own finish. */
const rateSamples = new Map<string, { bytes: number; at: number; rate: number }>()

function etaLabel(job: DownloadJob): string | null {
  if (job.state !== 'downloading' || !job.bytesTotal) return null
  const now = Date.now()
  const previous = rateSamples.get(job.id)
  if (!previous || job.bytesDone < previous.bytes) {
    rateSamples.set(job.id, { bytes: job.bytesDone, at: now, rate: 0 })
  } else if (now - previous.at >= 700 && job.bytesDone > previous.bytes) {
    const instant = (job.bytesDone - previous.bytes) / ((now - previous.at) / 1000)
    // Smoothed, so the estimate does not jump with every progress event.
    const rate = previous.rate ? previous.rate * 0.6 + instant * 0.4 : instant
    rateSamples.set(job.id, { bytes: job.bytesDone, at: now, rate })
  }
  const rate = rateSamples.get(job.id)?.rate ?? 0
  const remaining = job.bytesTotal - job.bytesDone
  if (rate < 1024 || remaining <= 0) return null
  const seconds = remaining / rate
  if (seconds < 45) return 'less than a minute left'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `about ${minutes} min left`
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`
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

/** "Season 2 · Episode 4 · The Name" → the parts a row can show separately. */
function episodeParts(job: DownloadJob): { tag: string; name: string } | null {
  if (job.kind !== 'series') return null
  const parts = (job.subtitle ?? '').split(' · ')
  const season = job.season ?? 1
  const episode = job.episode ?? 1
  const named = parts[0]?.startsWith('Season') ? parts.slice(2).join(' · ') : ''
  return { tag: `S${season} E${episode}`, name: named || parts[0] || '' }
}

/** One heading per series, so a season of episodes does not read as many titles. */
function groupJobs(jobs: DownloadJob[]): Array<{ key: string; label: string | null; count: number; jobs: DownloadJob[] }> {
  const groups: Array<{ key: string; label: string | null; count: number; jobs: DownloadJob[] }> = []
  const bySeries = new Map<number, (typeof groups)[number]>()
  for (const job of jobs) {
    if (job.kind !== 'series') {
      groups.push({ key: job.id, label: null, count: 1, jobs: [job] })
      continue
    }
    const existing = bySeries.get(job.titleId)
    if (existing) {
      existing.jobs.push(job)
      existing.count += 1
      continue
    }
    const group = { key: `series:${job.titleId}`, label: job.title, count: 1, jobs: [job] }
    bySeries.set(job.titleId, group)
    groups.push(group)
  }
  return groups
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
  const episodeInfo = episodeParts(job)
  const ready = job.state === 'completed'
  const running = job.state === 'downloading' || job.state === 'queued'
  const size = job.bytesTotal || job.bytesDone
  // Progress events carry the byte count; the clock is what turns it into a
  // time remaining, so a running row re-reads its estimate every second.
  const [, tick] = useState(0)
  useEffect(() => {
    if (job.state !== 'downloading') return
    const id = window.setInterval(() => tick((value) => value + 1), 1_000)
    return () => window.clearInterval(id)
  }, [job.state])
  const eta = etaLabel(job)

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
          <p className="truncate text-[13px] font-semibold text-white">
            {episodeInfo ? <span className="tabular mr-1.5 text-[11px] font-bold text-ink-soft">{episodeInfo.tag}</span> : null}
            {episodeInfo ? episodeInfo.name || job.title : job.title}
          </p>
          <span className={`shrink-0 text-[10px] font-bold uppercase tracking-wider ${ready ? 'text-live' : job.state === 'failed' ? 'text-crimson' : 'text-ink-mute'}`}>
            {stateLabel(job.state)}
          </span>
        </div>
        {!episodeInfo && job.subtitle ? <p className="truncate text-[11px] text-ink-mute">{job.subtitle}</p> : null}
        {ready ? (
          <p className="mt-1 text-[11px] text-ink-soft">
            <span className="mr-1.5 uppercase tracking-wider text-ink-mute">{job.kind === 'series' ? 'Episode' : 'Movie'}</span>
            {formatBytes(size)} · ready offline
          </p>
        ) : job.state === 'failed' ? (
          <>
            <p className="mt-1 text-[11px] font-semibold text-crimson">This download could not finish. Tap download to try again.</p>
            {job.error ? <p className="truncate text-[10px] text-ink-mute">{job.error}</p> : null}
          </>
        ) : (
          <>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full rounded-full bg-crimson transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-[10px] text-ink-mute">
              {formatBytes(job.bytesDone)}
              {job.bytesTotal ? ` of ${formatBytes(job.bytesTotal)}` : ''} · {percent}%
              {eta ? ` · ${eta}` : ''}
              {job.state === 'queued' ? ' · waiting for playback to stop' : ''}
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
        {job.state === 'failed' ? (
          <button className="icon-btn" onClick={() => void resume(job.id)} aria-label={`Retry ${job.title}`} data-nav="true">
            <Icon name="refresh" size={16} />
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
          groupJobs(visible).map((group) => (
            <div key={group.key} className="space-y-2">
              {group.label ? (
                <div className="flex items-baseline justify-between gap-2 px-1 pt-1">
                  <p className="truncate text-[12px] font-bold text-white">{group.label}</p>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-ink-mute">
                    {group.count} {group.count === 1 ? 'episode' : 'episodes'}
                  </span>
                </div>
              ) : null}
              {group.jobs.map((job) => (
                <JobRow key={job.id} job={job} />
              ))}
            </div>
          ))
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
