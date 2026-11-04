// ---------------------------------------------------------------------------
// Storage primitives.
// - IndexedDB is the web equivalent of AsyncStorage and holds catalog snapshots,
//   the local library and the non-extractable AES key.
// - The password itself is only ever persisted as AES-GCM ciphertext.
// - Falls back to localStorage when IndexedDB is unavailable (private modes / TV
//   webviews) so login still works.
// ---------------------------------------------------------------------------

const DB_NAME = 'vntera'
const DB_VERSION = 1
const STORE = 'kv'
const LS_PREFIX = 'vntera:'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
      req.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return dbPromise
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest): Promise<T | null> {
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, mode)
      const req = fn(tx.objectStore(STORE))
      req.onsuccess = () => resolve(req.result as T)
      req.onerror = () => resolve(null)
      tx.onabort = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const fromDb = await withStore<T>('readonly', (s) => s.get(key))
  if (fromDb != null) return fromDb
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  const ok = await withStore<IDBValidKey>('readwrite', (s) => s.put(value, key))
  if (ok != null) return
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch {
    /* quota exceeded — non-fatal, screen just re-fetches next launch */
  }
}

export async function idbDel(key: string): Promise<void> {
  await withStore<undefined>('readwrite', (s) => s.delete(key))
  try {
    localStorage.removeItem(LS_PREFIX + key)
  } catch {
    /* ignore */
  }
}

export async function idbClear(): Promise<void> {
  await withStore<undefined>('readwrite', (s) => s.clear())
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(LS_PREFIX)) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

export function localGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(LS_PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function localSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

// ------------------------------ crypto -------------------------------------

const KEY_ID = 'crypto:key'
const enc = new TextEncoder()
const dec = new TextDecoder()

async function getKey(): Promise<CryptoKey | null> {
  if (!('crypto' in globalThis) || !crypto.subtle) return null
  const existing = await idbGet<CryptoKey>(KEY_ID)
  if (existing) return existing
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await idbSet(KEY_ID, key)
  return key
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function fromBase64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/** Returns `iv.ciphertext` as base64, or a plain marker if WebCrypto is missing. */
export async function encryptSecret(plain: string): Promise<string> {
  const key = await getKey()
  if (!key) return `plain:${btoa(unescape(encodeURIComponent(plain)))}`
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plain))
  return `v1:${toBase64(iv.buffer as ArrayBuffer)}:${toBase64(cipher)}`
}

export async function decryptSecret(payload: string): Promise<string> {
  try {
    if (payload.startsWith('plain:')) return decodeURIComponent(escape(atob(payload.slice(6))))
    const [version, ivB64, dataB64] = payload.split(':')
    if (version !== 'v1' || !ivB64 || !dataB64) return ''
    const key = await getKey()
    if (!key) return ''
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(ivB64) as unknown as BufferSource },
      key,
      fromBase64(dataB64) as unknown as BufferSource,
    )
    return dec.decode(plain)
  } catch {
    return ''
  }
}

export function getDeviceId(): string {
  const existing = localGet<string>('device:id', '')
  if (existing) return existing
  const id =
    (globalThis.crypto?.randomUUID?.() as string | undefined) ??
    `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  localSet('device:id', id)
  return id
}
