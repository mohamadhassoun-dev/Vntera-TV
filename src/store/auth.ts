import { create } from 'zustand'
import { getDeviceId, decryptSecret, encryptSecret, idbDel, idbGet, idbSet } from '../lib/storage'
import { authenticate, clearApiCredentials, getUserInfo, PanelError, setApiCredentials, setServerOrigin } from '../lib/xtream'
import { PANEL_ORIGIN } from '../lib/config'
import type { AuthSession } from '../types'

export type AuthStatus = 'booting' | 'anon' | 'authed' | 'reauth'

interface StoredAuth {
  session: AuthSession
  enc: string
}

interface AuthStore {
  status: AuthStatus
  session: AuthSession | null
  busy: boolean
  error: string | null
  bootstrap: () => Promise<void>
  login: (username: string, password: string, portal?: string) => Promise<boolean>
  logout: () => Promise<void>
  validate: () => Promise<void>
  updateUserInfo: (session: AuthSession) => void
  clearError: () => void
}

const STORAGE_KEY = 'auth:session'

async function persist(session: AuthSession, password: string | null) {
  const enc = password ? await encryptSecret(password) : ''
  await idbSet(STORAGE_KEY, { session, enc } satisfies StoredAuth)
}

export const useAuth = create<AuthStore>((set, get) => ({
  status: 'booting',
  session: null,
  busy: false,
  error: null,

  bootstrap: async () => {
    try {
      const saved = await idbGet<StoredAuth>(STORAGE_KEY)
      if (!saved?.session) {
        set({ status: 'anon' })
        return
      }
      // Demo sessions are no longer supported; clear them and ask for a login.
      if (saved.session.demo) {
        await idbDel(STORAGE_KEY)
        set({ status: 'anon' })
        return
      }
      const password = saved.enc ? await decryptSecret(saved.enc) : ''
      if (!password) {
        await idbDel(STORAGE_KEY)
        set({ status: 'anon', error: 'Saved session could not be unlocked. Please sign in again.' })
        return
      }
      setServerOrigin(saved.session.server || PANEL_ORIGIN)
      setApiCredentials(saved.session.username, password)
      set({ session: saved.session, status: 'authed' })
      // Background session validation — a revoked subscription never signs the
      // user out silently; it raises the re-auth prompt instead.
      void get().validate()
    } catch {
      set({ status: 'anon' })
    }
  },

  login: async (username, password, portal) => {
    const user = username.trim()
    if (!user || !password) {
      set({ error: 'Enter your username and password.' })
      return false
    }
    set({ busy: true, error: null })
    try {
      const origin = (portal || PANEL_ORIGIN).trim()
      const { userInfo, serverInfo } = await authenticate(user, password, origin)
      const session: AuthSession = {
        username: user,
        server: origin,
        userInfo,
        serverInfo,
        loggedInAt: Date.now(),
        deviceId: getDeviceId(),
      }
      await persist(session, password)
      set({ session, status: 'authed', busy: false })
      return true
    } catch (err) {
      const message =
        err instanceof PanelError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Unable to sign in. Try again.'
      set({ busy: false, error: message })
      return false
    }
  },

  logout: async () => {
    await idbDel(STORAGE_KEY)
    clearApiCredentials()
    set({ session: null, status: 'anon', error: null })
  },

  validate: async () => {
    const session = get().session
    if (!session) return
    try {
      const { userInfo, serverInfo } = await getUserInfo()
      const next: AuthSession = { ...session, userInfo, serverInfo }
      set({ session: next, status: 'authed' })
      const enc = await idbGet<StoredAuth>(STORAGE_KEY)
      if (enc) void idbSet(STORAGE_KEY, { ...enc, session: next })
    } catch (err) {
      if (err instanceof PanelError && (err.kind === 'auth' || err.kind === 'expired')) {
        set({ status: 'reauth', error: err.message })
      }
      // Network failures keep the session intact; content stays available offline.
    }
  },

  updateUserInfo: (session) => set({ session }),
  clearError: () => set({ error: null }),
}))

export function currentAccount(): string {
  return useAuth.getState().session?.username ?? 'anonymous'
}
