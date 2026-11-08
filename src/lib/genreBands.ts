import type { Title } from '../types'

/**
 * The two curated homepage bands that sit beside Horror.
 *
 * The panel's movie categories are provider-based (Netflix, Prime, …), so a
 * genre is not something the catalogue reliably carries. Each band therefore
 * combines two signals: the genre/category text the panel does provide, and a
 * name list of well-known titles in that genre. A title qualifies on either,
 * which is what lets the band fill 24 posters from a library that never tagged
 * a single action film as "Action".
 */

export type BandKey = 'action' | 'drama'

export interface BandDefinition {
  key: BandKey
  label: string
  /** Genre the Movies page filter opens with. */
  genre: string
  /** Stage artwork behind the posters. */
  background: string
  /** Accent used for the heading and the card frame. */
  accent: string
  /** Panel genre/category vocabulary, English and Arabic. */
  text: RegExp
  /** Well-known titles, matched against the catalogue's own names. */
  names: readonly string[]
  /** Last resort for the homepage line-up: genre words in a title's name. */
  hints: RegExp
}

/** Action: the genre words the panel uses, plus the films people mean by it. */
const ACTION_NAMES = [
  'john wick',
  'fast & furious',
  'fast and furious',
  'furious 7',
  'fate of the furious',
  'mission: impossible',
  'mission impossible',
  'the expendables',
  'die hard',
  'mad max',
  'terminator',
  'rambo',
  'taken',
  'the equalizer',
  'extraction',
  'atomic blonde',
  'jason bourne',
  'the bourne',
  'gladiator',
  'black panther',
  'avengers',
  'top gun',
  'spider-man',
  'spiderman',
  'the dark knight',
  'batman',
  'the matrix',
  'predator',
  'commando',
  'sicario',
  'heat',
  'speed',
  'con air',
  'the rock',
  'bad boys',
  'ocean',
  'the transporter',
  'crank',
  'shoot em up',
  'wanted',
  'salt',
  'red notice',
  'the gray man',
  'the old guard',
  '6 underground',
  'triple frontier',
  'the raid',
  'ong bak',
  'ip man',
  'kill bill',
  'the killer',
  'bullet train',
  'nobody',
  'the beekeeper',
  'monkey man',
  'civil war',
  'deadpool',
  'wolverine',
  'iron man',
  'captain america',
  'thor',
  'ant-man',
  'guardians of the galaxy',
  'transformers',
  'jurassic world',
  'indiana jones',
  'james bond',
  '007',
  'skyfall',
  'spectre',
  'no time to die',
  'casino royale',
  'the expendable',
  'war',
  'commando',
  'the punisher',
  'ghost rider',
  'hellboy',
  'kung fu',
  'the karate kid',
  'cobra kai',
  'warrior',
  'the last samurai',
  'hero',
  'crouching tiger',
  'the forbidden kingdom',
  'the mummy',
  'national treasure',
  'uncharted',
  'tomb raider',
  'resident evil',
  'underworld',
  'blade',
  'the hunger games',
  'divergent',
  'maze runner',
  'the expendables 4',
  'expend4bles',
  'the meg',
  'san andreas',
  '2012',
  'the day after tomorrow',
  'independence day',
  'godzilla',
  'kong',
  'pacific rim',
  'edge of tomorrow',
  'oblivion',
  'elysium',
  'district 9',
  'total recall',
  'robocop',
  'the running man',
  'escape plan',
  'the accountant',
  'den of thieves',
  'wonder woman',
  'aquaman',
  'shazam',
  'the flash',
  'venom',
  'morbius',
  'kraven',
  'madame web',
  'the boys',
  'reacher',
  'strike back',
  'seal team',
  'the terminal list',
  'jack ryan',
  '24',
  'prison break',
  'the punisher',
  'daredevil',
  'arrow',
  'the flash',
  'supergirl',
  'smallville',
  'agents of s.h.i.e.l.d',
  'loki',
  'hawkeye',
  'falcon',
  'moon knight',
  'she-hulk',
  'secret invasion',
  'echo',
  'daredevil: born again',
] as const

