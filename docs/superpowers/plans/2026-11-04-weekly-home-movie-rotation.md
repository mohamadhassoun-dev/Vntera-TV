# Weekly Home Movie Rotation and Channel Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the four requested live-channel shortcuts beside the Home hero and rotate its artwork-backed movie rails to a stable, new selection each UTC calendar week.

**Architecture:** Add pure helpers for UTC week identity and deterministic movie-window selection, then compose them with existing catalog selectors. Order the four channel shortcuts from a small explicit configuration, render them in a desktop sidebar/mobile follow-on row, and reuse the existing provider SVG cards as the lead item in each matching movie rail. Home schedules a one-shot update at the next UTC week boundary so a page left open also refreshes.

**Tech Stack:** React 19, TypeScript, Zustand, Vite, Vitest, existing Tailwind utility classes and provider SVG assets.

**Spec:** [2026-11-04-weekly-home-movie-rotation-design.md](../specs/2026-11-04-weekly-home-movie-rotation-design.md)

## Global Constraints

- Place a compact "Shortcut channels" column beside the hero on wide screens and directly below the hero on narrow screens.
- Show only Al Jadeed, MTV Lebanon, LBC, and beIN SPORTS LOW 1, in that order. Hide entries the panel does not provide.
- Add Netflix, Prime Video, Shahid, Disney+, and WWE movie rails. Put the project's existing real SVG logo in the first card of each corresponding horizontal movie rail.
- Rotate the Hero, Top 10, provider, Blockbusters, New, and existing Popular movie selections by UTC calendar week.
- Keep Continue Watching personalized and keep the shortcut channels curated; neither participates in movie rotation.
- Include only catalog movies that have actual usable artwork in movie rails. Do not add placeholders.
- Keep the implementation client-side; no backend, external content service, or third-party feed is introduced.
- Each standard horizontal movie rail contains up to 24 movie cards. Top 10 contains 10 cards and the hero retains up to five slides.
- A catalog refresh that adds or removes eligible titles may change that week's selection.
- When Home remains mounted, it automatically recalculates at the next UTC week boundary without requiring a reload.

## File Structure

- `src/lib/homeRotation.ts` (create): UTC week index, deterministic weekly movie selection, and recent-first weekly selection.
- `src/lib/homeRotation.test.ts` (create): pure tests for dates, stable weekly windows, filtering, limits, and full-pool rotation.
- `src/lib/config.ts` (modify): add the beIN SPORTS LOW 1 shortcut and use the exact requested display labels for all four configured channels.
- `src/lib/normalize.ts` and `src/store/catalog.ts` (modify): expose channel matches in configured order with explicit display labels; keep exact-name matching and playback IDs.
- `src/store/catalog.test.ts` (create): selector tests for order, aliases, missing channels, and similarly named non-matches.
- `src/components/cards.tsx` (modify): allow compact channel cards to display the requested shortcut label without changing the underlying channel identity.
- `src/components/Rails.tsx` (modify): add a compact `ShortcutChannelRail`; keep the existing horizontal poster-rail interface and render its existing `lead` before movie cards.
- `src/pages/HomePage.tsx` (modify): assemble all movie candidate pools, key them by rail, track UTC week changes, place shortcuts beside the hero on desktop, and render the requested rail order.

## Review Focus

- A catalog with enough titles must advance by one week even if Home stays mounted, while a timer is cleaned up when Home unmounts; test the boundary scheduler with fake timers in Task 4.
- Duplicate IDs across recent and trending candidates must not appear twice, and the trending bucket must fill only unused slots; test this explicitly in Task 1.
- A channel named “MTV 90s” or “beIN SPORTS” must not match an exact shortcut; test these near-matches in Task 2.
- A provider with no eligible artwork-backed movies must not leave a logo-only rail; cover empty selection in Task 1 and verify the existing `PosterRail` omission and final UI in Tasks 4–5.
- Catalogs containing many series or artwork-less movies must still yield up to 24 eligible movies when enough exist; test filtering before applying each movie-rail limit in Task 3.

