import { jobId, type DownloadJob, type DownloadState, type EnqueueInput } from './types'

export interface SchedulerConfig {
  /** One file at a time: the queue must never fight the stream. */
  maxConcurrent: number
  /** Playback blocks downloads, and they stay blocked this long after it stops. */
  playbackResumeDelayMs: number
  maxAttempts: number
  retryDelayMs: number
  /** Total bytes a pause-time look-ahead may hold, across all titles. */
  lookaheadBudgetBytes: number
}

export const DEFAULT_SCHEDULER: SchedulerConfig = {
  maxConcurrent: 1,
  playbackResumeDelayMs: 3_000,
  maxAttempts: 3,
  retryDelayMs: 4_000,
  lookaheadBudgetBytes: 48 * 1024 * 1024,
}

/**
 * The download queue.
 *
 * It owns no network code and no storage: it decides *what may run right now*.
 * That keeps the interesting rules — playback wins, one file at a time, dedupe
 * by edition, bounded retries, look-ahead that never becomes a full download —
 * testable without a browser.
 */
export class DownloadScheduler {
  readonly config: SchedulerConfig
  private jobs = new Map<string, DownloadJob>()
  private order: string[] = []
  private playing = false
  /** Downloads stay parked until this timestamp (set when playback stops). */
  private resumeAt = 0
  private retryAt = new Map<string, number>()

  constructor(config: Partial<SchedulerConfig> = {}) {
    this.config = { ...DEFAULT_SCHEDULER, ...config }
  }

  hydrate(jobs: readonly DownloadJob[]) {
    this.jobs.clear()
    this.order = []
    for (const job of [...jobs].sort((a, b) => a.createdAt - b.createdAt)) {
      // A download that was live when the app died is simply queued again.
      const restored: DownloadJob = job.state === 'downloading' ? { ...job, state: 'queued' } : job
      this.jobs.set(restored.id, restored)
      this.order.push(restored.id)
    }
  }

  snapshot(): DownloadJob[] {
    return this.order
      .map((id) => this.jobs.get(id))
      .filter((job): job is DownloadJob => Boolean(job))
      .map((job) => ({ ...job }))
  }

  get(id: string): DownloadJob | undefined {
    const job = this.jobs.get(id)
    return job ? { ...job } : undefined
  }

  /**
   * Adding the same edition twice returns the existing job instead of starting
   * a second transfer to the same file.
   */
  enqueue(input: EnqueueInput, now = Date.now()): { job: DownloadJob; created: boolean } {
    const id = input.id ?? jobId(input.kind, input.titleId, input.streamId)
    const existing = this.jobs.get(id)
    if (existing) return { job: { ...existing }, created: false }
    const job: DownloadJob = {
      id,
      titleId: input.titleId,
      kind: input.kind,
      streamId: input.streamId,
      title: input.title,
      subtitle: input.subtitle,
      poster: input.poster,
      season: input.season,
      episode: input.episode,
      url: input.url,
      mime: input.mime,
      state: 'queued',
      bytesDone: 0,
      bytesTotal: 0,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
      lookahead: input.lookahead,
      byteLimit: input.byteLimit,
    }
    this.jobs.set(id, job)
    this.order.push(id)
    return { job: { ...job }, created: true }
  }

  pause(id: string, now = Date.now()): DownloadJob | undefined {
    return this.patch(id, { state: 'paused' }, now)
  }

  resume(id: string, now = Date.now()): DownloadJob | undefined {
    const job = this.jobs.get(id)
    if (!job || job.state === 'completed') return job ? { ...job } : undefined
    this.retryAt.delete(id)
    return this.patch(id, { state: 'queued', error: undefined }, now)
  }

  cancel(id: string) {
    this.jobs.delete(id)
    this.order = this.order.filter((entry) => entry !== id)
    this.retryAt.delete(id)
  }