/** Drama: the genre words the panel uses, plus the films people mean by it. */
const DRAMA_NAMES = [
  'the godfather',
  'the shawshank redemption',
  'forrest gump',
  'the green mile',
  'titanic',
  'parasite',
  'joker',
  'whiplash',
  'the pursuit of happyness',
  'a beautiful mind',
  'the social network',
  'la la land',
  'casablanca',
  'good will hunting',
  '12 angry men',
  'schindler',
  'the pianist',
  'nomadland',
  'spotlight',
  'the help',
  'hidden figures',
  'marriage story',
  'manchester by the sea',
  'moonlight',
  'the departed',
  'mystic river',
  'million dollar baby',
  'the reader',
  'revolutionary road',
  'american beauty',
  'the truman show',
  'dead poets society',
  'rain man',
  'philadelphia',
  'the elephant man',
  'awakenings',
  'the theory of everything',
  'the imitation game',
  'darkest hour',
  'the king',
  'the crown',
  'the queen',
  'bohemian rhapsody',
  'rocketman',
  'elvis',
  'oppenheimer',
  'the post',
  'all the president',
  'the big short',
  'margin call',
  'the wolf of wall street',
  'the irishman',
  'the godfather part ii',
  'once upon a time in america',
  'scarface',
  'goodfellas',
  'casino',
  'the untouchables',
  'a bronx tale',
  'the fighter',
  'warrior',
  'southpaw',
  'creed',
  'rocky',
  'the wrestler',
  'the blind side',
  'coach carter',
  'remember the titans',
  'friday night lights',
  'the express',
  'glory road',
  'the founder',
  'jobs',
  'steve jobs',
  'the danish girl',
  'carol',
  'brooklyn',
  'room',
  'lion',
  'slumdog millionaire',
  'the best exotic marigold hotel',
  'the hundred-foot journey',
  'the lunchbox',
  'the salesman',
  'a separation',
  'capernaum',
  'the insult',
  'omar',
  'paradise now',
  'wadjda',
  'theeb',
  'theeb',
  'the kite runner',
  'the stoning of soraya',
  'the color purple',
  'precious',
  '12 years a slave',
  'selma',
  'malcolm x',
  'the butler',
  'green book',
  'the hate u give',
  'just mercy',
  'when they see us',
  'the trial of the chicago 7',
  'mudbound',
  'beasts of the southern wild',
  'the florida project',
  'minari',
  'coda',
  'the father',
  'the whale',
  'the banshees of inisherin',
  'aftersun',
  'past lives',
  'the holdovers',
  'anatomy of a fall',
  'the zone of interest',
  'poor things',
  'killers of the flower moon',
  'the color of money',
  'the last duel',
  'house of gucci',
  'the outfit',
  'the trial',
  'the staircase',
  'dahmer',
  'monster',
  'the act',
  'the dropout',
  'wecrashed',
  'super pumped',
  'the dropout',
  'dopesick',
  'the patient',
  'the stair',
  'the undoing',
  'big little lies',
  'sharp objects',
  'mare of easttown',
  'the night of',
  'true detective',
  'mindhunter',
  'ozark',
  'breaking bad',
  'better call saul',
  'the sopranos',
  'the wire',
  'succession',
  'mad men',
  'the west wing',
  'house of cards',
  'the newsroom',
  'the good wife',
  'the good fight',
  'damages',
  'bloodline',
  'the affair',
  'this is us',
  'parenthood',
  'friday night lights',
  'friday night lights',
  'the leftovers',
  'six feet under',
  'the handmaid',
  'the morning show',
  'the diplomat',
  'the crown',
  'downton abbey',
  'peaky blinders',
  'boardwalk empire',
  'the last kingdom',
  'vikings',
  'the tudors',
  'the white lotus',
  'yellowstone',
  '1923',
  '1883',
  'the bear',
  'shameless',
  'euphoria',
  'skins',
  'the oc',
  'one tree hill',
  'gilmore girls',
  'greys anatomy',
  "grey's anatomy",
  'er',
  'house',
  'the good doctor',
  'new amsterdam',
  'chicago med',
  'the resident',
  'this is going to hurt',
] as const

