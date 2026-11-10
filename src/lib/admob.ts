import { Capacitor } from '@capacitor/core'

/**
 * AdMob identifiers from the AdMob console.
 *
 * The app id also lives in android/app/src/main/AndroidManifest.xml
 * (com.google.android.gms.ads.APPLICATION_ID) and app-ads.txt at the web root
 * authorises the publisher domain, so keep all three in sync.
 */
export const ADMOB_APP_ID = 'ca-app-pub-4709384892686731~2904033269'
export const ADMOB_BANNER_UNIT_ID = 'ca-app-pub-4709384892686731/8889635927'

/** The Mobile Ads SDK only exists inside the Android shell, never in a browser. */
export function adsSupported(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android'
}

let initialized: Promise<typeof import('@capacitor-community/admob') | null> | null = null
let showing = false

async function sdk() {
  if (!adsSupported()) return null
  if (!initialized) {
    initialized = import('@capacitor-community/admob')
      .then(async (module) => {
        await module.AdMob.initialize({ initializeForTesting: false })
        return module
      })
      .catch(() => null)
  }
  return initialized
}

/** Show the banner; resolves true once it is on screen. */
export async function showAdsBanner(): Promise<boolean> {
  const module = await sdk()
  if (!module) return false
  try {
    await module.AdMob.showBanner({
      adId: ADMOB_BANNER_UNIT_ID,
      adSize: module.BannerAdSize.ADAPTIVE_BANNER,
      position: module.BannerAdPosition.BOTTOM_CENTER,
      margin: 0,
      isTesting: false,
    })
    showing = true
    return true
  } catch {
    return false
  }
}

/** Remove the banner again; safe to call when nothing is showing. */
export async function hideAdsBanner(): Promise<void> {
  if (!showing) return
  showing = false
  const module = await sdk()
  if (!module) return
  try {
    await module.AdMob.removeBanner()
  } catch {
    /* the view is already gone */
  }
}
