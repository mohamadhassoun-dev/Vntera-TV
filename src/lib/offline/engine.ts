import { appendChunk, dropChunks } from './storage'
import type { DownloadJob } from './types'

export interface TransferResult {
  bytesDone: number
  bytesTotal: number
}

/** Storage is written in fixed slices, so every resume lands on a slice boundary. */
const CHUNK = 1.5 * 1024 * 1024
/** How many times one transfer may re-open after the host drops the stream. */
const MAX_RESUMES = 24

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Transfers one file into browser storage.
 *
 * Bytes are written as slices while they arrive, so the queue can stop at any
 * moment — playback starting, the tab closing, the connection dropping — and the
 * next attempt continues from where it stopped with a Range request.
 *
 * The host cuts a long stream: a two-hour film is commonly dropped a hundred
 * megabytes in. A dropped socket is therefore not a failed download — the
 * transfer re-opens from the last whole slice and carries on, and only a
 * connection that produced nothing at all is reported as a failure.
 */
export async function transferToStorage(
  job: DownloadJob,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<TransferResult> {
  const urls = [job.url, job.altUrl].filter(
    (url, index, all): url is string => !!url && all.indexOf(url) === index,
  )
  const limit = job.byteLimit ?? Number.POSITIVE_INFINITY
  let total = job.bytesTotal
  let done = job.bytesDone
  let resumes = 0

  for (;;) {
    // A resume must not rewrite a half-written slice, so it starts at the slice
    // that contains the last kept byte.
    if (done > 0 && done % CHUNK !== 0) done = Math.floor(done / CHUNK) * CHUNK

    const headers: Record<string, string> = {}
    if (done > 0) headers.Range = `bytes=${done}-`

    let response: Response | null = null
    let lastStatus = 0
    let restarted = false
    for (const url of urls) {
      const attempt = await fetch(url, { headers, signal, credentials: 'include' }).catch(() => null)
      if (!attempt) continue
      if (attempt.status === 416) {
        // The stored slices do not line up with the file any more: start clean.
        await dropChunks(job.id)
        await attempt.body?.cancel().catch(() => undefined)
        done = 0
        total = job.bytesTotal
        restarted = true
        break
      }
      if (attempt.ok) {
        response = attempt
        break
      }
      lastStatus = attempt.status
      await attempt.body?.cancel().catch(() => undefined)
    }
    if (restarted) continue
    if (!response) throw new Error(`The server answered ${lastStatus || 'nothing'}`)

    const resumed = response.status === 206 && done > 0
    if (!resumed && done > 0) {
      await dropChunks(job.id)
      done = 0
    }
    const lengthHeader = Number(response.headers.get('content-length') || 0)
    if (lengthHeader > 0) total = done + lengthHeader

    if (!response.body) {
      const blob = await response.blob()
      const slice = job.byteLimit ? blob.slice(0, job.byteLimit) : blob
      await appendChunk(job.id, Math.floor(done / CHUNK), slice)
      done += slice.size
      onProgress(done, Math.max(done, total))
      return { bytesDone: done, bytesTotal: Math.max(done, total) }
    }

    const reader = response.body.getReader()
    let buffer: BlobPart[] = []
    let buffered = 0
    let index = Math.floor(done / CHUNK)
    let lastReport = 0
    let dropped: unknown = null

    const flush = async () => {
      if (!buffered) return
      const blob = new Blob(buffer)
      await appendChunk(job.id, index, blob)
      index += 1
      buffer = []
      buffered = 0
    }

    try {
      for (;;) {
        if (signal.aborted) throw new DOMException('aborted', 'AbortError')
        // Look-ahead is a bounded slice, never the whole film.
        if (done >= limit) break
        const { done: finished, value } = await reader.read()
        if (finished) break
        if (!value) continue
        const remaining = limit - done
        const slice = value.byteLength > remaining ? value.slice(0, remaining) : value
        buffer.push(slice)
        buffered += slice.byteLength
        done += slice.byteLength
        if (buffered >= CHUNK) await flush()
        const now = Date.now()
        if (now - lastReport > 200) {
          lastReport = now
          onProgress(done, total > 0 ? total : done)
        }
      }
    } catch (error) {
      dropped = error
    } finally {
      await flush().catch(() => undefined)
      await reader.cancel().catch(() => undefined)
    }

    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    if (!dropped) break

    // Still short of the file, and the host cut the stream: pick it up again.
    if (total > 0 && done < total && resumes < MAX_RESUMES) {
      resumes += 1
      await sleep(400 * Math.min(resumes, 5))
      continue
    }
    throw dropped
  }

  onProgress(done, total > 0 ? total : done)
  return { bytesDone: done, bytesTotal: total > 0 ? total : done }
}