  /** Cancelling a start that keeps coming back: drop every look-ahead we hold. */
  dropLookahead(titleId?: number) {
    for (const job of [...this.jobs.values()]) {
      if (!job.lookahead) continue
      if (titleId !== undefined && job.titleId !== titleId) continue
      this.cancel(job.id)
    }
  }

  setPlayback(active: boolean, now = Date.now()) {
    this.playing = active
    this.resumeAt = active ? 0 : now + this.config.playbackResumeDelayMs
  }

  get playbackActive(): boolean {
    return this.playing
  }

  /**
   * The jobs the runner may transfer right now. Empty while a video plays, and
   * for a short grace period after it stops, so a pause/seek never starts a
   * transfer the user is about to interrupt again.
   */
  runnable(now = Date.now()): DownloadJob[] {
    if (this.playing) return []
    if (now < this.resumeAt) return []
    const ready: DownloadJob[] = []
    for (const id of this.order) {
      if (ready.length >= this.config.maxConcurrent) break
      const job = this.jobs.get(id)
      if (!job) continue
      if (job.state !== 'queued') continue
      if ((this.retryAt.get(id) ?? 0) > now) continue
      ready.push({ ...job })
    }
    return ready
  }

  /** Bytes still allowed for look-ahead work. */
  lookaheadBudget(): number {
    let held = 0
    for (const job of this.jobs.values()) {
      if (job.lookahead) held += job.bytesDone
    }
    return Math.max(0, this.config.lookaheadBudgetBytes - held)
  }

  markRunning(id: string, now = Date.now()): DownloadJob | undefined {
    return this.patch(id, { state: 'downloading', error: undefined }, now)
  }

  markProgress(id: string, bytesDone: number, bytesTotal: number, now = Date.now()): DownloadJob | undefined {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const total = bytesTotal > 0 ? bytesTotal : job.bytesTotal
    if (job.bytesDone === bytesDone && job.bytesTotal === total && job.state === 'downloading') return { ...job }
    return this.patch(id, { bytesDone, bytesTotal: total }, now)
  }

  /** Requeue a job without counting it as a failure (pause while running). */
  requeue(id: string, now = Date.now()): DownloadJob | undefined {
    return this.patch(id, { state: 'queued' }, now)
  }

  complete(id: string, localPath?: string, now = Date.now()): DownloadJob | undefined {
    this.retryAt.delete(id)
    const job = this.jobs.get(id)
    if (!job) return undefined
    return this.patch(
      id,
      {
        state: 'completed',
        bytesDone: job.bytesTotal || job.bytesDone,
        completedAt: now,
        error: undefined,
        localPath: localPath ?? job.localPath,
      },
      now,
    )
  }

  /**
   * A failed transfer is retried a couple of times with a short backoff, then
   * the row shows the reason and stays out of the runner's way — a bad URL must
   * not wedge everything behind it.
   */
  fail(id: string, error: string, now = Date.now()): DownloadJob | undefined {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const attempts = job.attempts + 1
    const retry = attempts < this.config.maxAttempts
    this.retryAt.set(id, retry ? now + this.config.retryDelayMs * attempts : 0)
    return this.patch(
      id,
      {
        attempts,
        error,
        state: retry ? 'queued' : 'failed',
      },
      now,
    )
  }

  /** Bytes held in storage by finished and partial downloads. */
  usedBytes(): number {
    let used = 0
    for (const job of this.jobs.values()) used += job.bytesDone
    return used
  }

  private patch(id: string, fields: Partial<DownloadJob>, now: number): DownloadJob | undefined {
    const job = this.jobs.get(id)
    if (!job) return undefined
    const next: DownloadJob = { ...job, ...fields, updatedAt: now }
    this.jobs.set(id, next)
    return { ...next }
  }
}

export function stateLabel(state: DownloadState): string {
  switch (state) {
    case 'queued':
      return 'Queued'
    case 'downloading':
      return 'Downloading'
    case 'paused':
      return 'Paused'
    case 'completed':
      return 'Ready'
    case 'failed':
      return 'Failed'
  }
}
