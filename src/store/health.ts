import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useCatalog } from './catalog'
import {
  canCheckStreams,
  healthTargets,
  probeTarget,
  type HealthFailure,
  type HealthScope,
} from '../lib/streamHealth'

/** Four at a time: enough to finish a slice, gentle on the panel and the host. */
const CONCURRENCY = 4
/** The failure list is a to-do list, not an archive. */
const MAX_FAILURES = 300

interface LastRun {
  scope: HealthScope
  at: number
  checked: number
  failed: number
}

interface HealthStore {
  running: boolean
  scope: HealthScope
  limit: number
  /** Titles planned for this run, and how many are finished. */
  total: number
  done: number
  working: number
  failing: number
  /** Size of the section being checked, so a run's slice has a context. */
  pool: number
  /** Title currently being probed, for the progress line. */
  current: string
  error: string | null
  lastRun: LastRun | null
  failures: HealthFailure[]
  /** Where the next run of each section continues. */
  cursors: Partial<Record<HealthScope, number>>
  setScope: (scope: HealthScope) => void
  setLimit: (limit: number) => void
  start: () => Promise<void>
  stop: () => void
  clear: () => void
}

/** The run that is in flight, so Stop can hang up every probe at once. */
let active: AbortController | null = null

export const useHealth = create<HealthStore>()(
  persist(
    (set, get) => ({
      running: false,
      scope: 'live',
      limit: 100,
      total: 0,
      done: 0,
      working: 0,
      failing: 0,
      pool: 0,
      current: '',
      error: null,
      lastRun: null,
      failures: [],
      cursors: {},

      setScope: (scope) => set({ scope, error: null }),
      setLimit: (limit) => set({ limit }),

      clear: () => set({ failures: [], lastRun: null, cursors: {}, error: null }),

      stop: () => {
        active?.abort()
        active = null
      },

      start: async () => {
        const state = get()
        if (state.running) return
        if (!canCheckStreams()) {
          set({ error: 'The checker works on the hosted site, where the bridge sits in front of the panel.' })
          return
        }
        const snapshot = useCatalog.getState().snapshot
        if (!snapshot) {
          set({ error: 'The catalogue is still loading. Try again once the library is on screen.' })
          return
        }

        const { scope, limit } = state
        const from = state.cursors[scope] ?? 0
        const { targets, pool } = healthTargets(snapshot, scope, limit, from)
        if (!targets.length) {
          set({ error: 'Nothing to check in this section yet.' })
          return
        }

        const controller = new AbortController()
        active = controller
        set({
          running: true,
          error: null,
          current: '',
          total: targets.length,
          done: 0,
          working: 0,
          failing: 0,
          pool,
        })

        let index = 0
        let done = 0
        let working = 0
        let failing = 0

        const worker = async () => {
          for (;;) {
            if (controller.signal.aborted) return
            const at = index
            index += 1
            if (at >= targets.length) return
            const target = targets[at]
            set({ current: target.name })
            const result = await probeTarget(target, controller.signal)
            if (controller.signal.aborted) return
            done += 1
            if (result.ok) {
              working += 1
            } else {
              failing += 1
              const failure: HealthFailure = {
                key: `${target.kind}:${target.id}`,
                kind: target.kind,
                id: target.id,
                name: target.name,
                reason: result.reason,
                status: result.status,
                at: Date.now(),
              }
              set((current) => ({
                failures: [failure, ...current.failures.filter((f) => f.key !== failure.key)].slice(0, MAX_FAILURES),
              }))
            }
            set({ done, working, failing })
          }
        }

        await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker))
        if (active === controller) active = null
        set({
          running: false,
          current: '',
          // Continue after what was actually checked: a stopped run must not skip
          // the titles it never reached.
          cursors: { ...get().cursors, [scope]: pool ? (from + done) % pool : 0 },
          lastRun: { scope, at: Date.now(), checked: done, failed: failing },
        })
      },
    }),
    {
      name: 'vntera:health',
      version: 1,
      partialize: (state) => ({
        scope: state.scope,
        limit: state.limit,
        failures: state.failures,
        cursors: state.cursors,
        lastRun: state.lastRun,
      }),
    },
  ),
)
