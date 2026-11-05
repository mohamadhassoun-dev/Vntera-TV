import pkg from '../../package.json'

/** Version baked into the current release APK (kept in step with package.json). */
export const ANDROID_RELEASE = {
  version: pkg.version,
  // Served from /downloads/ so the SPA route /download is not shadowed by a real directory.
  file: `/downloads/vntera-${pkg.version}.apk`,
  minAndroid: '7.0',
  sizeLabel: '7.5 MB',
} as const
