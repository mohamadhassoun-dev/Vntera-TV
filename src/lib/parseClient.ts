import type { M3UEntry } from './m3u'
import { parseM3U } from './m3u'

type ParseKind = 'm3u' | 'xmltv'

interface WorkerRequest {
  id: number
  kind: ParseKind
  text: string
}

let worker: Worker | null = null
let seq = 0

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (worker) return worker
  try {
    worker = new Worker(new URL('../workers/parse.worker.ts', import.meta.url), { type: 'module' })
    return worker
  } catch {
    return null
  }
}

/** Parse a large playlist off the UI thread. Falls back to synchronous parsing
 *  when workers are unavailable (some TV webviews). */
export function parsePlaylistOffThread(text: string): Promise<M3UEntry[]> {
  const w = getWorker()
  if (!w) return Promise.resolve(parseM3U(text))

  return new Promise((resolve) => {
    const id = ++seq
    const onMessage = (event: MessageEvent<{ id: number; entries?: M3UEntry[]; error?: string }>) => {
      if (event.data.id !== id) return
      w.removeEventListener('message', onMessage)
      resolve(event.data.entries ?? parseM3U(text))
    }
    w.addEventListener('message', onMessage)
    const req: WorkerRequest = { id, kind: 'm3u', text }
    w.postMessage(req)
  })
}
