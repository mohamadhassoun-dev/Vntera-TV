import type { MediaKind } from '../../types'

export type DownloadState = 'queued' | 'downloading' | 'paused' | 'completed' | 'failed'

/** Everything a download row needs, on the web and on the phone. */
export interface DownloadJob {
  /** `kind:titleId:streamId` — one file per episode and per movie edition. */
  id: string
  titleId: number
  kind: Extract<MediaKind, 'movie' | 'series'>
  streamId: number
  /** Movie name, or the series name for an episode. */
  title: string
  /** "S2 E4 · Episode name" for an episode. */
  subtitle?: string
  poster?: string
  /** Where to resume a series download. */
  season?: number
  episode?: number
  url: string
  mime?: string
  state: DownloadState
  /** Bytes already written to storage (resumable). */
  bytesDone: number
  /** 0 until the server reports a length. */
  bytesTotal: number
  error?: string
  attempts: number
  createdAt: number
  updatedAt: number
  completedAt?: number
  /** A bounded pause-time buffer of the opening slice, not a keep-forever file. */
  lookahead?: boolean
  /** Hard byte cap for a lookahead job. */
  byteLimit?: number
  /** Native downloads report where the file landed. */
  localPath?: string
}

export interface EnqueueInput {
  /** Overrides the derived id; look-ahead buffers use their own namespace. */
  id?: string
  titleId: number
  kind: 'movie' | 'series'
  streamId: number
  title: string
  subtitle?: string
  poster?: string
  season?: number
  episode?: number
  url: string
  mime?: string
  lookahead?: boolean
  byteLimit?: number
}

export function jobId(kind: string, titleId: number, streamId: number): string {
  return `${kind}:${titleId}:${streamId}`
}

export function isFinished(job: DownloadJob): boolean {
  return job.state === 'completed'
}

/** Human size for rows and the storage summary. */
export function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}