export const BANDS: Record<BandKey, BandDefinition> = {
  action: {
    key: 'action',
    label: 'Action Movies',
    genre: 'Action',
    background: '/images/action-back.jpg',
    accent: '#ff6b35',
    text: /action|adventure|أكشن|اكشن|مغامرة|مغامرات/i,
    names: ACTION_NAMES,
    hints: /war|battle|mission|agent|kill|escape|hunt|heist|fight|gun|strike|force|fury|legend|hero|raid|assassin|revenge|dead|blood|fire|attack|siege|chase|sniper|soldier|commando|mercenary|gladiator|arena|combat|warrior|outlaw|rider|explosion/i,
  },
  drama: {
    key: 'drama',
    label: 'Drama Movies',
    genre: 'Drama',
    background: '/images/drama-back.jpg',
    accent: '#7c9cff',
    text: /drama|دراما|درامي/i,
    names: DRAMA_NAMES,
    hints: /life|love|story|heart|family|father|mother|son|daughter|dream|hope|home|journey|secret|truth|way|road|last|first|years|summer|winter|rain|light|shadow|voice|silent|letter|memory|promise|choice|faith|justice|freedom/i,
  },
}

/** How many posters a homepage band carries, laid out two rows deep. */
export const BAND_COUNT = 24

/** Lower-case, punctuation-free form used for name matching. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const nameCache = new WeakMap<Title, string>()

function titleName(title: Title): string {
  const cached = nameCache.get(title)
  if (cached !== undefined) return cached
  // A catalogue title carries its normalised name from the build, so a launch
  // that reads the cache does not normalise forty-six thousand names again.
  const value = title.searchName ?? normalize(title.name)
  nameCache.set(title, value)
  return value
}

/** The same normalisation, for the catalogue build to store on each title. */
export function normalizeTitleName(name: string): string {
  return normalize(name)
}

/**
 * The band's name list, normalised once. The Movies page asks about every one
 * of ~46k titles on mount, and normalising ~150 needles inside that loop cost
 * thirteen seconds of main thread; the list never changes, so it is built once.
 */
interface BandIndex {
  /**
   * Known titles as word arrays, grouped by their first word. A movie name only
   * has to look at the phrases that could possibly start at each of its own
   * words, instead of building every n-gram and looking each one up: on a
   * 46k-title library the old slice-and-join pass was hundreds of milliseconds
   * on every home render.
   */
  byFirstWord: Map<string, string[][]>
  /** Names like "24" or "007" only ever match the whole title. */
  numeric: Set<string>
}

const indexCache = new WeakMap<BandDefinition, BandIndex>()

function bandIndex(band: BandDefinition): BandIndex {
  const cached = indexCache.get(band)
  if (cached) return cached
  const byFirstWord = new Map<string, string[][]>()
  const numeric = new Set<string>()
  for (const entry of band.names) {
    const text = normalize(entry)
    if (!text) continue
    if (/^\d+$/.test(text)) {
      numeric.add(text)
      continue
    }
    const words = text.split(' ')
    const list = byFirstWord.get(words[0])
    if (list) list.push(words)
    else byFirstWord.set(words[0], [words])
  }
  const index = { byFirstWord, numeric }
  indexCache.set(band, index)
  return index
}

/** A title's normalised words, split once and reused by every band. */
const wordsCache = new WeakMap<Title, string[]>()

function titleWords(title: Title): string[] {
  const cached = wordsCache.get(title)
  if (cached) return cached
  const name = titleName(title)
  const words = name ? name.split(' ') : []
  wordsCache.set(title, words)
  return words
}

/** Per-title, per-band answer for the name scan. */
const nameResult = new WeakMap<Title, Partial<Record<BandKey, boolean>>>()

/**
 * True when the catalogue's own name is one of the band's known titles.
 *
 * The answer is cached on the title: the rail builder, the genre filter and the
 * catalogue warm-up all ask the same question about the same movie, and the
 * scan is pure over fields that never change while the title object lives.
 */
export function matchesBandName(title: Title, band: BandDefinition): boolean {
  let answers = nameResult.get(title)
  if (!answers) {
    answers = {}
    nameResult.set(title, answers)
  }
  const known = answers[band.key]
  if (known !== undefined) return known
  const value = scanBandName(title, band)
  answers[band.key] = value
  return value
}

function scanBandName(title: Title, band: BandDefinition): boolean {
  const words = titleWords(title)
  if (!words.length) return false
  const { byFirstWord, numeric } = bandIndex(band)
  if (words.length === 1 && numeric.has(words[0])) return true
  for (let i = 0; i < words.length; i += 1) {
    const candidates = byFirstWord.get(words[i])
    if (!candidates) continue
    for (const phrase of candidates) {
      if (phrase.length > words.length - i) continue
      let hit = true
      for (let k = 1; k < phrase.length; k += 1) {
        if (words[i + k] !== phrase[k]) {
          hit = false
          break
        }
      }
      if (hit) return true
    }
  }
  return false
}

