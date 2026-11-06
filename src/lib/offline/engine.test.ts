import { afterEach, describe, expect, it, vi } from 'vitest'
import { transferToStorage } from './engine'
import type { DownloadJob } from './types'

const CHUNK = 1.5 * 1024 * 1024
const stored = new Map<number, Blob>()

vi.mock('./storage', () => ({
  appendChunk: vi.fn(async (_id: string, index: number, blob: Blob) => {
    stored.set(index, blob)
  }),
  dropChunks: vi.fn(async () => stored.clear()),
}))

function streamOf(bytes: Uint8Array, thenDrop = false): ReadableStream<Uint8Array> {
  let sent = false
  return new ReadableStream({
    pull(controller) {
      if (!sent) {
        sent = true
        controller.enqueue(bytes)
      } else if (thenDrop) {
        controller.error(new TypeError('connection terminated'))
      } else {
        controller.close()
      }
    },
  })
}

const job: DownloadJob = {
  id: 'series:1:1',
  titleId: 1,
  kind: 'series',
  streamId: 1,
  title: 'A series',
  url: 'https://stream.example/video.mp4',
  state: 'downloading',
  bytesDone: 0,
  bytesTotal: 0,
  attempts: 0,
  createdAt: 0,
  updatedAt: 0,
}

afterEach(() => {
  vi.unstubAllGlobals()
  stored.clear()
})

describe('transferToStorage', () => {
  it.each([true, false])('resumes at the last complete slice after a %s dropped stream without duplicating bytes', async (throws) => {
    const original = Uint8Array.from({ length: CHUNK * 2 + 97_531 }, (_, i) => i % 251)
    const firstResponse = new Response(streamOf(original.subarray(0, CHUNK * 2 + 51_000), throws), {
      status: 200,
      headers: { 'content-length': String(original.length) },
    })
    const resumedResponse = new Response(streamOf(original.subarray(CHUNK * 2)), {
      status: 206,
      headers: { 'content-length': String(original.length - CHUNK * 2) },
    })
    const fetchMock = vi.fn().mockResolvedValueOnce(firstResponse).mockResolvedValueOnce(resumedResponse)
    vi.stubGlobal('fetch', fetchMock)

    const result = await transferToStorage(job, new AbortController().signal, () => undefined)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ credentials: 'omit' })
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ headers: { Range: `bytes=${CHUNK * 2}-` } })
    expect(result).toEqual({ bytesDone: original.length, bytesTotal: original.length })
    expect([...stored.keys()]).toEqual([0, 1, 2])

    const ordered = [...stored.entries()].sort(([a], [b]) => a - b).map(([, blob]) => blob)
    const downloaded = new Uint8Array(await new Blob(ordered).arrayBuffer())
    expect(downloaded).toEqual(original)
  })
})