import type { Provider, Quality } from '../types'

/** The panel lives on plain HTTP and sends no CORS headers, so every request is
 *  routed through a same-origin prefix (`/xtream`) that a proxy forwards. */
export const PANEL_ORIGIN = (import.meta.env.VITE_PANEL_ORIGIN as string | undefined) || 'http://ontvflix.cc:8080'
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '/xtream'

export const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000
export const EPG_CACHE_MS = 10 * 60 * 1000
export const PROGRESS_SAVE_MS = 30_000
export const SEARCH_DEBOUNCE_MS = 300

/** Channels pinned to the "Featured Channels" rail. The panel is matched by name
 *  (IDs differ per reseller), so both the configured id and a name match are used. */
export const FEATURED_CHANNELS: Array<{ id?: number; names?: string[]; label: string }> = [
  { names: ['al jadeed tv', 'aljadeed tv', 'al jadeed', 'jadeed'], label: 'Al Jadeed' },
  { names: ['mtv lebanon', 'mtv'], label: 'MTV Lebanon' },
  { names: ['lbc', 'lbci'], label: 'LBC' },
  {
    names: ['bein sports low 1', 'bein sports low1', 'beinsports low 1', 'bein low 1'],
    label: 'beIN SPORTS LOW 1',
  },
  // Name first, stream id as the fallback: the panel re-issues ids when a
  // channel is reprovisioned, and a stale id tuned nothing at all.
  { names: ['osn cartoon network', 'osn cartoon'], id: 553863, label: 'OSN Cartoon Network' },
  { names: ['spacetoon'], id: 549233, label: 'Spacetoon' },
]

/** Local artwork for channels the panel ships without a usable logo, keyed by
 *  stream id. A transparent wordmark sits well on the card's dark backdrop. */
export const CHANNEL_ART: Record<number, string> = {
  549233: '/logos/spacetoon.png',
}

export const PROVIDER_LABELS: Record<Provider, string> = {
  netflix: 'Netflix',
  prime: 'Prime Video',
  shahid: 'Shahid',
  disney: 'Disney+',
  wwe: 'WWE',
  apple: 'Apple TV+',
  hbo: 'HBO Max',
  osn: 'OSN+',
  other: 'Vntera',
}

export const PROVIDER_COLORS: Record<Provider, string> = {
  netflix: '#E50914',
  prime: '#00A8E1',
  shahid: '#00D1C1',
  disney: '#113CCF',
  wwe: '#D7182A',
  apple: '#FFFFFF',
  hbo: '#5B2C8D',
  osn: '#E8B54B',
  other: '#2a2a2a',
}

export const QUALITY_ORDER: Quality[] = ['4K', 'FHD', 'HD', 'SD']

export const QUALITY_LABELS: Record<Quality, string> = {
  '4K': '4K UHD',
  FHD: 'Full HD',
  HD: 'HD',
  SD: 'SD',
}

export const LANGUAGES: Array<{ code: string; label: string; short: string }> = [
  { code: 'ar', label: 'العربية', short: 'AR' },
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'fr', label: 'Français', short: 'FR' },
]

export const GENRES = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'Horror',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Sport',
  'Thriller',
  'War',
  'Western',
]