/** Genre/category text the panel provides for this band. */
export function matchesBandText(title: Title, band: BandDefinition): boolean {
  if (title.genres.some((genre) => band.text.test(genre))) return true
  return band.text.test(title.categoryName ?? '')
}

/**
 * Which of the band's three selection tiers a title falls in:
 * 0 the band's known titles, 1 tagged with the genre, 2 only a name hint.
 * Answered once per title: the rail builder walks the whole library, and the
 * three tests behind this (two regexes and a phrase scan) are the most
 * expensive thing the home page does.
 */
const bandResult = new WeakMap<Title, Partial<Record<BandKey, 0 | 1 | 2 | 3>>>()

/** 0 known title, 1 tagged genre, 2 name hint only, 3 not in the band. */
function classifyBand(title: Title, band: BandDefinition): 0 | 1 | 2 | 3 {
  let answers = bandResult.get(title)
  if (!answers) {
    answers = {}
    bandResult.set(title, answers)
  }
  const known = answers[band.key]
  if (known !== undefined) return known
  const value: 0 | 1 | 2 | 3 = matchesBandName(title, band)
    ? 0
    : matchesBandText(title, band)
      ? 1
      : band.hints.test(title.name)
        ? 2
        : 3
  answers[band.key] = value
  return value
}

/**
 * Per-title answer for a band. A catalogue title object is stable for the life
 * of the snapshot, and the genre list, the counts and the filtered grid all ask
 * the same question about the same 46k titles, so it is answered once.
 */
export function isBandTitle(title: Title, band: BandDefinition): boolean {
  const tier = classifyBand(title, band)
  return tier === 0 || tier === 1
}

/**
 * Answers every band question this title can be asked, so a later home render
 * is a cache read. Called in slices while the catalogue loads, when the launch
 * intro is on screen and the work costs nothing the viewer can see.
 */
export function warmBandTitle(title: Title): void {
  for (const band of Object.values(BANDS)) classifyBand(title, band)
}

/** Genre name to band, resolved once instead of per title. */
const BAND_BY_GENRE = new Map<string, BandDefinition>(
  Object.values(BANDS).map((band) => [band.genre.toLowerCase(), band]),
)

/**
 * The homepage band: known titles first (best rated first), then everything
 * else the panel labels with the genre, until the band is full.
 */
/** Rating order, computed once per catalogue and shared by every band. */
const ratingOrderCache = new WeakMap<readonly Title[], Title[]>()

function ratingOrdered(movies: readonly Title[]): Title[] {
  const cached = ratingOrderCache.get(movies)
  if (cached) return cached
  const sorted = [...movies].sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.addedAt - a.addedAt || a.id - b.id,
  )
  ratingOrderCache.set(movies, sorted)
  return sorted
}

export function pickBandTitles(
  movies: readonly Title[],
  band: BandDefinition,
  count = BAND_COUNT,
): Title[] {
  // One ordered pass replaces three filter-and-sort passes per band, and the
  // order is cached per catalogue: the landing page builds two bands, so this
  // used to sort forty-six thousand titles six times on its first paint.
  const named: Title[] = []
  const tagged: Title[] = []
  const hinted: Title[] = []
  for (const movie of ratingOrdered(movies)) {
    const tier = classifyBand(movie, band)
    if (tier === 0) named.push(movie)
    else if (tier === 1) tagged.push(movie)
    // Some libraries tag almost nothing, so the line-up is topped up from names
    // that carry the genre's vocabulary rather than left short of a band.
    else if (tier === 2) hinted.push(movie)
  }

  const out: Title[] = []
  const seen = new Set<number>()
  for (const movie of [...named, ...tagged, ...hinted]) {
    if (out.length >= count) break
    if (seen.has(movie.id)) continue
    seen.add(movie.id)
    out.push(movie)
  }
  return out
}

/** Whether a catalogue title belongs to the band's genre filter. */
export function matchesBandGenre(title: Title, genre: string): boolean {
  const band = typeof genre === 'string' ? BAND_BY_GENRE.get(genre.toLowerCase()) : undefined
  if (!band) return false
  return isBandTitle(title, band)
}
