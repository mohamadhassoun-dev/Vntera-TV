import { Fragment, useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { EmptyState } from '../components/Feedback'
import { PageSkeleton } from '../components/Skeleton'
import {
  ChannelCard,
  ChannelStoryCard,
  Hero,
  HideCaptionsContext,
  HideDatesContext,
  ProviderLogoCard,
} from '../components/cards'
import { TvHero } from '../components/TvHero'
import { CollectionCard } from '../components/CollectionCard'
import { ChannelLogoGrid } from '../components/ChannelLogoGrid'
import { SectionHeading } from '../components/Badges'
import { ShortcutEditor } from '../components/ShortcutEditor'
import { ContinueRail, PosterRail, Rail, ShortcutChannelRail, TopTenRail } from '../components/Rails'
import { HorrorBand } from '../components/HorrorBand'
import { GenreBand } from '../components/GenreBand'
import { Icon } from '../components/Icons'
import { usePullToRefresh } from '../lib/hooks'
import { detectFormFactor } from '../lib/platform'
import {
  createArtworkUsage,
  reserveTitles,
  scheduleNextRotationUpdate,
  scheduleNextUtcWeekUpdate,
  selectUniqueNewTitles,
  selectUniqueRailTitles,
  utcRotationIndex,
  utcWeekIndex,
} from '../lib/homeRotation'
import { heroCandidatePool, selectHeroRotation } from '../lib/heroRotation'
import { collectionTitles } from '../lib/collections'
import { musicChannelTitles } from '../lib/musicChannels'
import { arabicChannelFamilies } from '../lib/arabicChannels'
import { isHiddenFromHome } from '../lib/hidden'
import { pickHorrorTitles } from '../lib/horror'
import { BANDS, pickBandTitles } from '../lib/genreBands'
import { categoriesWithCounts, useCatalog } from '../store/catalog'
import { defaultShortcutItems, resolveShortcuts, useShortcuts } from '../store/shortcuts'
import { useHeroHistory } from '../store/heroHistory'
import { continueWatching, useLibrary } from '../store/library'
import type { Provider, Title } from '../types'

/** Home rail brands, in the requested order. IMDb sits between Disney+ and WWE. */
type HomeRailBrand = Provider | 'imdb'
const BRAND_RAIL_ORDER: HomeRailBrand[] = ['netflix', 'prime', 'shahid', 'disney', 'imdb', 'wwe']
const RAIL_LIMIT = 24
const PROVIDER_MIN_ITEMS = 10
const TOP_TEN_COUNT = 10
const WEEK_SECONDS = 7 * 86_400
/** IMDb is not a panel category: the row curates the catalog's top-rated movies. */
const IMDB_MIN_RATING = 6.5

interface HomeRows {
  hero: Title[]
  topTen: Title[]
  brands: Array<{ brand: HomeRailBrand; titles: Title[] }>
  horror: Title[]
  action: Title[]
  drama: Title[]
  kids: Title[]
  anime: Title[]
  blockbusters: Title[]
  fresh: Title[]
  popular: Title[]
}

/** Every rail on the page, for one week, plus the hero line-up chosen for the
 *  current three-day rotation. Pure over the catalog, so the result is kept per
 *  movie list: opening a channel and pressing back must not rebuild eleven sorts
 *  over 46k titles again. */
const rowsCache = new WeakMap<readonly Title[], Map<string, HomeRows>>()

export function computeHomeRows(
  allMovies: readonly Title[],
  weekIndex: number,
  rotationIndex: number,
  heroIds: readonly number[] = [],
): HomeRows {
  let byWeek = rowsCache.get(allMovies)
  if (!byWeek) {
    byWeek = new Map()
    rowsCache.set(allMovies, byWeek)
  }
  const cacheKey = `${weekIndex}:${rotationIndex}:${heroIds.join(',')}`
  const cached = byWeek.get(cacheKey)
  if (cached) return cached

  // See lib/hidden: a few panel entries are kept off the landing page, here where
  // every rail is built so no caller can put them back.
  const movies = allMovies.filter((movie) => !isHiddenFromHome(movie))
  const since = Date.now() / 1000 - WEEK_SECONDS
  const recentMovies = movies
    .filter((movie) => movie.addedAt >= since)
    .sort((a, b) => b.addedAt - a.addedAt)
  const trendingMovies = movies
    .filter((movie) => movie.addedAt > 0)
    .sort(
      (a, b) => b.addedAt * 0.6 + (b.rating ?? 0) * 1000 - (a.addedAt * 0.6 + (a.rating ?? 0) * 1000),
    )
  const popularPool = [...movies].sort(
    (a, b) => (b.watchCount ?? 0) - (a.watchCount ?? 0) || (b.rating ?? 0) - (a.rating ?? 0),
  )

  const imdbPool = movies
    .filter((movie) => (movie.rating ?? 0) >= IMDB_MIN_RATING)
    .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || (b.watchCount ?? 0) - (a.watchCount ?? 0))

  // One pass in display order: every rail takes titles and poster images no
  // earlier rail used, so no movie and no artwork repeats down the page.
  const usage = createArtworkUsage()
  const take = (pool: readonly Title[], railKey: string, limit: number) =>
    selectUniqueRailTitles(pool, railKey, weekIndex, limit, usage)

  // The hero line-up is chosen outside this function, where the no-repeat history
  // lives; it comes from the Popular and Blockbusters pools, so keeping its
  // movies out of the rails below stops the same poster appearing twice.
  const moviesById = new Map(movies.map((movie) => [movie.id, movie]))
  const hero = heroIds
    .map((id) => moviesById.get(id))
    .filter((movie): movie is Title => Boolean(movie))
  reserveTitles(usage, hero)
  // The horror carousel is its own line-up, so it is reserved before the rotating
  // rails fill up: the same poster must not appear twice down the page.
  const horror = pickHorrorTitles(movies)
  reserveTitles(usage, horror)
  // The Action and Drama bands are curated line-ups too, so they are reserved
  // before the rotating rails fill up: no poster should appear twice.
  // A band is a wall of posters, so it only draws from titles that have one.
  const bandPool = movies.filter((movie) => movie.hasArtwork)
  // Three spare titles let a band drop a broken poster and still show 24.
  const action = pickBandTitles(bandPool, BANDS.action, 27)
  reserveTitles(usage, action)
  const drama = pickBandTitles(bandPool, BANDS.drama, 27)
  reserveTitles(usage, drama)
  const topTen = take(movies, 'top-ten', TOP_TEN_COUNT)
  const brands = BRAND_RAIL_ORDER.map((brand) => {
    const titles = take(
      brand === 'imdb' ? imdbPool : movies.filter((movie) => movie.provider === brand),
      `provider-${brand}`,
      RAIL_LIMIT,
    )
    return { brand, titles }
  })
  // Curated rails for the panel's kids and anime sections, shaped like the
  // provider rails: wordmark card first, then this week's titles.
  const kids = take(collectionTitles(movies, 'kids'), 'kids', RAIL_LIMIT)
  const anime = take(collectionTitles(movies, 'anime'), 'anime', RAIL_LIMIT)
  const blockbusters = take(
    movies.filter((movie) => movie.blockbuster),
    'blockbusters',
    RAIL_LIMIT,
  )
  const fresh = selectUniqueNewTitles(recentMovies, trendingMovies, weekIndex, RAIL_LIMIT, usage)
  const popularRail = take(popularPool, 'popular', RAIL_LIMIT)

  const rows: HomeRows = {
    hero,
    topTen,
    brands,
    horror,
    action,
    drama,
    kids,
    anime,
    blockbusters,
    fresh,
    popular: popularRail,
  }

  byWeek.set(cacheKey, rows)
  return rows
}