---

### Task 1: Add deterministic weekly movie selection

**Files:**
- Create: `src/lib/homeRotation.ts`
- Create: `src/lib/homeRotation.test.ts`

**Interfaces:**
- Produces `utcWeekIndex(date: Date): number`, where weeks begin Monday at 00:00 UTC.
- Produces `selectWeeklyMovieTitles(candidates: readonly Title[], railKey: string, weekIndex: number, limit?: number): Title[]`.
- Produces `selectWeeklyNewTitles(recent: readonly Title[], trending: readonly Title[], weekIndex: number, limit?: number): Title[]`.
- All selectors return distinct artwork-backed movies only; the defaults are 24 movie cards.

- [ ] **Step 1: Add a typed title fixture and tests for eligible filtering and limits**

Create `src/lib/homeRotation.test.ts`. Use the existing `Title` shape from `src/types.ts`.

```ts
import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { selectWeeklyMovieTitles, selectWeeklyNewTitles, utcWeekIndex } from './homeRotation'

function movie(id: number, overrides: Partial<Title> = {}): Title {
  return {
    key: `movie:${id}`,
    kind: 'movie',
    id,
    name: `Movie ${id}`,
    cleanName: `movie ${id}`,
    genres: [],
    cast: [],
    quality: 'HD',
    languages: ['en'],
    editions: [],
    categoryId: 'movies',
    categoryName: 'Movies',
    addedAt: id,
    provider: 'other',
    hasArtwork: true,
    ...overrides,
  }
}

describe('weekly Home movie selection', () => {
  it('filters non-movies, artwork-less movies, and duplicate IDs before applying the limit', () => {
    const result = selectWeeklyMovieTitles(
      [
        movie(1),
        movie(2, { kind: 'series' }),
        movie(3, { kind: 'live' }),
        movie(4, { hasArtwork: false }),
        movie(1, { name: 'Duplicate movie' }),
        movie(5),
        movie(6),
      ],
      'provider-netflix',
      0,
      3,
    )

    expect(result).toHaveLength(3)
    expect(result.every((title) => title.kind === 'movie' && title.hasArtwork)).toBe(true)
    expect(new Set(result.map((title) => title.id)).size).toBe(3)
  })

  it('uses the same order within one week and advances its window in a later week', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => movie(index + 1))
    const first = selectWeeklyMovieTitles(candidates, 'top-ten', 12, 10)

    expect(selectWeeklyMovieTitles(candidates, 'top-ten', 12, 10).map((title) => title.id))
      .toEqual(first.map((title) => title.id))
    expect(selectWeeklyMovieTitles(candidates, 'top-ten', 13, 10).map((title) => title.id))
      .not.toEqual(first.map((title) => title.id))
  })

  it('eventually includes every candidate when a pool is larger than its weekly window', () => {
    const candidates = Array.from({ length: 27 }, (_, index) => movie(index + 1))
    const seen = new Set<number>()

    for (let week = 0; week < candidates.length; week++) {
      for (const title of selectWeeklyMovieTitles(candidates, 'blockbusters', week, 8)) seen.add(title.id)
    }

    expect(seen).toEqual(new Set(candidates.map((title) => title.id)))
  })

  it('keeps recent movies first and fills remaining slots from unique trending movies', () => {
    const result = selectWeeklyNewTitles(
      [movie(1), movie(2)],
      [movie(2), movie(3), movie(4), movie(5)],
      0,
      4,
    )

    expect(result.slice(0, 2).map((title) => title.id)).toEqual([1, 2])
    expect(result).toHaveLength(4)
    expect(new Set(result.map((title) => title.id)).size).toBe(4)
  })

  it('returns all eligible titles for a sparse pool and none for an invalid limit', () => {
    expect(selectWeeklyMovieTitles([movie(1), movie(2)], 'popular', 1, 24)).toHaveLength(2)
    expect(selectWeeklyMovieTitles([movie(1)], 'popular', 1, 0)).toEqual([])
    expect(selectWeeklyMovieTitles([movie(1)], 'popular', 1, Number.POSITIVE_INFINITY)).toEqual([])
    expect(selectWeeklyMovieTitles([], 'provider-netflix', 1)).toEqual([])
  })

  it('uses Monday-based UTC weeks across a year boundary', () => {
    expect(utcWeekIndex(new Date('2026-12-31T23:59:59.999Z')))
      .not.toBe(utcWeekIndex(new Date('2027-01-04T00:00:00.000Z')))
    expect(utcWeekIndex(new Date('2027-01-04T00:00:00.000Z')))
      .toBe(utcWeekIndex(new Date('2027-01-10T23:59:59.999Z')))
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails because the module is missing**

Run: `npm test -- src/lib/homeRotation.test.ts`

Expected: Vitest reports that `./homeRotation` cannot be resolved.

- [ ] **Step 3: Implement week indexing and stable cyclic windows**

Create `src/lib/homeRotation.ts`. Calculate a Monday UTC week index from UTC date fields. For movie ordering, sort by a small deterministic integer hash of `${railKey}:${title.id}`, tie-breaking by numeric ID. Choose the starting offset as a normalized modulo of `weekIndex + hash(railKey)` and take `limit` titles cyclically. This advances one position per UTC week, is stable for the same key/week/catalog, and eventually covers each candidate. Deduplicate IDs and filter kind/artwork before sorting or limiting. For the New selector, use the complete eligible recent bucket first; if that bucket is larger than the requested limit, rotate its window, otherwise retain its order and fill the remaining slots from a separately rotated, deduplicated trending bucket.

```ts
import type { Title } from '../types'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const DEFAULT_HOME_LIMIT = 24

