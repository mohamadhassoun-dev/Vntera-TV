# In-App Notifications and Home Movie Rails

## Goal

Keep notifications entirely inside Vntera and make the home movie sections show a useful set of titles when enough artwork-backed catalog entries exist.

## Scope

- Keep catalog addition/removal notifications in the in-app notification centre.
- Keep football notifications sourced only from the provider's EPG.
- Keep the existing fun reminder when a movie or episode crosses 30% watched.
- Keep multiple unfinished movies and series in Continue Watching.
- Fill the home page's recent-movie rail with unique, artwork-backed trending movies when fewer than five recent movies are available.
- Keep hero slides restricted to artwork-backed new and trending movies, with no live channels or series.
- Describe the notification setting as in-app notifications and do not request browser notification permission.

## Explicit non-goals

- No backend, scheduled worker, Web Push, Firebase, Cloudflare D1, or notifications when Vntera is closed.
- No external football fixture source; alerts require football programme data in the provider's EPG.
- No changes to the existing catalog diff policy or 30% reminder wording/threshold unless implementation validation finds a tightly coupled defect.
- Do not manufacture Continue Watching entries for titles without saved playback progress.

## Current implementation

- `src/lib/alerts.ts` compares catalog IDs and creates in-app alerts for additions and removals. It also detects football programmes in EPG data.
- `src/store/library.ts` stores progress by media kind and content ID, returns up to 12 unfinished entries, and adds a fun in-app reminder once a movie or episode reaches 30% and remains below 96%.
- `src/pages/HomePage.tsx` already builds up to five hero slides by interleaving recent and trending artwork-backed movies. Its "New on Vntera" rail currently uses only the last seven days.
- `src/pages/ProfilePage.tsx` labels the setting "Push notifications" and asks for browser permission, although notifications are generated in-app.

## Proposed behavior

### Home movie selections

Use the recent artwork-backed movies for the "New on Vntera" rail. If there are fewer than five, append trending artwork-backed movies not already present, until five are available or the catalog is exhausted. Preserve the existing title ordering within each source and avoid duplicate IDs. If fewer than five eligible movies exist in the catalog, show the available movies without placeholders.

Keep the hero's current new/trending movie selection and five-slide maximum. Do not change the separate Popular and Top Ten rails as part of this work.

### Continue Watching and progress reminders

Preserve the existing account-local progress model and show all qualifying unfinished titles (up to the existing limit of 12). Keep the existing one-time-per-title, 30%-threshold fun reminder in the in-app centre. Do not add a separate in-progress count or badge.

### Notification settings and delivery

Keep catalog, EPG, and progress notifications in the in-app notification centre. Rename the setting to "In-app notifications" and remove browser permission requests because device-level or closed-app delivery is out of scope. The existing notifications-enabled and EPG-alert preferences continue to control their respective alerts.

## Acceptance criteria

1. If at least five eligible new or trending movies with artwork exist, the New on Vntera rail contains five distinct movie titles; if fewer exist, it contains all eligible titles.
2. The hero contains only new or trending movies with artwork and never falls back to a live channel or series.
3. Multiple unfinished movies remain visible in Continue Watching, ordered by most recent playback, without fabricated entries.
4. Crossing 30% playback creates the existing fun in-app reminder once per title; it does not request or require browser notification permission.
5. Catalog additions/removals and football EPG alerts remain in the in-app centre and respect notification settings.
6. No external service, server-side credential storage, or closed-app push path is introduced.

## Validation

- Run the existing production build/typecheck.
- Verify the movie selection behavior for zero, fewer-than-five, and five-or-more eligible titles, including deduplication between recent and trending lists.
- Verify the UI setting no longer requests browser permission and notification center behavior remains app-local.
