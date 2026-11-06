import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'
import type { DownloadJob } from './types'

/**
 * Bridge to the Android download service.
 *
 * The Android app runs a foreground service with its own persistent queue and
 * system notifications, so transfers continue while the app is backgrounded or
 * the screen is off. The web build has no such service; there `nativeOffline()`
 * returns null and the IndexedDB queue in `storage.ts` takes over.
 */
export interface NativeEnqueue {
  id: string
  titleId: number
  kind: 'movie' | 'series'
  streamId: number
  title: string
  subtitle?: string
  poster?: string
  season?: number
  episode?: number
  url: string
  altUrl?: string
  mime?: string
  lookahead?: boolean
  byteLimit?: number
}

interface OfflineDownloadsPlugin {
  list(): Promise<{ jobs: DownloadJob[] }>
  enqueue(options: { job: NativeEnqueue }): Promise<{ job: DownloadJob }>
  pause(options: { id: string }): Promise<void>
  resume(options: { id: string }): Promise<void>
  cancel(options: { id: string }): Promise<void>
  remove(options: { id: string }): Promise<void>
  setPlayback(options: { active: boolean }): Promise<void>
  play(options: { id: string }): Promise<{ url: string }>
  /** Ask for POST_NOTIFICATIONS on Android 13+; resolves with the answer. */
  requestNotifications(): Promise<{ granted: boolean }>
  /** Route requested by a notification tap while the app was closed. */
  initialRoute(): Promise<{ route: string | null }>
  addListener(
    event: 'progress',
    listener: (payload: { jobs: DownloadJob[] }) => void,
  ): Promise<PluginListenerHandle>
  addListener(
    event: 'openRoute',
    listener: (payload: { route: string }) => void,
  ): Promise<PluginListenerHandle>
}

const plugin = registerPlugin<OfflineDownloadsPlugin>('OfflineDownloads')

export function nativeOffline(): OfflineDownloadsPlugin | null {
  try {
    if (!Capacitor.isNativePlatform()) return null
    if (Capacitor.getPlatform() !== 'android') return null
    return plugin
  } catch {
    return null
  }
}

/** Turn a native file path into something the WebView can load. */
export function localFileUrl(path: string): string {
  try {
    return Capacitor.convertFileSrc(path)
  } catch {
    return path
  }
}

export const OFFLINE_EVENT = 'vntera:offline'
