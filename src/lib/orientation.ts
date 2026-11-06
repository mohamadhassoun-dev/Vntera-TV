import { Capacitor } from '@capacitor/core'
import { ScreenOrientation } from '@capacitor/screen-orientation'

/** How the picture was turned, so the control can undo exactly what it did. */
export type RotateMode = 'native' | 'web' | 'css'

type WebOrientation = {
  type?: string
  lock?: (orientation: 'landscape' | 'portrait') => Promise<void>
  unlock?: () => void
}

function webOrientation(): WebOrientation | null {
  if (typeof screen === 'undefined') return null
  return (screen.orientation as WebOrientation | undefined) ?? null
}

/** Whether the screen is landscape right now, from the API or its geometry. */
export function isLandscape(): boolean {
  const type = webOrientation()?.type ?? ''
  if (type.startsWith('landscape')) return true
  if (type.startsWith('portrait')) return false
  return typeof window !== 'undefined' && window.innerWidth > window.innerHeight
}

/**
 * Turn the app landscape.
 *
 * In the Android shell the Capacitor plugin rotates the whole activity, which
 * keeps the WebView (and the video inside it) alive, so the film never reloads
 * or loses its position. A browser gets the standard Screen Orientation lock
 * when the host allows it; when it does not — most desktop browsers and every
 * page that is not fullscreen — the caller lays the picture over from CSS.
 */
export async function rotateLandscape(): Promise<RotateMode> {
  if (Capacitor.isNativePlatform()) {
    try {
      await ScreenOrientation.lock({ orientation: 'landscape' })
      return 'native'
    } catch {
      /* older shells without the plugin fall through */
    }
  }
  const api = webOrientation()
  if (api?.lock) {
    try {
      await api.lock('landscape')
      return 'web'
    } catch {
      /* not supported outside fullscreen / installed app */
    }
  }
  return 'css'
}

/** Back to the handset's own idea of upright. */
export async function rotatePortrait(): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await ScreenOrientation.unlock()
    } catch {
      /* ignore */
    }
  }
  try {
    webOrientation()?.unlock?.()
  } catch {
    /* ignore */
  }
}

/** Release a lock when the player goes away, so the next screen is upright. */
export async function releaseOrientation(mode: RotateMode | null): Promise<void> {
  if (!mode || mode === 'css') return
  await rotatePortrait()
}
