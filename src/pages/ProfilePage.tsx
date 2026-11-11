import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { useAuth } from '../store/auth'
import { useCatalog } from '../store/catalog'
import { useLibrary } from '../store/library'
import { useSettings } from '../store/settings'
import { useUI } from '../store/ui'
import { expiryLabel, formatRuntime, relativeTime } from '../lib/format'
import { QUALITY_LABELS } from '../lib/config'
import { canCheckStreams } from '../lib/streamHealth'
import { useHealth } from '../store/health'
import type { Settings } from '../types'

/** Plain words for a probe's failure code, so the list reads like a to-do. */
const FAILURE_REASONS: Record<string, string> = {
  timeout: 'Timeout',
  empty: 'No data',
  network: 'No answer',
  html: 'Error page',
  no_episodes: 'No episodes',
  panel_error: 'Panel error',
  panel_busy: 'Panel busy',
  no_stream: 'No stream',
  stopped: 'Stopped',
}

function reasonLabel(reason: string): string {
  if (reason.startsWith('http_')) return reason.slice(5)
  return FAILURE_REASONS[reason] ?? reason
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      data-nav="true"
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${checked ? 'bg-crimson' : 'bg-layer-4'}`}
    >
      <span
        className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 ${
          checked ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  )
}

function SettingRow({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-stroke/60 py-3 last:border-0">
      <div className="min-w-0">
        <p className="text-[13px] font-semibold">{title}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-ink-mute">{hint}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

function Select<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }> }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-w-[7.5rem] cursor-pointer appearance-none rounded-[3px] border border-stroke bg-layer-2 py-1.5 pl-2.5 pr-7 text-[12px] font-semibold"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} className="bg-layer-2">
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={13} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-mute" />
    </div>
  )
}

/** Local date and time, updated once a second. It lives in its own component so
 *  the clock never re-renders the settings around it. */
function LocalClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const tick = () => setNow(new Date())
    const timer = window.setInterval(tick, 1000)
    // Background tabs throttle timers, so catch up as soon as the page is back.
    document.addEventListener('visibilitychange', tick)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [])

  const zone = now.toLocaleTimeString(undefined, { timeZoneName: 'short' }).split(' ').pop()

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-ink-mute">Date &amp; time</p>
      <p className="font-semibold tabular">
        {now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </p>
      <p className="text-[10px] text-ink-mute">
        {now.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
        {zone ? ` · ${zone}` : ''}
      </p>
    </div>
  )
}

export default function ProfilePage() {
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const logout = useAuth((s) => s.logout)
  const refresh = useCatalog((s) => s.refresh)
  const status = useCatalog((s) => s.status)
  const progress = useCatalog((s) => s.progress)
  const phase = useCatalog((s) => s.phase)
  const list = useLibrary((s) => s.list)
  const libraryProgress = useLibrary((s) => s.progress)
  const removeProgress = useLibrary((s) => s.removeProgress)
  const clearHistory = useLibrary((s) => s.clearHistory)
  const exportData = useLibrary((s) => s.exportData)
  const importData = useLibrary((s) => s.importData)
  const settings = useSettings()
  const setSetting = useSettings((s) => s.set)
  const toast = useUI((s) => s.toast)
  const importRef = useRef<HTMLInputElement>(null)

  const healthRunning = useHealth((s) => s.running)
  const healthScope = useHealth((s) => s.scope)
  const healthLimit = useHealth((s) => s.limit)
  const healthTotal = useHealth((s) => s.total)
  const healthDone = useHealth((s) => s.done)
  const healthWorking = useHealth((s) => s.working)
  const healthFailing = useHealth((s) => s.failing)
  const healthPool = useHealth((s) => s.pool)
  const healthCurrent = useHealth((s) => s.current)
  const healthError = useHealth((s) => s.error)
  const healthLastRun = useHealth((s) => s.lastRun)
  const healthFailures = useHealth((s) => s.failures)
  const healthCursor = useHealth((s) => s.cursors[s.scope] ?? 0)
  const startHealth = useHealth((s) => s.start)
  const stopHealth = useHealth((s) => s.stop)
  const clearHealth = useHealth((s) => s.clear)
  const setHealthScope = useHealth((s) => s.setScope)
  const setHealthLimit = useHealth((s) => s.setLimit)
  const hosted = canCheckStreams()

  const history = Object.values(libraryProgress).sort((a, b) => b.lastWatched - a.lastWatched).slice(0, 8)

  const doExport = () => {
    const blob = new Blob([exportData()], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `vntera-profile-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Profile exported', 'success')
  }

  const doImport = async (file: File) => {
    const text = await file.text()
    toast(importData(text) ? 'Profile imported' : 'That file is not a Vntera profile export', importData(text) ? 'success' : 'error')
  }

  return (
    <div className="pb-24 pt-16 md:pt-20">
      <div className="shell-x py-7">
        {/* identity */}
        <div className="flex flex-col gap-5 rounded-lg border border-stroke bg-gradient-to-br from-layer-2 via-layer-1 to-canvas p-5 sm:flex-row sm:items-center">
          <img
            src="/logos/user.jpg"
            alt="Profile"
            width={64}
            height={64}
            className="h-16 w-16 shrink-0 rounded-full border border-stroke object-cover"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-black tracking-tight">Your User Is</h1>
              {session?.username ? (
                <span className="font-mono text-[13px] font-semibold text-ink-soft">{session.username}</span>
              ) : null}
              <span
                className="rounded-[2px] bg-live/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-live"
              >
                {session?.userInfo?.status ?? 'Active'}
              </span>
              {session?.userInfo?.is_trial === '1' || session?.userInfo?.is_trial === 1 ? (
                <span className="rounded-[2px] bg-azure/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-azure-soft">
                  Trial
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {/* stats */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Stat label="My List" value={list.length.toLocaleString()} icon="heart" />
          <Stat label="In progress" value={Object.keys(libraryProgress).length.toLocaleString()} icon="clock" />
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* playback */}
          <section className="panel p-4">
            <h2 className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">
              <Icon name="play" size={13} /> Playback
            </h2>
            <SettingRow title="Preferred quality" hint="Auto follows your connection; a fixed pick overrides it">
              <Select<'auto' | '4K' | 'FHD' | 'HD' | 'SD'>
                value={settings.quality}
                onChange={(v) => setSetting({ quality: v })}
                options={[
                  { value: 'auto', label: 'Auto (ABR)' },
                  { value: '4K', label: QUALITY_LABELS['4K'] },
                  { value: 'FHD', label: QUALITY_LABELS.FHD },
                  { value: 'HD', label: QUALITY_LABELS.HD },
                  { value: 'SD', label: QUALITY_LABELS.SD },
                ]}
              />
            </SettingRow>
            <SettingRow title="Autoplay next episode">
              <Switch checked={settings.autoplayNext} onChange={(v) => setSetting({ autoplayNext: v })} label="Autoplay next" />
            </SettingRow>
            <SettingRow title="Autoplay hero previews">
              <Switch checked={settings.autoplayPreviews} onChange={(v) => setSetting({ autoplayPreviews: v })} label="Autoplay previews" />
            </SettingRow>
            <SettingRow title="Data saver" hint="Caps quality and avoids 4K on metered links">
              <Switch checked={settings.dataSaver} onChange={(v) => setSetting({ dataSaver: v })} label="Data saver" />
            </SettingRow>
            <SettingRow title="Download on Wi-Fi only" hint="Applies to the mobile shell">
              <Switch checked={settings.wifiOnlyDownloads} onChange={(v) => setSetting({ wifiOnlyDownloads: v })} label="Wi-Fi downloads" />
            </SettingRow>
          </section>

          {/* subtitles */}
          <section className="panel p-4">
            <h2 className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">
              <Icon name="subtitles" size={13} /> Subtitles & audio
            </h2>
            <SettingRow title="Subtitles on by default">
              <Switch checked={settings.subtitlesEnabled} onChange={(v) => setSetting({ subtitlesEnabled: v })} label="Subtitles" />
            </SettingRow>
            <SettingRow title="Subtitle language">
              <Select
                value={settings.subtitleLanguage}
                onChange={(v) => setSetting({ subtitleLanguage: v })}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'Arabic' },
                  { value: 'fr', label: 'French' },
                  { value: 'off', label: 'Off' },
                ]}
              />
            </SettingRow>
            <SettingRow title="Audio preference">
              <Select
                value={settings.audioLanguage}
                onChange={(v) => setSetting({ audioLanguage: v })}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'Arabic' },
                  { value: 'fr', label: 'French' },
                ]}
              />
            </SettingRow>
            <SettingRow title="Content language" hint="Filters rails and search results">
              <Select<Settings['contentLanguage']>
                value={settings.contentLanguage}
                onChange={(v) => setSetting({ contentLanguage: v })}
                options={[
                  { value: 'all', label: 'All languages' },
                  { value: 'ar', label: 'Arabic' },
                  { value: 'en', label: 'English' },
                  { value: 'fr', label: 'French' },
                ]}
              />
            </SettingRow>
            <SettingRow title="Reduce motion">
              <Switch checked={settings.reduceMotion} onChange={(v) => setSetting({ reduceMotion: v })} label="Reduce motion" />
            </SettingRow>
          </section>

          {/* notifications + sync */}
          <section className="panel p-4">
            <h2 className="mb-1 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">
              <Icon name="bell" size={13} /> Notifications
            </h2>
            <SettingRow title="In-app notifications" hint="Catalog changes, watch reminders and live football">
              <Switch
                checked={settings.notifications}
                onChange={(enabled) => setSetting({ notifications: enabled })}
                label="In-app notifications"
              />
            </SettingRow>
            <SettingRow title="EPG live alerts" hint="Notify when a followed programme starts">
              <Switch checked={settings.epgAlerts} onChange={(v) => setSetting({ epgAlerts: v })} label="EPG alerts" />
            </SettingRow>
            <SettingRow title="Interface language">
              <Select
                value={settings.uiLanguage}
                onChange={(v) => setSetting({ uiLanguage: v })}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'ar', label: 'العربية' },
                ]}
              />
            </SettingRow>
            <SettingRow title="Cloud sync profile" hint="Export / import My List, progress and preferences">
              <div className="flex gap-1.5">
                <button className="icon-btn !h-8 !w-8" onClick={doExport} aria-label="Export profile" data-nav="true" title="Export profile">
                  <Icon name="download" size={14} />
                </button>
                <button className="icon-btn !h-8 !w-8" onClick={() => importRef.current?.click()} aria-label="Import profile" data-nav="true" title="Import profile">
                  <Icon name="share" size={14} />
                </button>
                <input
                  ref={importRef}
                  type="file"
                  accept="application/json"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) void doImport(file)
                    e.target.value = ''
                  }}
                />
              </div>
            </SettingRow>
            <SettingRow title="Catalog refresh" hint={phase || 'Every 6 hours in the background'}>
              <button
                className="btn btn-ghost !py-1.5 text-[11px]"
                disabled={status === 'loading'}
                onClick={() => void refresh()}
                data-nav="true"
              >
                <Icon name={status === 'loading' ? 'loader' : 'refresh'} size={13} className={status === 'loading' ? 'animate-spin' : ''} />
                {status === 'loading' ? `${progress}%` : 'Refresh'}
              </button>
            </SettingRow>
          </section>

          {/* activity */}
          <section className="panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">
                <Icon name="clock" size={13} /> Viewing activity
              </h2>
              {history.length ? (
                <button
                  className="text-[10px] font-bold uppercase tracking-wider text-crimson hover:text-white"
                  onClick={() => {
                    clearHistory()
                    toast('Watch history cleared')
                  }}
                >
                  Clear history
                </button>
              ) : null}
            </div>
            {history.length ? (
              <ul className="divide-y divide-stroke/60">
                {history.map((h) => (
                  <li key={`${h.contentType}:${h.contentId}`} className="flex items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-semibold">{h.title}</span>
                      <span className="block text-[10px] text-ink-mute">
                        {h.contentType === 'series' ? `S${h.season} E${h.episode} · ` : ''}
                        {formatRuntime(h.progress)} watched · {relativeTime(h.lastWatched)}
                      </span>
                    </span>
                    <button
                      className="icon-btn !h-7 !w-7"
                      onClick={() => removeProgress(h.contentType, h.contentId)}
                      aria-label={`Remove ${h.title} from history`}
                      data-nav="true"
                    >
                      <Icon name="close" size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-[12px] text-ink-mute">Nothing watched yet. Playback progress will appear here.</p>
            )}
          </section>
        </div>

        {/* stream health */}
        <section className="panel mt-4 p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">
              <Icon name="server" size={13} /> Stream health
            </h2>
            <div className="flex items-center gap-1.5">
              {healthRunning ? (
                <button className="btn btn-ghost !py-1.5 text-[11px]" onClick={stopHealth} data-nav="true">
                  <Icon name="close" size={13} /> Stop
                </button>
              ) : (
                <button
                  className="btn btn-primary !py-1.5 text-[11px]"
                  disabled={!hosted}
                  onClick={() => void startHealth()}
                  data-nav="true"
                >
                  <Icon name="refresh" size={13} /> Run check
                </button>
              )}
              {healthFailures.length ? (
                <button
                  className="btn btn-ghost !py-1.5 text-[11px]"
                  onClick={() => {
                    const report = {
                      generatedAt: new Date().toISOString(),
                      checks: healthFailures.map((f) => ({
                        kind: f.kind,
                        id: f.id,
                        name: f.name,
                        problem: f.reason,
                        status: f.status,
                        checkedAt: new Date(f.at).toISOString(),
                      })),
                    }
                    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
                    const a = document.createElement('a')
                    a.href = url
                    a.download = `vntera-stream-health-${new Date().toISOString().slice(0, 10)}.json`
                    a.click()
                    URL.revokeObjectURL(url)
                    toast('Report downloaded', 'success')
                  }}
                  data-nav="true"
                  title="Download the failing titles as JSON"
                >
                  <Icon name="download" size={13} /> Report
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={healthScope}
              onChange={(v) => setHealthScope(v)}
              options={[
                { value: 'live', label: 'Live channels' },
                { value: 'movies', label: 'Movies' },
                { value: 'series', label: 'Series' },
                { value: 'all', label: 'Everything' },
              ]}
            />
            <Select
              value={String(healthLimit)}
              onChange={(v) => setHealthLimit(Number(v))}
              options={[
                { value: '50', label: '50 titles' },
                { value: '100', label: '100 titles' },
                { value: '250', label: '250 titles' },
                { value: '500', label: '500 titles' },
              ]}
            />
            <span className="text-[10px] text-ink-mute">
              {healthPool
                ? `${healthPool.toLocaleString()} in this section · next run continues at #${(healthCursor + 1).toLocaleString()}`
                : 'Plays each title through the same bridge the player uses.'}
            </span>
          </div>

          {healthRunning || healthTotal ? (
            <div className="mt-3">
              <div className="flex items-center justify-between gap-2 text-[11px] text-ink-mute">
                <span className="min-w-0 truncate">
                  {healthRunning
                    ? healthCurrent
                      ? `Checking ${healthCurrent}`
                      : 'Starting…'
                    : `Checked ${healthDone.toLocaleString()} of ${healthTotal.toLocaleString()}`}
                </span>
                <span className="shrink-0 tabular">
                  {healthTotal ? Math.round((healthDone / healthTotal) * 100) : 0}%
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-layer-4">
                <div
                  className="h-full bg-crimson transition-[width] duration-300"
                  style={{ width: `${healthTotal ? Math.min(100, (healthDone / healthTotal) * 100) : 0}%` }}
                />
              </div>
              <p className="mt-1.5 flex flex-wrap items-center gap-3 text-[10px] text-ink-mute">
                <span className="flex items-center gap-1">
                  <Icon name="checkCircle" size={11} className="text-live" /> {healthWorking.toLocaleString()} working
                </span>
                <span className="flex items-center gap-1">
                  <Icon name="xCircle" size={11} className="text-crimson" /> {healthFailing.toLocaleString()} failing
                </span>
                {healthLastRun ? <span>last run {relativeTime(healthLastRun.at)}</span> : null}
              </p>
            </div>
          ) : null}

          {healthError ? <p className="mt-2 text-[11px] text-crimson">{healthError}</p> : null}
          {!hosted ? (
            <p className="mt-2 text-[11px] text-ink-mute">
              The checker needs the hosted site, where the bridge sits in front of the panel.
            </p>
          ) : null}

          {healthFailures.length ? (
            <div className="mt-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wider text-ink-mute">
                  Not working ({healthFailures.length.toLocaleString()})
                </p>
                <button
                  className="text-[10px] font-bold uppercase tracking-wider text-crimson hover:text-white"
                  onClick={clearHealth}
                  data-nav="true"
                >
                  Clear
                </button>
              </div>
              <ul className="mt-1 divide-y divide-stroke/60">
                {healthFailures.slice(0, 8).map((f) => (
                  <li key={f.key} className="flex items-center gap-2 py-1.5">
                    <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{f.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-mute">
                      {f.kind} {f.id}
                    </span>
                    <span className="shrink-0 rounded-[2px] bg-crimson/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-crimson">
                      {reasonLabel(f.reason)}
                    </span>
                  </li>
                ))}
              </ul>
              {healthFailures.length > 8 ? (
                <p className="mt-1 text-[10px] text-ink-mute">
                  +{(healthFailures.length - 8).toLocaleString()} more in the report.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        {/* session */}
        <section className="panel mt-4 p-4">
          <h2 className="mb-3 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-widest text-ink-mute">
            <Icon name="lock" size={13} /> Session & security
          </h2>
          <div className="grid gap-3 text-[12px] sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-mute">Account type</p>
              <p className="font-semibold">{session?.userInfo?.is_trial === '1' ? 'Trial' : 'Premium'}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-mute">Expiry</p>
              <p className="font-semibold">{expiryLabel(session?.userInfo?.exp_date)}</p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-mute">Active connections</p>
              <p className="font-semibold tabular">
                {String(session?.userInfo?.active_cons ?? '0')} / {String(session?.userInfo?.max_connections ?? '1')}
              </p>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-wider text-ink-mute">Signed in</p>
              <p className="font-semibold">{session ? relativeTime(session.loggedInAt) : '—'}</p>
            </div>
            <LocalClock />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <button
              className="btn btn-ghost !py-2 text-xs"
              onClick={async () => {
                await logout()
                useCatalog.getState().reset()
                navigate('/login', { replace: true })
              }}
              data-nav="true"
            >
              <Icon name="logout" size={14} /> Sign out of this device
            </button>
            <span className="text-[10px] text-ink-mute">
              Credentials are encrypted at rest. Signing out removes them and clears the cached catalog.
            </span>
          </div>
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, icon }: { label: string; value: string; icon: 'heart' | 'clock' | 'tv' | 'film' }) {
  return (
    <div className="rounded-lg border border-stroke bg-layer-1 px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider text-ink-mute">
        <Icon name={icon} size={11} /> {label}
      </p>
      <p className="mt-1 truncate text-lg font-bold tabular">{value}</p>
    </div>
  )
}
