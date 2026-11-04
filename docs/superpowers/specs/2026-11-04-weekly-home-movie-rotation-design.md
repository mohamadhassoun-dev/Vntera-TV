# Weekly Home Movie Rotation and Channel Shortcuts

## Goal

Make the Home page's movie rails show a different, stable selection each UTC
calendar week while eventually cycling through eligible catalog movies, even
when the page stays open across the week boundary. Add the requested four
live-channel shortcuts beside the hero without replacing the existing Home page
behavior that should remain personalized.

## Scope

- Place a compact "Shortcut channels" column beside the hero on wide screens and
  directly below the hero on narrow screens.
- Show only Al Jadeed, MTV Lebanon, LBC, and beIN SPORTS LOW 1, in that order.
  Hide entries the panel does not provide.
- Add Netflix, Prime Video, Shahid, Disney+, and WWE movie rails. Put the
  project's existing real SVG logo in the first card of each corresponding
  horizontal movie rail.
- Rotate the Hero, Top 10, provider, Blockbusters, New, and existing Popular
  movie selections by UTC calendar week.
- Keep Continue Watching personalized and keep the shortcut channels curated;
  neither participates in movie rotation.
- Include only catalog movies that have actual usable artwork in movie rails.
  Do not add placeholders.
- Keep the implementation client-side; no backend, external content service,
  or third-party feed is introduced.

## Layout and channel selection

The hero retains its current large height and full movie artwork. On wide
screens, the four channel shortcuts sit in a compact adjacent column; on narrow
screens, they move below the hero. The channel rail is titled "Shortcut
channels." Channel matching remains name-based because panel stream IDs differ
by reseller. Matching is exact after normalization so similarly named channels
are not included accidentally. Display names use the requested labels while
playback continues to use each panel channel's original ID.

The provider SVG logos already present under `public/logos` are rendered as the
first card in each corresponding movie rail, not as a separate row. A provider
rail is hidden when it has no eligible movie, rather than displaying a logo
without content.

## Weekly movie selection

Each movie rail has its own stable ordering derived from the rail identity and
movie ID, then selects a window offset by the current Monday-based UTC calendar
week. This avoids reshuffling on page visits and ensures that when a pool is
larger than its weekly limit, all eligible movies eventually reach the rail.
For an unchanged catalog and week, the selected movies are stable. A catalog
refresh that adds or removes eligible titles may change that week's selection.
When Home remains mounted, it automatically recalculates at the next UTC week
boundary without requiring a reload. Returning to Home after a boundary uses
the current week immediately.

Each standard horizontal movie rail contains up to 24 movie cards. Top 10
contains 10 cards and the hero retains up to five slides. If a candidate pool
contains fewer eligible movies than its limit, every eligible movie is shown.
The limits describe the total cards in each scrollable rail, not the number
simultaneously visible in the viewport.

The candidate pools are:

- **Hero:** new and trending movies, interleaved as today; only artwork-backed
  movies are eligible.
- **Top 10 on Vntera Today:** artwork-backed movies from the catalog, with a
  weekly rotating selection of 10. Per the requested behavior, the row is not a
  live watch-count ranking.
- **Netflix, Prime Video, Shahid, Disney+, WWE:** movies whose normalized
  provider matches the rail, with usable artwork.
- **Blockbusters:** artwork-backed movies already identified by the catalog's
  blockbuster flag.
- **New on Vntera:** movies added in the last seven days first, filled from
  trending movies. Weekly windows rotate within those source-priority buckets;
  artwork-backed movie filtering and ID deduplication apply to both.
- **Popular on Vntera:** retain the existing row and rotate its artwork-backed
  movie pool weekly.

Continue Watching, saved progress, notifications, and the Home page's existing
navigation are unchanged.

## Data flow and implementation boundaries

The Home page derives candidate pools from the existing catalog snapshot and
passes them through a small, pure weekly-selection helper. The helper accepts
the current date/week explicitly so its ordering and rollover can be tested
without timers or network calls. Existing Hero, PosterRail, and
ProviderLogoCard components are reused where possible. Catalog channel
configuration supplies the four shortcut matches and display labels.

No persistent rotation state is needed: the same rail, UTC week, and catalog
produce the same order. Home tracks the current week and schedules a boundary
update, cleaning up its timer when unmounted. No new dependency is required; the
existing Vitest setup covers the selector.

## Edge behavior

- Invalid limits return no titles.
- Duplicate title IDs appear only once in a rail.
- Series, live channels, and movies without usable artwork are excluded from
  movie rails.
- Missing channel matches are omitted; the remaining shortcuts keep their
  requested order.
- Empty movie pools hide their rail, including its provider logo card.
- A changed catalog may affect the current week's selection; subsequent visits
  to the same unchanged catalog remain deterministic.

## Acceptance criteria

1. Wide screens show the four requested shortcuts beside the large hero;
   narrow screens show them immediately after the hero.
2. The shortcut rail contains no channels outside the four-name allowlist and
   uses the requested labels and order when matches are present.
3. Each provider rail places its real logo card first and contains up to 24
   distinct artwork-backed movies matching that provider.
4. Blockbusters and New contain only artwork-backed movies from their defined
   candidate pools; New preserves recent-first ordering before its trending
   fallback.
5. Top 10 contains up to 10 distinct artwork-backed movies and selects a stable
   but different window across weeks when the catalog is large enough.
6. A mounted Home page updates its selections at the UTC week boundary without
   a manual refresh; a newly mounted Home page uses the current week immediately.
7. Each eligible pool eventually cycles through its titles when the pool is
   larger than the rail's weekly limit.
8. Continue Watching remains progress-based and is not modified by rotation.
9. No movie placeholders, backend, or external provider is introduced.
10. Focused tests and the production build pass; browser review confirms the
   requested desktop/mobile placement and in-row provider logos.

## Validation

- Unit tests cover same-week stability, week rollover, coverage across
  successive windows, limits, deduplication, artwork filtering, provider
  filtering, and undersized/empty pools.
- A focused timer test verifies that the mounted Home selection updates on a
  week boundary and cancels its scheduled update when unmounted.
- Run `npm test` and `npm run build`.
- Inspect the Home page at wide and narrow viewport sizes and verify channel
  links, provider logos, and card ordering.
