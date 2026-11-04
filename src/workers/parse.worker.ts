import { parseM3U } from '../lib/m3u'
import { parseXmltv } from '../lib/xmltv'

interface WorkerRequest {
  id: number
  kind: 'm3u' | 'xmltv'
  text: string
}

const scope = self as unknown as DedicatedWorkerGlobalScope

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const { id, kind, text } = event.data
  try {
    if (kind === 'm3u') {
      scope.postMessage({ id, entries: parseM3U(text) })
    } else {
      const { programmes, channelNames } = parseXmltv(text)
      scope.postMessage({ id, programmes, channelNames })
    }
  } catch (error) {
    scope.postMessage({ id, error: error instanceof Error ? error.message : 'parse failed' })
  }
}
