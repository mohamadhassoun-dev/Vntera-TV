import { describe, expect, it } from 'vitest'
import { DownloadScheduler } from './scheduler'
import type { EnqueueInput } from './types'

const movie = (overrides: Partial<EnqueueInput> = {}): EnqueueInput => ({
  titleId: 42,
  kind: 'movie',
  streamId: 900,
  title: 'The Long Chase',
  url: 'https://panel.example/movie/900.mp4',
  ...overrides,
})

function queue(config = {}) {
  const scheduler = new DownloadScheduler({ playbackResumeDelayMs: 3_000, retryDelayMs: 1_000, ...config })
  return scheduler
}

describe('download scheduler', () => {
  it('runs one file at a time, oldest first', () => {
    const scheduler = queue()
    const first = scheduler.enqueue(movie({ title: 'One' }), 1)
    scheduler.enqueue(movie({ streamId: 901, title: 'Two' }), 2)
    expect(first.created).toBe(true)
    const running = scheduler.runnable(10)
    expect(running).toHaveLength(1)
    expect(running[0].title).toBe('One')
  })

  it('never duplicates the same edition', () => {
    const scheduler = queue()
    const first = scheduler.enqueue(movie(), 1)
    const again = scheduler.enqueue(movie({ title: 'Same file, new label' }), 2)
    expect(again.created).toBe(false)
    expect(again.job.id).toBe(first.job.id)
    expect(scheduler.snapshot()).toHaveLength(1)
  })

  it('parks the queue while a video is playing and resumes after a grace period', () => {
    const scheduler = queue()
    scheduler.enqueue(movie(), 1)
    scheduler.setPlayback(true, 10)
    expect(scheduler.runnable(20)).toHaveLength(0)

    scheduler.setPlayback(false, 30)
    // Still inside the three second grace window.
    expect(scheduler.runnable(1_000)).toHaveLength(0)
    expect(scheduler.runnable(3_400)).toHaveLength(1)
  })

  it('allows starting a download of the title being watched', () => {
    const scheduler = queue()
    scheduler.setPlayback(true, 1)
    const job = scheduler.enqueue(movie(), 2).job
    // The job exists and is not rejected; it simply waits for playback.
    expect(job.state).toBe('queued')
    expect(scheduler.runnable(3)).toHaveLength(0)
    scheduler.setPlayback(false, 4)
    expect(scheduler.runnable(4_000).map((entry) => entry.id)).toEqual([job.id])
    scheduler.markRunning(job.id, 4_100)
    scheduler.markProgress(job.id, 2_048, 8_192, 4_200)
    expect(scheduler.get(job.id)?.bytesDone).toBe(2_048)
  })

  it('pauses and resumes a job without losing its progress', () => {
    const scheduler = queue()
    const id = scheduler.enqueue(movie(), 1).job.id
    scheduler.markRunning(id, 2)
    scheduler.markProgress(id, 5_000, 10_000, 3)
    scheduler.pause(id, 4)
    expect(scheduler.runnable(10)).toHaveLength(0)
    scheduler.resume(id, 11)
    expect(scheduler.get(id)).toMatchObject({ state: 'queued', bytesDone: 5_000 })
    expect(scheduler.runnable(12)).toHaveLength(1)
  })

  it('retries a failure twice, then parks it with the reason', () => {
    const scheduler = queue()
    const id = scheduler.enqueue(movie(), 1).job.id
    scheduler.markRunning(id, 2)

    scheduler.fail(id, 'network', 10)
    expect(scheduler.get(id)).toMatchObject({ state: 'queued', attempts: 1 })
    expect(scheduler.runnable(100)).toHaveLength(0) // backing off

    expect(scheduler.runnable(1_100)).toHaveLength(1)
    scheduler.fail(id, 'network', 2_000)
    expect(scheduler.get(id)?.state).toBe('queued')

    scheduler.fail(id, 'network', 3_000)
    expect(scheduler.get(id)).toMatchObject({ state: 'failed', attempts: 3, error: 'network' })
    expect(scheduler.runnable(99_000)).toHaveLength(0)
  })

  it('moves past a failed job instead of wedging the queue', () => {
    const scheduler = queue()
    const bad = scheduler.enqueue(movie({ title: 'Broken' }), 1).job.id
    scheduler.enqueue(movie({ streamId: 902, title: 'Good' }), 2)
    for (const at of [10, 20, 30]) scheduler.fail(bad, 'network', at)
    const next = scheduler.runnable(10_000)
    expect(next.map((job) => job.title)).toEqual(['Good'])
  })

  it('cancels a job and forgets its progress', () => {
    const scheduler = queue()
    const id = scheduler.enqueue(movie(), 1).job.id
    scheduler.cancel(id)
    expect(scheduler.snapshot()).toHaveLength(0)
    expect(scheduler.get(id)).toBeUndefined()
  })

  it('keeps look-ahead buffer work bounded and disposable', () => {
    const scheduler = queue({ lookaheadBudgetBytes: 10_000 })
    scheduler.enqueue(movie({ lookahead: true, byteLimit: 10_000 }), 1)
    const look = scheduler.snapshot()[0]
    scheduler.markRunning(look.id, 2)
    scheduler.markProgress(look.id, 6_000, 40_000, 3)
    expect(scheduler.lookaheadBudget()).toBe(4_000)
    scheduler.dropLookahead(42)
    expect(scheduler.snapshot()).toHaveLength(0)
    expect(scheduler.lookaheadBudget()).toBe(10_000)
  })

  it('sums stored bytes for the storage summary', () => {
    const scheduler = queue()
    const one = scheduler.enqueue(movie(), 1).job.id
    const two = scheduler.enqueue(movie({ streamId: 903 }), 2).job.id
    scheduler.markProgress(one, 1_000, 4_000, 3)
    scheduler.markProgress(two, 2_500, 9_000, 4)
    expect(scheduler.usedBytes()).toBe(3_500)
  })
})
