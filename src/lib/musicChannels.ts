import type { Title } from '../types'
import { QUALITY_RANK } from './editions'

/**
 * The Home music row is Arabic-only: the panel's Arabic rails are the ones
 * that carry per-artist stations, and mixing in the Latin/Spotify packs left
 * a wall of near-duplicate entries.
 */
const ARABIC_MUSIC_CATEGORY = /اغاني|أغاني|اغــاني|طرب|موسيق|انغامي|أنغامي|غناء|مزيكا|نغم|روتانا/i

/** Arabic song words inside a channel name when the category is generic. */
const ARABIC_MUSIC_NAME = /اغاني|أغاني|طرب|انغامي|موسيق|غناء/i

/** Arabic-music brands written in Latin letters, e.g. "AR: ROTANA TARAB FM". */
const ARABIC_MUSIC_BRAND = /(^|[^a-z0-9])(anghami|mazzika|nagham|wanasah|rotana tarab)/i

/** Sport, news, religion and film rails that must never leak into music. */
const NOT_MUSIC_CATEGORY = /cinema|movie|sport|news|kids|islamic|quran|shahid|christian/i

/** Same guard for the channel name itself, e.g. "روتانا سينما". */
const NOT_MUSIC_NAME = /cinema|سينما|movies?|films?|مسلسلات|دراما|sport|اخبار/i

export function isArabicMusicChannel(channel: Title): boolean {
  if (NOT_MUSIC_CATEGORY.test(channel.categoryName)) return false
  if (NOT_MUSIC_NAME.test(channel.name)) return false
  if (ARABIC_MUSIC_CATEGORY.test(channel.categoryName)) return true
  if (ARABIC_MUSIC_NAME.test(channel.name)) return true
  return ARABIC_MUSIC_BRAND.test(channel.name)
}

/**
 * Artist names arrive in Arabic and in Latin transliteration — "AR 1 جورج وسوف"
 * next to "AR: ANGHAMI GeorgeWassof" — so both spellings collapse onto one key.
 */
const ARTIST_ALIASES: readonly string[][] = [
  ['فيروز', 'fairuz', 'fairouz'],
  ['ام كلثوم', 'ام كلتوم', 'omkalthom', 'om kalthoum', 'omkalthoum'],
  ['عبد الحليم حافظ', 'abdulhalimhafez', 'abdul halim hafez', 'abdulhalim'],
  ['اصالة', 'asala'],
  ['عزار حبيب', 'azarhabib', 'azar habib'],
  ['جورج وسوف', 'georgewassof', 'george wassouf'],
  ['هاني شاكر', 'hanishaker', 'hani shaker'],
  ['كاظم الساهر', 'kazemalsaher', 'kazem al saher'],
  ['ميادة الحناوي', 'mayadahenawi', 'mayada hennawi'],
  ['راغب علامة', 'raghebalama', 'ragheb alama'],
  ['صباح فخري', 'sabahfakhri', 'sabah fakhri'],
  ['وديع الصافي', 'wadeealsafi', 'wadie alsafi'],
  ['وردة الجزائرية', 'wardaalgazaria', 'warda al jazairia'],
  ['وائل كفوري', 'waelkfory', 'wael kfouri'],
  ['عمر دياب', 'amrodiab', 'amr diab'],
  ['سميرة سعيد', 'samirasaeed', 'samira said'],
  ['سامي كلارك', 'samiklark', 'sami clark'],
  ['تامر حسني', 'tamerhosny', 'tamer hosny'],
  ['اليسا', 'elissa'],
]

const ARABIC_SCRIPT = /[\u0600-\u06FF]/

const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g
const NOISE_WORDS =
  /\b(ar|arab|arabic|anghami|spotify|tarab|rotana|fm|am|tv|uhd|fhd|hd|4k|8k|live|radio|music|channel|هيتس|قناة)\b/g

/** Lower-case, undiacriticised, punctuation-free text for comparison. */
function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(NOISE_WORDS, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const ALIAS_INDEX: { alias: string; canonical: string; pattern: RegExp | null }[] = []
for (const group of ARTIST_ALIASES) {
  const canonical = normalize(group[0])
  for (const alias of group) {
    const normalized = normalize(alias)
    if (!normalized) continue
    ALIAS_INDEX.push({
      alias: normalized,
      canonical,
      pattern: /[\u0600-\u06FF]/.test(normalized) ? null : new RegExp(`\\b${escapeRegex(normalized)}\\b`),
    })
  }
}

/** One key per artist, whatever script or numbering the panel used. */
export function musicChannelKey(channel: Title): string {
  const base = normalize(channel.name)
  if (!base) return `channel ${channel.id}`
  for (const { alias, canonical, pattern } of ALIAS_INDEX) {
    if (canonical === base) return canonical
    if (pattern ? pattern.test(base) : base.includes(alias)) return canonical
  }
  return base
}

/** Trimmed name for the story tile: no "AR" tag, station numbers or quality tags. */
export function musicChannelLabel(name: string): string {
  const trimmed = name
    .replace(/^\s*AR\s*[:_|\-–]?\s*/i, '')
    .replace(/_/g, ' ')
    .replace(/^[\d\s.,:\-–]+/, '')
    .replace(/\b(4k|8k|uhd|fhd|hd|sd|live)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return trimmed || name
}

/** Real artwork first, then an Arabic name, then the sharpest feed. */
function preferChannel(candidate: Title, current: Title): boolean {
  const art = Number(Boolean(candidate.poster)) - Number(Boolean(current.poster))
  if (art) return art > 0
  const arabic = Number(ARABIC_SCRIPT.test(candidate.name)) - Number(ARABIC_SCRIPT.test(current.name))
  if (arabic) return arabic > 0
  const quality = QUALITY_RANK[candidate.quality] - QUALITY_RANK[current.quality]
  if (quality) return quality > 0
  return candidate.name.length < current.name.length
}

/** Artwork first so the row opens with real logos, then alphabetic. */
function compareMusic(a: Title, b: Title): number {
  const art = Number(Boolean(b.poster)) - Number(Boolean(a.poster))
  if (art) return art
  const quality = QUALITY_RANK[b.quality] - QUALITY_RANK[a.quality]
  if (quality) return quality
  return musicChannelLabel(a.name).localeCompare(musicChannelLabel(b.name), 'ar')
}

const cache = new WeakMap<readonly Title[], readonly Title[]>()

/** One Arabic music station per artist, for the Home music row. */
export function musicChannelTitles(channels: readonly Title[]): readonly Title[] {
  const cached = cache.get(channels)
  if (cached) return cached
  const best = new Map<string, Title>()
  for (const channel of channels) {
    if (!isArabicMusicChannel(channel)) continue
    const key = musicChannelKey(channel)
    const current = best.get(key)
    if (!current || preferChannel(channel, current)) best.set(key, channel)
  }
  const picked = [...best.values()].sort(compareMusic)
  cache.set(channels, picked)
  return picked
}
