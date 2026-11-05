import type { Title } from '../types'
import { groupChannelFamilies, type ChannelFamily } from './channelFamilies'

const ARABIC_SCRIPT = /[\u0600-\u06FF]/
/** The panel names its Arabic rails up front: "AR - NEWS", "AR | Movies", "AR: Kids". */
const ARABIC_CATEGORY = /^\s*AR\b/i

const QUALITY_RANK = { '4K': 4, FHD: 3, HD: 2, SD: 1 } as const

/** Broadcasters a viewer expects on an Arabic wall; they lead when they have a logo. */
const KNOWN_BRANDS =
  /(jazeera|جزيرة|arabiya|عربية|sky news|سكاي|mbc|rotana|روتانا|lbc|mtv|dubai|دبي|abu ?dhabi|أبوظبي|sharjah|الشارقة|bein|بي إن|ssc|al ?kass|الكأس|nile|نايل|cbc|dmc|on e|ontv|النهار|nahar|الغد|ghad|manar|المنار|mayadeen|ميادين|al ?araby|العربي|asharq|الشرق|france 24|bbc|cnn|trt|kuwait|الكويت|qatar|قطر|saudi|السعودية|alaoula|الأولى|2m|nessma|نسما|hannibal|ثاقفية|thaqafia|الثقافية|almashhad|المشهد|aljadeed|الجديد|الجزائر|الشروق|النهضة|اليمن|سوريا|لبنان|فلسطين|الأقصى|القدس)/i

/** A channel is Arabic when the panel files it under an AR section, tags it `ar`,
 *  or writes its name in Arabic script — panels do all three, inconsistently. */
export function isArabicChannel(channel: Title): boolean {
  if (channel.languages.includes('ar')) return true
  if (ARABIC_CATEGORY.test(channel.categoryName)) return true
  return ARABIC_SCRIPT.test(channel.name)
}

/** Tile caption: no "AR" tag, underscores or quality suffixes. */
export function arabicChannelLabel(name: string): string {
  const trimmed = name
    // Panel section tags arrive as "|AR.MBC|", "AR: " and "AR_" prefixes.
    .replace(/^\s*(?:\|[^|]*\|\s*)+/, '')
    .replace(/^\s*AR\s*[:_|.\-–]?\s*/i, '')
    .replace(/_/g, ' ')
    .replace(/\b(4k|8k|uhd|fhd|hdr|hd|sd|hq|live)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return trimmed || name
}

const cache = new WeakMap<readonly Title[], readonly ChannelFamily[]>()

/**
 * One card per Arabic broadcaster — five Al Jazeera feeds become one card — with
 * logos first so the closing grid never shows a placeholder, then the brands a
 * viewer recognises, then the sharpest feed.
 */
export function arabicChannelFamilies(channels: readonly Title[]): readonly ChannelFamily[] {
  const cached = cache.get(channels)
  if (cached) return cached
  const arabic = channels.filter((channel) => channel.kind === 'live' && isArabicChannel(channel))
  const families = groupChannelFamilies(arabic).sort((a, b) => {
    const artwork = Number(Boolean(b.primary.poster)) - Number(Boolean(a.primary.poster))
    if (artwork) return artwork
    const brand = Number(KNOWN_BRANDS.test(b.label)) - Number(KNOWN_BRANDS.test(a.label))
    if (brand) return brand
    const quality = QUALITY_RANK[b.primary.quality] - QUALITY_RANK[a.primary.quality]
    if (quality) return quality
    return arabicChannelLabel(a.label).localeCompare(arabicChannelLabel(b.label), 'ar')
  })
  cache.set(channels, families)
  return families
}