export function utcWeekIndex(date: Date): number {
  const mondayOffset = (date.getUTCDay() + 6) % 7
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - mondayOffset)
  return Math.floor(monday / WEEK_MS)
}

export function selectWeeklyMovieTitles(
  candidates: readonly Title[],
  railKey: string,
  weekIndex: number,
  limit = DEFAULT_HOME_LIMIT,
): Title[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const eligible = uniqueArtworkMovies(candidates)
  const ordered = [...eligible].sort(
    (a, b) => stableHash(`${railKey}:${a.id}`) - stableHash(`${railKey}:${b.id}`) || a.id - b.id,
  )
  return weeklyWindow(ordered, railKey, weekIndex, limit)
}

export function selectWeeklyNewTitles(
  recent: readonly Title[],
  trending: readonly Title[],
  weekIndex: number,
  limit = DEFAULT_HOME_LIMIT,
): Title[] {
  if (!Number.isFinite(limit) || limit <= 0) return []
  const cap = Math.floor(limit)
  const recentTitles = uniqueArtworkMovies(recent)
  const selected = recentTitles.length > cap
    ? selectWeeklyMovieTitles(recentTitles, 'new-recent', weekIndex, cap)
    : recentTitles
  const seen = new Set(selected.map((title) => title.id))
  const trendingTitles = uniqueArtworkMovies(trending).filter((title) => !seen.has(title.id))
  const remaining = cap - selected.length
  if (remaining <= 0) return selected
  const trendingSelection = trendingTitles.length > remaining
    ? selectWeeklyMovieTitles(trendingTitles, 'new-trending', weekIndex, remaining)
    : trendingTitles
  return [...selected, ...trendingSelection]
}

function uniqueArtworkMovies(titles: readonly Title[]): Title[] {
  const seen = new Set<number>()
  return titles.filter((title) => {
    if (title.kind !== 'movie' || !title.hasArtwork || seen.has(title.id)) return false
    seen.add(title.id)
    return true
  })
}

function stableHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function weeklyWindow(titles: readonly Title[], railKey: string, weekIndex: number, limit: number): Title[] {
  if (limit <= 0 || titles.length === 0) return []
  if (titles.length <= limit) return [...titles]
  const offset = ((weekIndex + stableHash(railKey)) % titles.length + titles.length) % titles.length
  const count = Math.min(Math.floor(limit), titles.length)
  return Array.from({ length: count }, (_, index) => titles[(offset + index) % titles.length])
}
```

Also implement `utcWeekIndex` as shown above and import only the `Title` type. `uniqueArtworkMovies` preserves source order for the recent/trending buckets; the generic selector sorts deterministically before taking its cyclic window.

- [ ] **Step 4: Run the focused tests**

Run: `npm test -- src/lib/homeRotation.test.ts`

Expected: all six tests pass, including the full-pool coverage test.

---

### Task 2: Configure and select the exact four shortcut channels

**Files:**
- Modify: `src/lib/config.ts`
- Modify: `src/lib/normalize.ts`
- Modify: `src/store/catalog.ts`
- Create: `src/store/catalog.test.ts`

**Interfaces:**
- Produces `FeaturedChannelShortcut = { channel: Title; label: string }`.
- Updates `featuredChannels(snapshot: CatalogSnapshot | null): FeaturedChannelShortcut[]` to return at most one exact match per configured shortcut, in configuration order.
- Preserves each channel's original `id`, `epgChannelId`, and playable stream identity.

- [ ] **Step 1: Write tests for ordered matches, aliases, missing channels, and near-matches**

Create a minimal `CatalogSnapshot` fixture in `src/store/catalog.test.ts` with four configured channels plus “MTV 90s” and a channel named “beIN SPORTS” without LOW 1. Assert that the selector emits labels and IDs in the configured order, matches an accepted spelling/case alias for each exact channel, omits absent shortcuts, and excludes the near-matches.

```ts
import { describe, expect, it } from 'vitest'
import { featuredChannels } from './catalog'
import type { CatalogSnapshot, Title } from '../types'

function channel(id: number, name: string): Title {
  return {
    key: `live:${id}`,
    kind: 'live',
    id,
    name,
    cleanName: name.toLowerCase(),
    genres: [],
    cast: [],
    quality: 'HD',
    languages: ['ar'],
    editions: [],
    categoryId: 'lebanon',
    categoryName: 'Lebanon',
    addedAt: 0,
    provider: 'other',
    hasArtwork: true,
  }
}

function snapshot(channels: Title[]): CatalogSnapshot {
  return {
    account: 'test',
    builtAt: 0,
    demo: false,
    channels,
    movies: [],
    series: [],
    categories: { live: [], vod: [], series: [] },
    counts: { channels: channels.length, movies: 0, series: 0 },
  }
}

