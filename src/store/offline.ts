import { create } from 'zustand'
import { DownloadScheduler } from '../lib/offline/scheduler'
import {
  assembleFile,
  deleteJobFile,
  deleteJobRecord,
  getFile,
  loadJobs,
  objectUrlFor,
  forgetObjectUrl,
  requestPersistence,
  saveJob,
  storageStatus,
  type StorageStatus,
} from '../lib/offline/storage'
import { transferToStorage } from '../lib/offline/engine'
import { localFileUrl, nativeOffline } from '../lib/offline/native'
import { formatBytes, jobId, type DownloadJob, type EnqueueInput } from '../lib/offline/types'

interface OfflineStore {
  jobs: DownloadJob[]
  storage: StorageStatus
  /** True when the Android service owns the queue. */
  native: boolean
  ready: boolean
  playing: boolean
  error: string | null
  init: () => Promise<void>
  enqueue: (input: Omit<EnqueueInput, 'id'>) => Promise<{ ok: boolean; error?: string; job?: DownloadJob }>
  addLookahead: (input: Omit<EnqueueInput, 'id' | 'lookahead' | 'byteLimit'>) => Promise<void>
  dropLookahead: (titleId?: number) => Promise<void>
  pause: (id: string) => Promise<void>
  resume: (id: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  remove: (id: string) => Promise<void>
  setPlayback: (active: boolean) => void
  localUrl: (job: DownloadJob) => Promise<string | null>
  refreshStorage: () => Promise<void>
  clearError: () => void
}

const LOOKAHEAD_CAP = 24 * 1024 * 1024
const LOOKAHEAD_PREFIX = 'lookahead:'

const scheduler = new DownloadScheduler()

let initialized = false
let running: { id: string; controller: AbortController } | null = null
let timer: number | null = null
const nativeHandle = (() => {
  try {
    return nativeOffline()
  } catch {
    return null
  }
})()

function jobsOf(): DownloadJob[] {
  return scheduler.snapshot()
}

function schedule() {
  if (timer !== null) return
  timer = window.setTimeout(() => {
    timer = null
    void pump()
  }, 400)
}

async function pump() {
  if (nativeHandle) return
  if (running) return
  const [job] = scheduler.runnable()
  if (!job) {
    schedule()
    return
  }
  scheduler.markRunning(job.id)
  setJobs()
  await saveJob(scheduler.get(job.id) ?? job).catch(() => undefined)

  const controller = new AbortController()
  running = { id: job.id, controller }
  let lastSave = Date.now()
  try {
    const result = await transferToStorage(job, controller.signal, (done, total) => {
      scheduler.markProgress(job.id, done, total)
      setJobs()
      if (Date.now() - lastSave > 4_000) {
        lastSave = Date.now()
        const snapshot = scheduler.get(job.id)
        if (snapshot) void saveJob(snapshot).catch(() => undefined)
      }
    })
    await assembleFile(job.id, job.mime || 'video/mp4')
    scheduler.markProgress(job.id, result.bytesDone, result.bytesTotal || result.bytesTotal)
    scheduler.complete(job.id)
    const finished = scheduler.get(job.id)
    if (finished) await saveJob(finished).catch(() => undefined)
  } catch (error) {
    const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')
    if (aborted) {
      scheduler.requeue(job.id)
    } else {
      scheduler.fail(job.id, error instanceof Error ? error.message : 'Download failed')
    }
    const snapshot = scheduler.get(job.id)
    if (snapshot) await saveJob(snapshot).catch(() => undefined)
  } finally {
    running = null
    setJobs()
    schedule()
  }
}

let setJobs: () => void = () => undefined

export const useOffline = create<OfflineStore>((set, get) => {
  setJobs = () => set({ jobs: jobsOf() })

  const persistJob = async (job: DownloadJob | undefined) => {
    if (job && !nativeHandle) await saveJob(job).catch(() => undefined)
  }

  const refresh = () => set({ jobs: jobsOf() })

  return {
    jobs: [],
    storage: { used: 0, quota: 0, remaining: 0, persisted: false },
    native: Boolean(nativeHandle),
    ready: false,
    playing: false,
    error: null,

    init: async () => {
      if (initialized) return
      initialized = true
      if (nativeHandle) {
        try {
          const { jobs } = await nativeHandle.list()
          scheduler.hydrate(jobs)
          set({ jobs: jobsOf(), ready: true, native: true })
          await nativeHandle.addListener('progress', ({ jobs: next }) => {
            scheduler.hydrate(next)
            set({ jobs: jobsOf() })
          })
        } catch (error) {
          set({ error: error instanceof Error ? error.message : 'Native downloads unavailable', native: false })
        }
      } else {
        const stored = await loadJobs().catch(() => [])
        scheduler.hydrate(stored)
        set({ jobs: jobsOf(), ready: true })
        void requestPersistence()
        schedule()
      }
      await get().refreshStorage()
    },

    enqueue: async (input) => {
      const status = get().storage
      if (!get().native && status.remaining > 0 && status.remaining < 64 * 1024 * 1024) {
        set({ error: 'Not enough storage left on this device' })
        return { ok: false, error: 'Not enough storage left on this device' }
      }
      if (nativeHandle) {
        try {
          const payload = {
            ...input,
            id: jobId(input.kind, input.titleId, input.streamId),
          }
          const { job } = await nativeHandle.enqueue({ job: payload })
          const { jobs } = await nativeHandle.list()
          scheduler.hydrate(jobs)
          set({ jobs: jobsOf() })
          void nativeHandle.requestNotifications().catch(() => undefined)
          return { ok: true, job }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Could not start the download'
          set({ error: message })
          return { ok: false, error: message }
        }
      }

      const { job } = scheduler.enqueue(input)
      await persistJob(scheduler.get(job.id))
      refresh()
      void get().refreshStorage()
      schedule()
      return { ok: true, job: scheduler.get(job.id) }
    },

    addLookahead: async (input) => {
      const playing = get().playing
      // Look-ahead runs *after* playback stops; there is nothing to prepare
      // while the picture is already consuming the connection.
      if (playing) return
      const cap = Math.min(LOOKAHEAD_CAP, scheduler.lookaheadBudget())
      if (cap < 2 * 1024 * 1024) return
      if (nativeHandle) {
        // The Android service runs the same bounded prefetch behind its own
        // queue, so it still yields to playback and survives a screen lock.
        await nativeHandle
          .enqueue({
            job: {
              ...input,
              id: `${LOOKAHEAD_PREFIX}${jobId(input.kind, input.titleId, input.streamId)}`,
              lookahead: true,
              byteLimit: cap,
            },
          })
          .catch(() => undefined)
        return
      }
      const { job, created } = scheduler.enqueue({
        ...input,
        id: `${LOOKAHEAD_PREFIX}${jobId(input.kind, input.titleId, input.streamId)}`,
        lookahead: true,
        byteLimit: cap,
      })
      if (!created) return
      await persistJob(scheduler.get(job.id))
      refresh()
      schedule()
    },

    dropLookahead: async (titleId) => {
      if (nativeHandle) {
        // Native buffers live in the service's queue too; drop them there.
        const leftovers = get().jobs.filter(
          (job) => job.lookahead && (titleId === undefined || job.titleId === titleId),
        )
        for (const job of leftovers) await nativeHandle.remove({ id: job.id }).catch(() => undefined)
        if (leftovers.length) {
          const { jobs } = await nativeHandle.list()
          scheduler.hydrate(jobs)
          set({ jobs: jobsOf() })
        }
        return
      }
      const before = scheduler.snapshot()
      scheduler.dropLookahead(titleId)
      const after = new Set(scheduler.snapshot().map((job) => job.id))
      for (const job of before) {
        if (!after.has(job.id)) {
          await deleteJobFile(job.id).catch(() => undefined)
          await deleteJobRecord(job.id).catch(() => undefined)
        }
      }
      refresh()
      void get().refreshStorage()
    },

    pause: async (id) => {
      if (nativeHandle) {
        await nativeHandle.pause({ id })
        const { jobs } = await nativeHandle.list()
        scheduler.hydrate(jobs)
        set({ jobs: jobsOf() })
        return
      }
      scheduler.pause(id)
      if (running?.id === id) running.controller.abort()
      await persistJob(scheduler.get(id))
      refresh()
      void get().refreshStorage()
    },

    resume: async (id) => {
      if (nativeHandle) {
        await nativeHandle.resume({ id })
        const { jobs } = await nativeHandle.list()
        scheduler.hydrate(jobs)
        set({ jobs: jobsOf() })
        return
      }
      scheduler.resume(id)
      await persistJob(scheduler.get(id))
      refresh()
      schedule()
    },

    cancel: async (id) => {
      if (nativeHandle) {
        await nativeHandle.cancel({ id })
        const { jobs } = await nativeHandle.list()
        scheduler.hydrate(jobs)
        set({ jobs: jobsOf() })
        return
      }
      if (running?.id === id) running.controller.abort()
      scheduler.cancel(id)
      await deleteJobFile(id).catch(() => undefined)
      await deleteJobRecord(id).catch(() => undefined)
      forgetObjectUrl(id)
      refresh()
      void get().refreshStorage()
    },

    remove: async (id) => {
      if (nativeHandle) {
        await nativeHandle.remove({ id })
        const { jobs } = await nativeHandle.list()
        scheduler.hydrate(jobs)
        set({ jobs: jobsOf() })
        return
      }
      if (running?.id === id) running.controller.abort()
      scheduler.cancel(id)
      await deleteJobFile(id).catch(() => undefined)
      await deleteJobRecord(id).catch(() => undefined)
      forgetObjectUrl(id)
      refresh()
      void get().refreshStorage()
    },

    setPlayback: (active) => {
      if (get().playing === active) return
      set({ playing: active })
      scheduler.setPlayback(active)
      if (nativeHandle) {
        void nativeHandle.setPlayback({ active }).catch(() => undefined)
      }
      if (active) {
        // Playback wins: stop the transfer that is on the wire right now, not
        // just the next one, so the stream gets the whole connection.
        if (running) running.controller.abort()
      } else {
        schedule()
      }
    },

    localUrl: async (job) => {
      if (nativeHandle) {
        try {
          const { url } = await nativeHandle.play({ id: job.id })
          return url.startsWith('http') || url.startsWith('blob:') ? url : localFileUrl(url)
        } catch {
          return null
        }
      }
      const blob = await getFile(job.id)
      if (!blob) return null
      return objectUrlFor(job.id, blob)
    },

    refreshStorage: async () => {
      const status = await storageStatus()
      set({ storage: status })
    },

    clearError: () => set({ error: null }),
  }
})

// Console hook for QA, on in development and in a release build only when
// `localStorage['vntera:qa'] === '1'`. It exposes the queue so the offline path
// can be driven and inspected without a fake title in the catalogue.
const offlineQa =
  import.meta.env.DEV ||
  (typeof localStorage !== 'undefined' && (() => {
    try {
      return localStorage.getItem('vntera:qa') === '1'
    } catch {
      return false
    }
  })())
if (offlineQa && typeof window !== 'undefined') {
  ;(window as unknown as { __vnteraOffline?: unknown }).__vnteraOffline = useOffline
}

/** Bytes on disk for the Downloads page summary. */
export function offlineSizeText(jobs: readonly DownloadJob[]): string {
  return formatBytes(jobs.reduce((total, job) => total + (job.state === 'completed' ? job.bytesDone : 0), 0))
}

export { LOOKAHEAD_PREFIX }
