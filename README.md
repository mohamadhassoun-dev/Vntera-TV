# Vntera TV

Cinematic IPTV client for live TV, movies and series. One React + TypeScript codebase
that runs on the web, Android phones, Android TV (10-foot UI, D-pad spatial navigation)
and Windows, plus tablets and any desktop browser.

Three shippable builds come out of this repository:

| Build | Command | Output |
| --- | --- | --- |
| Website | `npm run build` | `dist/` |
| Android phone | `npm run apk` | `release/vntera-<version>.apk` |
| Android TV | `npm run tv` | `release/vntera-tv-<version>.apk` |
| Windows | `npm run desktop:build` | `release/Vntera-Setup-<version>.exe` |

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

### Android APK (phone and TV)

The phone app is a Capacitor shell around the same bundle, so the website and the
APKs share one codebase. A bundled WebView has no same-origin proxy, so the APKs are
compiled with `VITE_API_BASE` pointing at the deployed bridge
(`http://movies.vntera.com/xtream`); the site build keeps the relative `/xtream`.

```bash
npm run apk                      # phone APK  -> release/vntera-<version>.apk
npm run tv                       # TV APK     -> release/vntera-tv-<version>.apk
npm run apk:all                  # both
npm run apk -- --api-base http://other.host/xtream
```

What the script does: builds the web bundle with that API base, copies it into
`android/` (`cap sync`), runs the matching Gradle task, and drops the signed APK in
`release/`. It prints what the APK reports about itself (package, version, label,
leanback) so a wrong flavor cannot slip past unnoticed.

Two Gradle flavors share the code:

- `phone` — `com.vntera.iptv`, the touch app.
- `tv` — `com.vntera.iptv.tv`, label **Vntera TV**, with the leanback launcher intent,
a 320×180 TV banner, and touchscreen/no-leanback feature flags. The TV bundle is
built with `VITE_FORCE_FORM=tv` because a television WebView sends the same generic
"Linux; Android" user agent as a phone, which no runtime detection can tell apart.

The TV flavor installs alongside the phone app rather than replacing it.

Requirements on the build machine:

- Android SDK with platform 36 and build-tools (pointed at by `android/local.properties`).
- **JDK 21** — Gradle 8.14 / AGP 8.13 do not run on Java 26. The script uses
  `JAVA_HOME`, or a `.tools/jdk-21*` folder next to the project.
- `android/keystore.properties` plus the keystore it names. Both are git-ignored;
  the generated `android/keystore/vntera-release.jks` (alias `vntera`) is the
  upload key — **back it up**, every future update must be signed with it.

App identity: `com.vntera.iptv` (phone) and `com.vntera.iptv.tv` (TV), min SDK 24,
target SDK 36. The manifest allows cleartext traffic because the panel is HTTP.
Launcher icons and the splash screen are generated from `public/icon-512.png`
with `npx capacitor-assets generate --android`; the TV banner and the Windows
installer icon come from `npm run icons`.

### Windows desktop app

The desktop shell is Electron. A packaged app has no browser origin and nothing to
proxy through, so the main process starts the **same origin the website runs** —
`server/app.js` — on a free loopback port and the window loads that. Sign-in,
playback and the `/xtream` bridge therefore behave exactly as on the web.

```bash
npm run desktop          # build the bundle and open the shell
npm run desktop:smoke    # load it headlessly, print what rendered, quit
npm run desktop:build    # NSIS installer in release/ (runs the smoke check too)
```

The shell keeps a single origin (links open in the real browser), remembers window
bounds, and adds a menu with full screen (F11), zoom, reload and navigation. The
installer is built with LZMA maximum compression and only the locales the shell can
use, and it is published as a GitHub release asset: at ~118 MB it exceeds GitHub's
100 MB per-file limit for a repository.

### Publishing a release

```bash
npm run icons        # installer icon + TV banner from the shipped artwork
npm run apk:all      # phone + TV APKs
npm run desktop:build # Windows installer
npm run qr           # QR codes for the install section
npm run artifacts    # writes src/lib/artifacts.json from the files on disk
npm run build        # website bundle, then deploy dist/
```

`src/lib/artifacts.json` is committed so the site shows the real version, size and
download URL of each installer instead of hand-typed values.

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
| Windows | `npm run desktop:build` — Electron shell with its own loopback origin |
| Android | `npm run apk` — Capacitor shell, `com.vntera.iptv` |
| Android TV / Fire TV | `npm run tv` — leanback flavor, `com.vntera.iptv.tv`, D-pad spatial nav |
| Samsung Tizen | Tizen web app project pointing at `dist/`; register remote keys |
| LG webOS | webOS web app package pointing at `dist/` |
| Apple TV / tvOS | AVPlayer-backed WebView host, or reuse the API layer in a native tvOS target |
| macOS / Linux | Electron or Tauri window loading `dist/` (native fullscreen + PiP) |
| iOS | Capacitor shell; native AVPlayer bridge can replace the `<video>` element in `components/player/VideoEngine.ts` |

`src/lib/platform.ts` detects the container and applies the `tv` form factor (larger
type, 4rem safe margins, D-pad focus rings, back-key handling). Force it with
`?form=tv` for QA.

## Security

Nothing secret is committed. The repository contains no panel credentials, no signing
key and no `.env`: `android/keystore.properties`, `android/keystore/`, `.tools/` and
production uploads are all in `.gitignore`. The panel hostname that appears in the
config and the README is public information — the proxy refuses any host that is not
listed in `ALLOWED_HOSTS`. A user's own provider password is typed at sign-in, never
built into a bundle, and is encrypted at rest (see above).

## Notes

- Multiple quality/language editions of the same title are collapsed into one card; all
  editions remain selectable on the details page.
- Content without artwork is hidden from home rails but still searchable.
- Playback progress is saved every 30 s (and on pause/exit) for resume + Continue
  Watching, synced through the same account-scoped local store.
