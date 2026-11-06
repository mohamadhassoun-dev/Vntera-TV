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
  const value = normalize(title.name)
  nameCache.set(title, value)
  return value
}

/** True when the catalogue's own name is one of the band's known titles. */
export function matchesBandName(title: Title, band: BandDefinition): boolean {
  const name = titleName(title)
  if (!name) return false
  return band.names.some((entry) => {
    const needle = normalize(entry)
    if (!needle) return false
    // A numeric name ("24", "007", "2012") only matches on its own: otherwise
    // any catalogue title ending in "24" would join the band.
    if (/^\d+$/.test(needle)) return name === needle
    // Whole-word containment: "John Wick: Chapter 4" matches "john wick",
    // while "Heat" does not match "The Heat of the Night" by accident.
    return name === needle || name.startsWith(`${needle} `) || name.includes(` ${needle} `) || name.endsWith(` ${needle}`)
  })
}

/** Genre/category text the panel provides for this band. */
export function matchesBandText(title: Title, band: BandDefinition): boolean {
  if (title.genres.some((genre) => band.text.test(genre))) return true
  return band.text.test(title.categoryName ?? '')
}

export function isBandTitle(title: Title, band: BandDefinition): boolean {
  return matchesBandText(title, band) || matchesBandName(title, band)
}

/**
 * The homepage band: known titles first (best rated first), then everything
 * else the panel labels with the genre, until the band is full.
 */
export function pickBandTitles(
  movies: readonly Title[],
  band: BandDefinition,
  count = BAND_COUNT,
): Title[] {
  const byRating = (a: Title, b: Title) =>
    (b.rating ?? 0) - (a.rating ?? 0) || b.addedAt - a.addedAt || a.id - b.id
  const named = movies.filter((movie) => matchesBandName(movie, band)).sort(byRating)
  const tagged = movies
    .filter((movie) => !matchesBandName(movie, band) && matchesBandText(movie, band))
    .sort(byRating)
  // Some libraries tag almost nothing, so the line-up is topped up from names
  // that carry the genre's vocabulary rather than left short of a full band.
  const hinted = movies
    .filter(
      (movie) =>
        !matchesBandName(movie, band) && !matchesBandText(movie, band) && band.hints.test(movie.name),
    )
    .sort(byRating)

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
  const band = Object.values(BANDS).find((entry) => entry.genre.toLowerCase() === genre.toLowerCase())
  if (!band) return false
  return isBandTitle(title, band)
}
