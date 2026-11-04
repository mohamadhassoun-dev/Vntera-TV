# In-App Notifications and Home Movie Rails Implementation Plan

> **For agentic workers:** Follow the reviewed design in the linked spec. Use the `executing-plans` skill if the user chooses the Native execution approach.

**Goal:** Keep alerts app-local, preserve multi-title Continue Watching and its 30% reminder, and fill the home page's recent-movie rail with eligible trending movies when needed.

**Architecture:** Extract a small typed selector for artwork-backed movie rails, then use it to combine recent and trending movies without duplicates. Keep existing catalog, EPG, and progress notification logic; update the profile setting so it accurately describes in-app delivery and never asks for browser push permission.

**Tech Stack:** React 19, TypeScript, Vite, Zustand, Vitest.

**Spec:** [2026-11-04-in-app-notifications-and-home-movie-rails-design.md](../specs/2026-11-04-in-app-notifications-and-home-movie-rails-design.md)

## Global Constraints

- Keep notifications entirely inside Vntera and make the home movie sections show a useful set of titles when enough artwork-backed catalog entries exist.
- Keep football notifications sourced only from the provider's EPG.
- Keep the existing fun reminder when a movie or episode crosses 30% watched.
- Keep multiple unfinished movies and series in Continue Watching.
- Fill the home page's recent-movie rail with unique, artwork-backed trending movies when fewer than five recent movies are available.
- Keep hero slides restricted to artwork-backed new and trending movies, with no live channels or series.
- Describe the notification setting as in-app notifications and do not request browser notification permission.
- No backend, scheduled worker, Web Push, Firebase, Cloudflare D1, or notifications when Vntera is closed.
- No external football fixture source; alerts require football programme data in the provider's EPG.
- Do not manufacture Continue Watching entries for titles without saved playback progress.

## Review Focus

- A title present in both recent and trending results must appear only once; Task 1 tests duplicate IDs.
- A catalog with zero or fewer than five eligible movies must return only the available titles, with no placeholders; Task 1 tests empty and short inputs.
- Series, live channels, and movies without artwork must not enter the home movie rail; Task 1 tests each invalid candidate type.
- A sparse recent list should be filled from trending in the existing order, while recent titles retain precedence; Task 1 tests ordering and the five-title cap.
- Disabling in-app notifications or encountering a browser permission state must never cause a permission prompt; Task 3 removes the request call and Task 4 verifies the profile toggle behavior.

---

### Task 1: Create a tested home movie selection helper

**Files:**
- Create: `src/lib/homeTitles.ts`
- Create: `src/lib/homeTitles.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `Title` from `src/types.ts`.
- Produces: `selectHomeMovieTitles(recent: readonly Title[], trending: readonly Title[], limit?: number): Title[]`.

- [ ] **Step 1: Add Vitest and the test script**

Add Vitest to `devDependencies` using the package manager and add this script to `package.json`:

```json
"test": "vitest run"
```

Use the existing Vite configuration; the tests are pure TypeScript and do not need a browser environment.

- [ ] **Step 2: Write tests for source priority, deduplication, and the limit**

Create `src/lib/homeTitles.test.ts` with a typed fixture and these cases:

```ts
import { describe, expect, it } from 'vitest'
import type { Title } from '../types'
import { selectHomeMovieTitles } from './homeTitles'

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
    provider: 'shahid',
    hasArtwork: true,
    ...overrides,
  }
}

describe('selectHomeMovieTitles', () => {
  it('keeps recent titles first, appends unique trending titles, and caps at five', () => {
    const result = selectHomeMovieTitles(
      [movie(1), movie(2)],
      [movie(2), movie(3), movie(4), movie(5), movie(6)],
    )

    expect(result.map((title) => title.id)).toEqual([1, 2, 3, 4, 5])
  })

  it('filters out non-movies and titles without artwork', () => {
    const result = selectHomeMovieTitles(
      [
        movie(1),
        movie(2, { kind: 'series' }),
        movie(3, { kind: 'live' }),
        movie(4, { hasArtwork: false }),
      ],
      [movie(5)],
    )

    expect(result.map((title) => title.id)).toEqual([1, 5])
  })

  it('returns all eligible titles when fewer than five exist, and none when empty', () => {
    expect(selectHomeMovieTitles([movie(1)], [movie(2)]).map((title) => title.id)).toEqual([1, 2])
    expect(selectHomeMovieTitles([], [])).toEqual([])
  })
})
```

- [ ] **Step 3: Run the focused test and confirm it fails**

Run: `npm test -- src/lib/homeTitles.test.ts`

Expected: the test command runs and fails because `src/lib/homeTitles.ts` has not been created.

- [ ] **Step 4: Implement the selector**

Create `src/lib/homeTitles.ts`:

```ts
import type { Title } from '../types'

export function selectHomeMovieTitles(
  recent: readonly Title[],
  trending: readonly Title[],
  limit = 5,
): Title[] {
  if (limit <= 0) return []

  const selected: Title[] = []
  const seen = new Set<number>()

  for (const title of [...recent, ...trending]) {
    if (title.kind !== 'movie' || !title.hasArtwork || seen.has(title.id)) continue
    selected.push(title)
    seen.add(title.id)
    if (selected.length === limit) break
  }

  return selected
}
```

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm test -- src/lib/homeTitles.test.ts`

