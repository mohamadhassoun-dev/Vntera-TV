import { appendChunk, dropChunks } from './storage'
import type { DownloadJob } from './types'

export interface TransferResult {
  bytesDone: number
  bytesTotal: number
}

const CHUNK = 1.5 * 1024 * 1024

/**
 * Transfers one file into browser storage.
 *
 * Bytes are written as slices while they arrive, so the queue can stop at any
 * moment — playback starting, the tab closing, the connection dropping — and the
 * next attempt continues from where it stopped with a Range request.
 */
export async function transferToStorage(
  job: DownloadJob,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void,
): Promise<TransferResult> {
  const resumeFrom = job.bytesDone
  const headers: Record<string, string> = {}
  if (resumeFrom > 0) headers.Range = `bytes=${resumeFrom}-`

  const response = await fetch(job.url, { headers, signal, credentials: 'include' })
  if (!response.ok) {
    if (response.status === 416) {
      // The stored slices do not line up with the file any more: start clean.
      await dropChunks(job.id)
      return { bytesDone: 0, bytesTotal: job.bytesTotal }
    }
    throw new Error(`The server answered ${response.status}`)
  }

  const resumed = response.status === 206 && resumeFrom > 0
  if (!resumed && resumeFrom > 0) {
    await dropChunks(job.id)
  }
  let done = resumed ? resumeFrom : 0
  const lengthHeader = Number(response.headers.get('content-length') || 0)
  const total = lengthHeader > 0 ? done + lengthHeader : response.headers.get('content-type') === 'video/mp4' ? 0 : 0
  const limit = job.byteLimit ?? Number.POSITIVE_INFINITY

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
  let index = resumed ? Math.floor(resumeFrom / CHUNK) : 0
  let lastReport = 0

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
    await flush()
    onProgress(done, total > 0 ? total : done)
    return { bytesDone: done, bytesTotal: total > 0 ? total : done }
  } finally {
    await flush().catch(() => undefined)
    reader.cancel().catch(() => undefined)
  }
}