describe('featured Home channel shortcuts', () => {
  it('returns exact configured matches in requested order and excludes similar names', () => {
    const result = featuredChannels(snapshot([
      channel(5, 'MTV 90s'),
      channel(4, 'BEIN Sports Low 1'),
      channel(3, 'lbci'),
      channel(2, 'MTV'),
      channel(1, 'Jadeed'),
      channel(6, 'beIN SPORTS'),
    ]))

    expect(result.map(({ label }) => label)).toEqual([
      'Al Jadeed', 'MTV Lebanon', 'LBC', 'beIN SPORTS LOW 1',
    ])
    expect(result.map(({ channel: item }) => item.id)).toEqual([1, 2, 3, 4])
  })

  it('omits unavailable shortcuts instead of inventing channels', () => {
    const result = featuredChannels(snapshot([channel(8, 'LBC')]))

    expect(result).toEqual([{ channel: expect.objectContaining({ id: 8 }), label: 'LBC' }])
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npm test -- src/store/catalog.test.ts`

Expected: the tests fail because the current selector returns raw titles and does not provide the four configured labels or ordered exact matches.

- [ ] **Step 3: Add channel shortcut configuration and ordered lookup**

In `src/lib/config.ts`, set the four configured labels exactly to `Al Jadeed`, `MTV Lebanon`, `LBC`, and `beIN SPORTS LOW 1`; add a small list of exact normalized aliases for the beIN entry (including `bein sports low 1`). Keep MTV aliases exact so “MTV 90s” cannot match.

In `src/lib/normalize.ts`, add an exported `featuredChannelLabel(title: Title): string | undefined` that matches the normalized full `name` or `cleanName` against configured aliases, returning the configured label. Keep the comparison exact after trim/lowercase normalization.

In `src/store/catalog.ts`, change `featuredChannels` to walk the configured shortcut entries in their defined order, find the first matching catalog channel for each, and return `{ channel, label }` entries. Omit absent entries and do not rewrite the title/channel object.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- src/store/catalog.test.ts`

Expected: both tests pass and shortcut channel IDs stay attached to their configured display names.

---

### Task 3: Add compact shortcut cards and in-rail provider logos

**Files:**
- Modify: `src/components/cards.tsx`
- Modify: `src/components/Rails.tsx`

**Interfaces:**
- Produces `ShortcutChannelRail({ channels }: { channels: FeaturedChannelShortcut[] })`.
- Extends `ChannelCard` with optional `displayName?: string`; playback links and EPG still use the original `Title`.
- Uses `PosterRail`'s existing `lead` prop to put `ProviderLogoCard` before movie cards.

- [ ] **Step 1: Add display-label support to compact channel cards**

In `src/components/cards.tsx`, add optional `displayName` to `ChannelCard` and render it instead of `channel.name` only in the list view. Do not change `to={`/watch/live/${channel.id}`}`, EPG lookups, or the default grid/list label when no override is passed.

- [ ] **Step 2: Implement the shortcut rail using the existing channel-card behavior**

In `src/components/Rails.tsx`, add `ShortcutChannelRail`. Render nothing for an empty list. Otherwise render a titled `Rail` with compact `ChannelCard` list cards using the explicit label and original channel; retain keyboard-accessible channel links and existing EPG behavior.

- [ ] **Step 3: Verify component types and production compilation**

Run: `npm run typecheck`

Expected: the new rail and `ChannelCard` optional label compile without changing existing `ChannelRail` call sites.

---

### Task 4: Rotate Home rails weekly and arrange the hero/sidebar

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Modify: `src/lib/homeRotation.ts`
- Modify: `src/lib/homeRotation.test.ts`

**Interfaces:**
- Home uses `utcWeekIndex(new Date())` and the selectors from Task 1 for every movie rail.
- Home's one-shot week-boundary scheduler returns a cleanup function and is independently testable without mounting the page.
- Each provider logo is the `lead` prop of its matching `PosterRail`; it is not rendered as a separate rail.

- [ ] **Step 1: Add boundary-scheduler tests using Vitest fake timers**

Export `scheduleNextUtcWeekUpdate(onBoundary: () => void, now: number): () => void`. Add tests that advance fake time to one millisecond before the next Monday UTC boundary (no call), advance one more millisecond (exactly one call), and call cleanup before the boundary (no call). Include Sunday-to-Monday and year-boundary cases.

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scheduleNextUtcWeekUpdate } from './homeRotation'

describe('scheduleNextUtcWeekUpdate', () => {
  afterEach(() => vi.useRealTimers())

  it('fires at the next Monday 00:00 UTC and can be cancelled', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-11-08T23:59:59.999Z')
    vi.setSystemTime(now)
    const onBoundary = vi.fn()
    const cleanup = scheduleNextUtcWeekUpdate(onBoundary, now)

    vi.advanceTimersByTime(0)
    expect(onBoundary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onBoundary).toHaveBeenCalledTimes(1)
    cleanup()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels the pending boundary update when cleaned up early', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-12-31T12:00:00.000Z')
    vi.setSystemTime(now)
    const onBoundary = vi.fn()
    const cleanup = scheduleNextUtcWeekUpdate(onBoundary, now)

    cleanup()
    vi.runOnlyPendingTimers()
    expect(onBoundary).not.toHaveBeenCalled()
  })

  it('schedules the first Monday of the new year when the current date is in December', () => {
    vi.useFakeTimers()
    const now = Date.parse('2026-12-31T23:59:59.999Z')
    vi.setSystemTime(now)
    const onBoundary = vi.fn()
    const cleanup = scheduleNextUtcWeekUpdate(onBoundary, now)

    vi.advanceTimersByTime(3 * 24 * 60 * 60 * 1000)
    expect(onBoundary).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onBoundary).toHaveBeenCalledTimes(1)
    cleanup()
  })
})
```

- [ ] **Step 2: Run the focused scheduler test and verify it fails**

Run: `npm test -- src/lib/homeRotation.test.ts`

Expected: Vitest reports that `scheduleNextUtcWeekUpdate` is not exported.

- [ ] **Step 3: Implement the one-shot Monday UTC scheduler**

Compute the next Monday 00:00 UTC after `now` (including seven days later when `now` is already Monday 00:00 UTC), schedule one timeout for the positive millisecond difference, and return a cleanup function that clears that exact timer. The Home effect will re-render at the boundary, derive the new week index, then schedule its next boundary. Do not use a recurring interval.

- [ ] **Step 4: Integrate all candidate pools into Home**

In `src/pages/HomePage.tsx`, keep the current week index in state. Build complete recent and trending candidate lists from `snapshot.movies` (recent means `addedAt >= Date.now() / 1000 - 7 * 86_400`; trending keeps the existing added-date/rating score), interleave those artwork-backed movies as the current hero does, then select at most five through the weekly helper with the key `hero`.

Build these movie-only candidate lists from `snapshot.movies`, filtering `kind === 'movie'` and `hasArtwork` before limiting:

1. `Top 10 on Vntera Today`: all catalog movies, weekly selection key `top-ten`, limit 10.
2. Netflix, Prime Video, Shahid, Disney+, WWE: `title.provider === provider`, each weekly key `provider-${provider}`, limit 24.
3. `Blockbusters`: `title.blockbuster === true`, key `blockbusters`, limit 24.
4. `New on Vntera`: build the complete recent bucket by filtering `snapshot.movies` to `addedAt >= Date.now() / 1000 - 7 * 86_400` and sorting descending by `addedAt`; build the complete trending movie bucket from movies with `addedAt > 0`, sorted by the existing `addedAt * 0.6 + (rating ?? 0) * 1000` score descending; use `selectWeeklyNewTitles` with limit 24.
5. `Popular on Vntera`: sort all `snapshot.movies` by `watchCount` descending, then `rating` descending (matching the existing catalog selector's ordering), filter to artwork-backed movies, and select the weekly window with key `popular` and limit 24.

Render the rails in this order after Continue Watching: Top 10, Netflix, Prime Video, Shahid, Disney+, WWE, Blockbusters, New, Popular. Each provider `PosterRail` receives `lead={<ProviderLogoCard provider={provider} />}` and is omitted when its selected movie list is empty. Render Top 10 with its 10-title selection and do not pass `minItems={10}`, so a sparse catalog displays its available eligible movies instead of hiding the row. Continue Watching remains unchanged and is not passed through a rotation selector.

- [ ] **Step 5: Schedule week changes while Home is mounted**

Add `const [weekIndex, setWeekIndex] = useState(() => utcWeekIndex(new Date()))`. Add an effect dependent on `weekIndex` that calls `scheduleNextUtcWeekUpdate(() => setWeekIndex(utcWeekIndex(new Date())), Date.now())` and returns its cleanup function. This seed uses the current week on mount, and each Monday state update schedules the following boundary. Keep each rail's memo dependencies on `snapshot` and `weekIndex`, so catalog refreshes recompute selections without moving the week.

- [ ] **Step 6: Place shortcut channels beside the hero on wide screens**

Wrap the hero and shortcut component in a responsive grid: a single column on mobile, then `minmax(0, 1fr)` plus a compact fixed-width sidebar at the existing desktop breakpoint. Render `ShortcutChannelRail` after the hero in DOM order so it appears immediately below the hero on mobile; align the sidebar centrally on desktop. Keep the existing movie rail group below this wrapper and preserve Continue Watching above/before movie rails.

- [ ] **Step 7: Run focused unit tests and the production build**

Run: `npm test`

Expected: all helper, scheduler, and shortcut-selector tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build succeed. Existing non-blocking chunk-size or Xtream import warnings may remain.

---

### Task 5: Verify the Home experience at desktop and mobile widths

**Files:**
- No new source files; adjust only the Home layout or selectors if verification reveals a defect.

**Interfaces:**
- Validates the UI assembled in Task 4 with the shared Vntera browser page.

- [ ] **Step 1: Inspect desktop layout**

At a viewport at least 1200 px wide, verify that the large movie hero and four-channel shortcut sidebar share the hero row; the sidebar order is Al Jadeed, MTV Lebanon, LBC, beIN SPORTS LOW 1; each channel opens its original live stream.

- [ ] **Step 2: Inspect mobile layout**

At a viewport no wider than 767 px, verify the hero is full width and the four shortcut cards appear immediately beneath it before Continue Watching and movie rails.

- [ ] **Step 3: Inspect movie rails and logo cards**

Verify provider logos appear as the first card inside each corresponding Netflix, Prime Video, Shahid, Disney+, and WWE movie row. Confirm no logo-only row appears when there is no eligible matching movie. Confirm every visible movie in Top 10, provider, Blockbusters, New, and Popular rows has artwork and is a movie.

- [ ] **Step 4: Verify weekly updates on an already mounted Home page**

Use the browser test tooling to fix `Date` to a Sunday immediately before a UTC Monday boundary, mount Home, and record a rail's movie IDs. Advance the controlled timer to the boundary without navigating away and verify the weekly selection changes. Then navigate away, set the clock to a later week, return to Home, and verify it initializes directly to that week's selection. The unit test in Task 4 separately verifies timer cleanup.

- [ ] **Step 5: Re-run the final checks**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: production build succeeds.

---

## Self-Review

- **Spec coverage:** Tasks 1 and 4 cover stable weekly selection, UTC rollover, artwork filtering, deduplication, 24/10 card limits, all requested movie pools, and refreshes while Home is mounted. Task 2 covers the exact four-channel allowlist, labels, order, and absent/near-match behavior. Task 3 covers in-row provider logos and channel playback identity. Task 5 covers responsive layout and browser behavior. Continue Watching is explicitly preserved in Task 4.
- **Placeholder scan:** Code excerpts contain no TODO, TBD, or placeholder return. The steps specify the exact candidate pools, types, schedule behavior, and test commands.
- **Type consistency:** The shortcut selector returns `{ channel: Title; label: string }[]`, consumed by `ShortcutChannelRail`; weekly selectors receive `Title[]`, rail key, week index, and limit exactly as defined in Task 1 and consumed by Task 4.
- **Review Focus coverage:** Boundary cleanup is tested in Task 4; recent/trending deduplication is tested in Task 1; channel near-matches are tested in Task 2; logo-only rails are checked in Task 4 and Task 5; filtering before limits is tested in Task 1 and verified for catalog rail selection in Task 4.
- **Repository note:** This workspace is not a Git repository, so the plan does not include commit steps.