export default function HomePage() {
  const navigate = useNavigate()
  const snapshot = useCatalog((s) => s.snapshot)
  const status = useCatalog((s) => s.status)
  const error = useCatalog((s) => s.error)
  const refresh = useCatalog((s) => s.refresh)
  const catalogProgress = useCatalog((s) => s.progress)
  const toggleList = useLibrary((s) => s.toggleList)
  const progress = useLibrary((s) => s.progress)
  const [heroIndex, setHeroIndex] = useState(0)
  const [weekIndex, setWeekIndex] = useState(() => utcWeekIndex(new Date()))
  const [rotationIndex, setRotationIndex] = useState(() => utcRotationIndex(new Date()))
  const [editorOpen, setEditorOpen] = useState(false)
  const shortcutItems = useShortcuts((s) => s.items)
  const setShortcutItems = useShortcuts((s) => s.setItems)
  const resetShortcuts = useShortcuts((s) => s.reset)
  const pull = usePullToRefresh(refresh)
  // A television gets the ten-foot layout: icon rail, hero with a shortlist.
  const isTV = useMemo(() => detectFormFactor() === 'tv', [])

  // Every rail rolls forward one page per UTC week, so the whole page keeps
  // surfacing new artwork-backed movies instead of freezing on one slice.
  useEffect(() => {
    return scheduleNextUtcWeekUpdate(() => setWeekIndex(utcWeekIndex(new Date())), Date.now())
  }, [weekIndex])

  // The hero swaps its Blockbusters line-up every hour, on the hour.
  useEffect(() => {
    return scheduleNextRotationUpdate(() => setRotationIndex(utcRotationIndex(new Date())), Date.now())
  }, [rotationIndex])

  const movies = useMemo(() => snapshot?.movies ?? [], [snapshot])
  // Hero candidates: the Blockbusters set and nothing else.
  const heroPool = useMemo(() => heroCandidatePool(movies), [movies])
  const heroShown = useHeroHistory((state) => state.shown)
  const recordHero = useHeroHistory((state) => state.record)
  const restartHero = useHeroHistory((state) => state.restart)
  const heroPicks = useMemo(
    () => selectHeroRotation(heroPool, heroShown, rotationIndex),
    [heroPool, heroShown, rotationIndex],
  )
  const heroIds = useMemo(() => heroPicks.map((movie) => movie.id), [heroPicks])

  // Remember this rotation's line-up so none of its movies returns in a later
  // one; an exhausted pool starts a fresh cycle instead of an empty hero.
  useEffect(() => {
    if (!heroIds.length) {
      if (heroPool.length) restartHero(rotationIndex)
      return
    }
    recordHero(rotationIndex, heroIds)
  }, [heroIds, heroPool.length, rotationIndex, recordHero, restartHero])

  const rows = useMemo(
    () => computeHomeRows(movies, weekIndex, rotationIndex, heroIds),
    [movies, weekIndex, rotationIndex, heroIds],
  )
  // Live music channels, cached per catalogue so back navigation stays instant.
  const music = useMemo(() => (snapshot ? musicChannelTitles(snapshot.channels) : []), [snapshot])
  // Arabic broadcasters for the closing grid; one card per brand, logos first.
  const arabicChannels = useMemo(
    () => (snapshot ? arabicChannelFamilies(snapshot.channels) : []),
    [snapshot],
  )

  const heroSlides = rows.hero
  const hero = heroSlides[heroIndex % Math.max(heroSlides.length, 1)]
  const heroInList = useLibrary((s) =>
    hero ? s.isInList(hero.kind === 'live' ? 'live' : hero.kind, hero.id) : false,
  )

  const liveCategories = useMemo(
    () => categoriesWithCounts(snapshot, 'live').filter((entry) => entry.id !== 'all'),
    [snapshot],
  )
  const effectiveShortcuts = useMemo(
    () => shortcutItems ?? defaultShortcutItems(snapshot),
    [shortcutItems, snapshot],
  )
  const shortcuts = useMemo(
    () => resolveShortcuts(snapshot, effectiveShortcuts, liveCategories),
    [snapshot, effectiveShortcuts, liveCategories],
  )
  const continueEntries = useMemo(() => continueWatching(), [progress])

  if (!snapshot) {
    // First sign-in paints the home page's own skeleton immediately — the bare
    // "loading your library" line made the shell look empty.
    if (status !== 'error') return <PageSkeleton />
    return (
      <div className="shell-x pb-24 pt-28">
        <EmptyState
          icon="alert"
          title="Could not load your library"
          body={error ?? 'Check your session and try syncing your catalog again.'}
          action={
            <button className="btn btn-primary" onClick={() => void refresh()} data-nav="true">
              <Icon name="refresh" size={16} /> Retry sync
            </button>
          }
        />
      </div>
    )
  }

  if (!hero) {
    // The live section is published before the 57k-title pull finishes, so a
    // cold load briefly has channels but no hero. Keep the skeleton instead of
    // claiming the catalog has nothing to feature.
    if (status !== 'error' && catalogProgress < 100) return <PageSkeleton />
    return (
      <div className="shell-x pb-24 pt-28">
        <EmptyState
          icon="film"
          title="No featured titles available"
          body="Your catalog loaded, but it does not contain titles with artwork to feature."
          action={
            <button className="btn btn-primary" onClick={() => void refresh()} data-nav="true">
              <Icon name="refresh" size={16} /> Refresh catalog
            </button>
          }
        />
      </div>
    )
  }

  return (
    <HideDatesContext.Provider value={true}>
      <HideCaptionsContext.Provider value={true}>
      <div className={isTV ? 'pb-24' : '-mt-16 pb-24'} {...pull.handlers}>
        {pull.pull > 4 || pull.refreshing ? (
          <div
            className="fixed left-1/2 top-20 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full border border-stroke bg-layer-1/95 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft shadow-xl backdrop-blur"
            style={{ transform: `translate(-50%, ${Math.min(40, pull.pull)}px)` }}
          >
            <span
              className={`h-3.5 w-3.5 rounded-full border-2 border-white/25 border-t-crimson ${pull.refreshing ? 'animate-spin' : ''}`}
              style={{ transform: pull.refreshing ? undefined : `rotate(${pull.pull * 4}deg)` }}
            />
            {pull.refreshing ? 'Refreshing catalog' : pull.pull > 72 ? 'Release to refresh' : 'Pull to refresh'}
          </div>
        ) : null}

        {isTV ? (
          <TvHero
            title={hero}
            picks={rows.blockbusters.slice(0, 4)}
            onPlay={() =>
              navigate(`/watch/${hero.kind}/${hero.id}${hero.kind === 'series' ? '?season=1&episode=1' : ''}`)
            }
            inList={heroInList}
            onToggleList={() => toggleList(hero)}
            slideCount={heroSlides.length}
            slideIndex={heroIndex % heroSlides.length}
            onSlideChange={setHeroIndex}
          />
        ) : (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-4 lg:pr-4">
          <Hero
            title={hero}
            onPlay={() =>
              navigate(`/watch/${hero.kind}/${hero.id}${hero.kind === 'series' ? '?season=1&episode=1' : ''}`)
            }
            inList={heroInList}
            onToggleList={() => toggleList(hero)}
            slideCount={heroSlides.length}
            slideIndex={heroIndex % heroSlides.length}
            onSlideChange={setHeroIndex}
          />

          <aside className="hidden lg:sticky lg:top-24 lg:mt-28 lg:block">
            <div className="mb-2 flex items-center justify-between gap-2 px-1">
              <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-ink-soft">
                Shortcut channels
              </p>
              <button
                className="flex h-6 items-center gap-1 rounded-[3px] border border-stroke px-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-soft transition-colors hover:text-white"
                onClick={() => setEditorOpen(true)}
                data-nav="true"
                aria-label="Edit shortcut channels"
              >
                <Icon name="settings" size={11} /> Edit
              </button>
            </div>
            <div className="space-y-2">
              {shortcuts.map((entry) =>
                entry.channel ? (
                  <ChannelCard
                    key={entry.key}
                    channel={entry.channel}
                    view="list"
                    displayName={entry.label}
                    compact
                  />
                ) : (
                  <CollectionCard
                    key={entry.key}
                    kind={entry.item.type === 'collection' ? entry.item.slug : 'category'}
                    label={entry.label}
                    href={entry.href ?? '/'}
                    view="list"
                  />
                ),
              )}
              {!shortcuts.length ? (
                <button
                  className="w-full rounded-[4px] border border-dashed border-stroke px-2 py-3 text-[11px] text-ink-mute hover:text-white"
                  onClick={() => setEditorOpen(true)}
                  data-nav="true"
                >
                  Add shortcut channels
                </button>
              ) : null}
            </div>
          </aside>
        </div>
        )}

        <div className={`shell-x relative z-20 space-y-8 md:space-y-10 ${isTV ? 'pt-8' : '-mt-10'}`}>
          <div className={isTV ? '' : 'lg:hidden'}>
            <ShortcutChannelRail entries={shortcuts} onEdit={() => setEditorOpen(true)} />
          </div>

          <ContinueRail entries={continueEntries} title="Continue Watching" arrows={false} />

          {rows.topTen.length ? <TopTenRail titles={rows.topTen} arrows={false} /> : null}

          {/* Brand, Kids and Anime rows are labelled by their logo card, so they
              carry no heading of their own. */}
          {rows.brands.map(({ brand, titles }, index) => (
            <Fragment key={brand}>
              {titles.length ? (
                <PosterRail
                  titles={titles}
                  lead={<ProviderLogoCard provider={brand} />}
                  arrows={false}
                  minItems={PROVIDER_MIN_ITEMS}
                />
              ) : null}
              {/* The page's only Horror section, right after Netflix and Prime Video. */}
              {index === 1 && rows.horror.length ? <HorrorBand titles={rows.horror} /> : null}
              {/* Action sits between IMDb and WWE, the middle of the brand rows. */}
              {index === 4 && rows.action.length ? (
                <GenreBand
                  label={BANDS.action.label}
                  titles={rows.action}
                  href={`/movies?genre=${encodeURIComponent(BANDS.action.genre)}`}
                  background={BANDS.action.background}
                  accent={BANDS.action.accent}
                />
              ) : null}
            </Fragment>
          ))}

          {rows.kids.length ? (
            <PosterRail titles={rows.kids} lead={<ProviderLogoCard provider="kids" />} arrows={false} />
          ) : null}

          {rows.anime.length ? (
            <PosterRail titles={rows.anime} lead={<ProviderLogoCard provider="anime" />} arrows={false} />
          ) : null}

          {/* Drama closes the curated bands, between Anime and Music. */}
          {rows.drama.length ? (
            <GenreBand
              label={BANDS.drama.label}
              titles={rows.drama}
              href={`/movies?genre=${encodeURIComponent(BANDS.drama.genre)}`}
              background={BANDS.drama.background}
              accent={BANDS.drama.accent}
            />
          ) : null}

          {music.length ? (
            <Rail arrows={false}>
              {music.map((channel) => (
                <ChannelStoryCard key={channel.key} channel={channel} />
              ))}
            </Rail>
          ) : null}

          <PosterRail title="Blockbusters" titles={rows.blockbusters} arrows={false} />
          <PosterRail title="New on Vntera" titles={rows.fresh} arrows={false} />
          <PosterRail title="Popular on Vntera" titles={rows.popular} arrows={false} />

          {arabicChannels.length ? (
            <section aria-label="Arabic channels">
              <SectionHeading title="Arabic channels" meta={`${Math.min(21, arabicChannels.length)} live`} />
              <ChannelLogoGrid families={arabicChannels} />
            </section>
          ) : null}
        </div>

        {editorOpen ? (
          <ShortcutEditor
            items={effectiveShortcuts}
            channels={snapshot.channels}
            categories={liveCategories}
            onChange={setShortcutItems}
            onReset={resetShortcuts}
            onClose={() => setEditorOpen(false)}
          />
        ) : null}
      </div>
      </HideCaptionsContext.Provider>
    </HideDatesContext.Provider>
  )
}