Expected: all three tests pass.

### Task 2: Fill the home recent-movie rail from trending

**Files:**
- Modify: `src/pages/HomePage.tsx`

**Interfaces:**
- Consumes: `selectHomeMovieTitles` from `src/lib/homeTitles.ts`; existing `recentlyAdded`, `trending`, and catalog snapshot selectors.
- Produces: a maximum-five `newTitles` list for the existing "New on Vntera" rail. Hero selection, Continue Watching, Popular, and Top Ten remain unchanged.

- [ ] **Step 1: Use the selector for the recent-movie rail**

Import `selectHomeMovieTitles` and change `newTitles` to:

```ts
const newTitles = useMemo(
  () => selectHomeMovieTitles(recentlyAdded(snapshot, 7), trending(snapshot)),
  [snapshot],
)
```

Keep the existing `<PosterRail title="New on Vntera" ... />` rendering. The selector makes the rail movie-only, preserves recent-first ordering, fills from trending, and removes duplicate movies.

- [ ] **Step 2: Run the focused selector tests and the production build**

Run: `npm test -- src/lib/homeTitles.test.ts`

Expected: all selector tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build succeed.

### Task 3: Make notification preferences explicitly app-local

**Files:**
- Modify: `src/pages/ProfilePage.tsx`

**Interfaces:**
- Consumes: existing `notifications` and `epgAlerts` settings.
- Produces: a profile switch that toggles the in-app notifications setting without requesting browser permission.

- [ ] **Step 1: Remove the browser permission request**

Delete the `requestNotifications` function and wire the existing switch directly to the setting:

```tsx
<Switch
  checked={settings.notifications}
  onChange={(enabled) => setSetting({ notifications: enabled })}
  label="In-app notifications"
/>
```

Rename the setting row to `In-app notifications` and describe that it controls catalog, progress, and live-football alerts in Vntera. Keep the separate EPG alert switch and preserve its current behavior.

- [ ] **Step 2: Verify no browser permission request remains**

Search `src/pages/ProfilePage.tsx` for `Notification.requestPermission` and `requestNotifications`.

Expected: no matches.

- [ ] **Step 3: Run the production build**

Run: `npm run build`

Expected: TypeScript and Vite production build succeed.

### Task 4: Verify app-local flows and regressions

**Files:**
- No additional source files.

**Interfaces:**
- Consumes: the selector, HomePage rail integration, and ProfilePage setting from Tasks 1–3.
- Produces: verified build and manual smoke-test results for the existing notification and playback flows.

- [ ] **Step 1: Verify browser permission is not requested**

Open the profile page in the development app, toggle In-app notifications off and on, and confirm no browser permission prompt appears.

Expected: the in-app setting changes and no browser permission dialog appears.

- [ ] **Step 2: Verify Continue Watching keeps multiple real entries**

With the app in a signed-in development session, save progress for two distinct movie IDs using the exposed dev store. Save the original state first and restore it after the check so the QA entries do not remain in the profile:

```js
const library = window.__vntera.useLibrary
const before = library.getState()
try {
 library.getState().saveProgress({
   contentId: 900001,
   contentType: 'movie',
   title: 'QA Movie One',
   progress: 40,
   duration: 100,
 })
 library.getState().saveProgress({
   contentId: 900002,
   contentType: 'movie',
   title: 'QA Movie Two',
   progress: 50,
   duration: 100,
 })
 const { continueWatching } = await import('/src/store/library.ts')
 console.log(continueWatching().map((entry) => entry.title))
} finally {
 library.setState({
   progress: before.progress,
   reminded: before.reminded,
   notifications: before.notifications,
 })
}
```

Expected: both titles appear in Continue Watching, newest first; no entry is created without saved progress.

- [ ] **Step 3: Verify the existing 30% in-app reminder**

Save progress for a fresh test movie at 31%, check that a fun reminder was added exactly once, then restore the original state:

```js
const library = window.__vntera.useLibrary
const before = library.getState()
try {
  library.getState().saveProgress({
    contentId: 900003,
    contentType: 'movie',
    title: 'QA Reminder Movie',
    progress: 31,
    duration: 100,
  })
  const firstCount = library.getState().notifications.filter((n) => n.title === 'Continue QA Reminder Movie').length
  library.getState().saveProgress({
    contentId: 900003,
    contentType: 'movie',
    title: 'QA Reminder Movie',
    progress: 45,
    duration: 100,
  })
  const secondCount = library.getState().notifications.filter((n) => n.title === 'Continue QA Reminder Movie').length
  console.log({ firstCount, secondCount })
} finally {
  library.setState({
    progress: before.progress,
    reminded: before.reminded,
    notifications: before.notifications,
  })
}
```

Expected: one fun reminder mentioning the movie appears in the in-app notification state; saving later progress for the same movie does not add a duplicate reminder.

- [ ] **Step 4: Run the complete validation commands**

Run: `npm test`

Expected: all tests pass.

Run: `npm run build`

Expected: TypeScript and Vite production build succeed.
