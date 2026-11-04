# Vntera

Cinematic IPTV client for live TV, movies and series. One responsive React + TypeScript
codebase that runs on TV (10-foot UI, D-pad spatial navigation), desktop, tablet, mobile
and the web. Ships as an installable PWA and can be wrapped by Electron/Tauri (desktop)
and Capacitor (iOS/Android) without code changes.

Design language: **Cinematic Obsidian** (`cinematic_obsidian/DESIGN.md`), exported from
Google Stitch.

## Quick start

```bash
npm install
npm run dev        # http://127.0.0.1:5173
npm run build      # typecheck + production build in dist/
```

### Panel access (important)

The OTT panel (`http://ontvflix.cc:8080`) speaks plain HTTP and sends no CORS headers,
so a browser cannot call it directly. Vntera always talks to a same-origin `/xtream`
prefix:

- **Dev/preview** — the Vite proxy (`vite.config.ts`) forwards `/xtream/*` to
  `VITE_PANEL_ORIGIN` (defaults to `http://ontvflix.cc:8080`).
- **Production** — run `npm start`, which boots `server.js`: a dependency-free Node
  server that serves `dist/` and reverse-proxies `/xtream/*` to the panel, keeping
  HTTPS pages free of mixed content. Alternatively deploy
  `server/panel-proxy.worker.js` (Cloudflare Worker) or any other reverse proxy.

### Deploying on Node hosting (Hostinger and friends)

Build command `npm run build`, output `dist/`, start command `npm start`, Node 20+.
Runtime environment variables:

| Variable | Example | Purpose |
|---|---|---|
| `PORT` | injected by the host | Port `server.js` listens on |
| `PANEL_ORIGIN` | `http://ontvflix.cc:8080` | Panel the `/xtream` proxy forwards to |
| `ALLOWED_HOSTS` | `ontvflix.cc:8080` | Comma-separated hosts the proxy may reach; nothing else is forwarded |

Optional build-time variables (Vite, baked into the bundle): `VITE_PANEL_ORIGIN` and
`VITE_API_BASE` (default `/xtream`). `GET /healthz` returns the panel origin the server
resolved, which is the quickest way to confirm a deploy picked up its variables.

### Static/shared hosting (Hostinger LiteSpeed, PHP only)

If the site is deployed as static files, `server.js` never runs and `/xtream/*` has no
one to answer it, so sign-in fails with a panel 404. `public/xtream-proxy.php` and
`public/.htaccess` cover that case: Vite copies both into `dist/`, the rewrite sends
`/xtream/*` to the PHP bridge (streams to `PANEL_ORIGIN`, honours `ALLOWED_HOSTS`, drops
panel cookies), and it also supplies the SPA history fallback so deep links work.
Set the same `PANEL_ORIGIN` / `ALLOWED_HOSTS` variables in the site's PHP environment,
then check `GET /healthz` — it reports the origin PHP resolved.

Authentication is username/password only — there is no signup. Without credentials the
app boots into an explicit **Demo catalog** so every screen and playback state can be
reviewed. Sign in with a real subscription to load the provider's true library.

### Credentials at rest

The password is encrypted with AES-GCM via WebCrypto and the key is held in IndexedDB
(non-extractable), so the ciphertext in `localStorage` is useless on its own. Sessions
never expire locally; logout clears them. A background `/player_api.php` probe validates
the session and opens the re-auth sheet if the provider revokes it.

## Architecture

```
src/
  lib/
    xtream.ts        Xtream Codes / OTT panel client (axios + interceptors + retry)
    normalize.ts     dedupe quality/language variants, providers, catalog index
    m3u.ts xmltv.ts  streaming playlist + EPG parsers (run in a worker)
    storage.ts       IndexedDB snapshots, encrypted credentials, local library
    platform.ts      TV/desktop/mobile detection, D-pad spatial navigation
    cast.ts          Chromecast / AirPlay
    demo.ts          deterministic demo catalog
  store/             zustand stores: auth, catalog, library, settings, ui
  components/        player, rails, cards, EPG guide, sheets
  pages/             login, home, live, EPG, movies, series, new, my list,
                     details, watch, search, profile, notifications
```

### Data flow

1. `authenticate()` → `POST player_api.php`, stores `user_info`/`server_info`.
2. Catalog sync pulls categories, live streams, VOD and series in parallel, parses the
   M3U as a fallback source for channels, then normalizes once into an IndexedDB
   snapshot (`catalog:<username>`).
3. Every screen reads the snapshot from the catalog store — search, filters and rows are
   instant and work offline. The snapshot refreshes in the background every 6 hours and
   on pull-to-refresh.
4. EPG is fetched per channel (`get_short_epg`, 10-minute cache) so a 57k-title library
   never blocks on a giant XMLTV file; the full guide is an explicit sync.

## Platform packaging

| Target | How |
| --- | --- |
| Web / PWA | `npm run build`, serve `dist/` |
| Android TV / Fire TV | WebView wrapper (Capacitor Android) + leanback launcher intent; D-pad handled by spatial nav |
| Samsung Tizen | Tizen web app project pointing at `dist/`; register remote keys |
| LG webOS | webOS web app package pointing at `dist/` |
| Apple TV / tvOS | AVPlayer-backed WebView host, or reuse the API layer in a native tvOS target |
| Windows / macOS / Linux | Electron or Tauri window loading `dist/` (native fullscreen + PiP) |
| iOS / Android | Capacitor shell; native ExoPlayer/AVPlayer bridge can replace the `<video>` element in `components/player/VideoEngine.ts` |

`src/lib/platform.ts` detects the container and applies the `tv` form factor (larger
type, 4rem safe margins, D-pad focus rings, back-key handling). Force it with
`?form=tv` for QA.

## Notes

- Multiple quality/language editions of the same title are collapsed into one card; all
  editions remain selectable on the details page.
- Content without artwork is hidden from home rails but still searchable.
- Playback progress is saved every 30 s (and on pause/exit) for resume + Continue
  Watching, synced through the same account-scoped local store.
