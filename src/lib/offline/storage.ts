import type { DownloadJob } from './types'

/**
 * Browser storage for offline titles.
 *
 * Bytes are written to IndexedDB in slices as they arrive, so a download that is
 * paused, killed or interrupted by a lost connection can continue from the last
 * slice instead of starting again. On completion the slices are joined into one
 * blob for playback and the slices are dropped.
 */
const DB_NAME = 'vntera-offline'
const DB_VERSION = 1
const CHUNK_BYTES = 1.5 * 1024 * 1024

interface ChunkRow {
  key: string
  jobId: string
  index: number
  blob: Blob
}

interface FileRow {
  id: string
  blob: Blob
  mime: string
  size: number
}

let dbPromise: Promise<IDBDatabase> | null = null

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('chunks')) {
          const chunks = db.createObjectStore('chunks', { keyPath: 'key' })
          chunks.createIndex('jobId', 'jobId')
        }
        if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error('Could not open offline storage'))
    })
  }
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const request = work(tx.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error ?? new Error(`offline ${store} failed`))
        tx.onabort = () => reject(tx.error ?? new Error('offline transaction aborted'))
      }),
  )
}

export async function loadJobs(): Promise<DownloadJob[]> {
  const rows = await run<DownloadJob[]>('jobs', 'readonly', (store) => store.getAll())
  return rows.sort((a, b) => a.createdAt - b.createdAt)
}

export async function saveJob(job: DownloadJob): Promise<void> {
  await run('jobs', 'readwrite', (store) => store.put(job))
}

export async function deleteJobFile(jobId: string): Promise<void> {
  await dropChunks(jobId)
  await run('files', 'readwrite', (store) => store.delete(jobId))
}

export async function deleteJobRecord(jobId: string): Promise<void> {
  await run('jobs', 'readwrite', (store) => store.delete(jobId))
}

export async function dropChunks(jobId: string): Promise<void> {
  const db = await open()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readwrite')
    const index = tx.objectStore('chunks').index('jobId')
    const request = index.openKeyCursor(IDBKeyRange.only(jobId))
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      tx.objectStore('chunks').delete(cursor.primaryKey)
      cursor.continue()
    }
    request.onerror = () => reject(request.error ?? new Error('could not drop chunks'))
    tx.oncomplete = () => resolve()
    tx.onabort = () => reject(tx.error ?? new Error('could not drop chunks'))
  })
}

export async function chunkCount(jobId: string): Promise<number> {
  const db = await open()
  return new Promise((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly')
    const request = tx.objectStore('chunks').index('jobId').count(IDBKeyRange.only(jobId))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('could not count chunks'))
  })
}

export async function appendChunk(jobId: string, index: number, blob: Blob): Promise<void> {
  const row: ChunkRow = { key: `${jobId}#${String(index).padStart(8, '0')}`, jobId, index, blob }
  await run('chunks', 'readwrite', (store) => store.put(row))
}

export async function getFile(jobId: string): Promise<Blob | null> {
  const row = await run<FileRow | undefined>('files', 'readonly', (store) => store.get(jobId))
  return row?.blob ?? null
}

/** Join the slices into one file; the slices are then free to drop. */
export async function assembleFile(jobId: string, mime: string): Promise<Blob> {
  const db = await open()
  const rows = await new Promise<ChunkRow[]>((resolve, reject) => {
    const tx = db.transaction('chunks', 'readonly')
    const request = tx.objectStore('chunks').index('jobId').getAll(IDBKeyRange.only(jobId))
    request.onsuccess = () => resolve((request.result as ChunkRow[]).sort((a, b) => a.index - b.index))
    request.onerror = () => reject(request.error ?? new Error('could not read chunks'))
  })
  const blob = new Blob(
    rows.map((row) => row.blob),
    { type: mime || 'video/mp4' },
  )
  await run('files', 'readwrite', (store) => store.put({ id: jobId, blob, mime: mime || 'video/mp4', size: blob.size }))
  await dropChunks(jobId)
  return blob
}

export interface StorageStatus {
  used: number
  quota: number
  /** Bytes the browser says it is still willing to store. */
  remaining: number
  persisted: boolean
}

export async function storageStatus(): Promise<StorageStatus> {
  let used = 0
  let quota = 0
  try {
    const estimate = await navigator.storage?.estimate?.()
    used = estimate?.usage ?? 0
    quota = estimate?.quota ?? 0
  } catch {
    /* Safari and some embedded webviews do not expose an estimate. */
  }
  let persisted = false
  try {
    persisted = (await navigator.storage?.persisted?.()) ?? false
  } catch {
    persisted = false
  }
  return { used, quota, remaining: Math.max(0, quota - used), persisted }
}

/** Ask the browser not to evict downloads under pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    if (await navigator.storage.persisted()) return true
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export const OFFLINE_CHUNK_BYTES = CHUNK_BYTES

/** Object URLs handed to <video>; revoked when a download is deleted. */
const objectUrls = new Map<string, string>()

export function objectUrlFor(jobId: string, blob: Blob): string {
  const existing = objectUrls.get(jobId)
  if (existing) return existing
  const url = URL.createObjectURL(blob)
  objectUrls.set(jobId, url)
  return url
}

export function forgetObjectUrl(jobId: string) {
  const existing = objectUrls.get(jobId)
  if (existing) {
    URL.revokeObjectURL(existing)
    objectUrls.delete(jobId)
  }
}
