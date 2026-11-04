import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Settings } from '../types'

const DEFAULTS: Settings = {
  quality: 'auto',
  autoplayNext: true,
  autoplayPreviews: false,
  subtitlesEnabled: false,
  subtitleLanguage: 'en',
  audioLanguage: 'auto',
  contentLanguage: 'all',
  dataSaver: false,
  wifiOnlyDownloads: true,
  notifications: true,
  epgAlerts: true,
  uiLanguage: 'en',
  reduceMotion: false,
}

interface SettingsStore extends Settings {
  set: (patch: Partial<Settings>) => void
  reset: () => void
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (patch) => set(patch),
      reset: () => set(DEFAULTS),
    }),
    { name: 'vntera:settings', version: 1 },
  ),
)
