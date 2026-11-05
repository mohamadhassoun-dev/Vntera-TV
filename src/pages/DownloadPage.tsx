import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon, type IconName } from '../components/Icons'
import { VERSION, release, type Platform } from '../lib/release'

const TABS: Array<{ platform: Platform; label: string; icon: IconName }> = [
  { platform: 'phone', label: 'Android phone', icon: 'device' },
  { platform: 'tv', label: 'Android TV', icon: 'tv' },
  { platform: 'desktop', label: 'Windows', icon: 'grid' },
]

const STEPS: Record<Platform, string[]> = {
  phone: [
    'Download the APK on your Android phone.',
    'Open it from your downloads and allow installing from this source when Android asks.',
    'Sign in with the same account you use on the web — your list and progress come with you.',
  ],
  tv: [
    'Copy the APK to a USB stick, or open this page in the TV browser and download it there.',
    'Install it — on a TV box, a file manager such as Downloader can open the file directly.',
    'Vntera TV appears in the home row next to your other apps. Move with the remote arrows, OK to select.',
  ],
  desktop: [
    'Download Vntera-Setup on your Windows PC.',
    'Run it. If SmartScreen warns about an unknown publisher, choose More info → Run anyway.',
    'The installer adds Vntera to the Start menu and the desktop; sign in once and the window remembers you.',
  ],
}

const NOTES: Record<Platform, string> = {
  phone:
    'Signed with the Vntera release key and installed outside the Play Store, so Android may warn you once. Updates install straight over the old version and keep your sign-in.',
  tv:
    'The TV build is a separate app (Vntera TV) with a remote-first layout: large focus rings, arrow-key navigation and no touch gestures. It installs alongside the phone app.',
  desktop:
    'The Windows app carries the same library and player, in a native window with a full-screen mode (F11), menu shortcuts and its own local bridge to the panel — no proxy or extension needed.',
}

export default function DownloadPage() {
  const [params] = useSearchParams()
  const initial = params.get('platform')
  const [active, setActive] = useState<Platform>(
    initial === 'tv' || initial === 'desktop' || initial === 'phone' ? initial : 'phone',
  )
  const current = release(active)

  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <img
          src="/media/login-backdrop.webp"
          alt=""
          aria-hidden="true"
          width={1100}
          height={576}
          decoding="async"
          className="h-full w-full scale-105 object-cover opacity-70 blur-[2px]"
        />
        <div className="absolute inset-0 bg-canvas/70" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,#13131300_10%,#131313_88%)]" />
        <div className="absolute left-1/2 top-0 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-crimson/10 blur-[150px]" />
      </div>

      <main className="relative z-10 flex flex-1 items-center px-4 py-10 md:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <Link to="/" aria-label="Vntera home" data-nav="true" className="inline-block">
            <img
              src="/logos/login-logo.webp"
              alt="Vntera"
              width={360}
              height={240}
              fetchPriority="high"
              decoding="async"
              className="mb-7 block h-24 w-auto sm:h-28"
            />
          </Link>

          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black uppercase tracking-tight md:text-[30px]">Get Vntera</h1>
            <span className="rounded-[2px] bg-crimson px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
              Version {VERSION}
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            The same library, live channels and watchlist on every screen. Pick the build for the device you
            are installing on.
          </p>

          <div
            role="tablist"
            aria-label="Choose your platform"
            className="mt-6 flex flex-wrap gap-1 rounded-[4px] border border-stroke bg-layer-1/70 p-1"
          >
            {TABS.map((tab) => {
              const entry = release(tab.platform)
              const selected = tab.platform === active
              return (
                <button
                  key={tab.platform}
                  role="tab"
                  aria-selected={selected}
                  data-nav="true"
                  onClick={() => setActive(tab.platform)}
                  className={`flex items-center gap-2 rounded-[3px] px-3.5 py-2.5 text-[12px] font-bold uppercase tracking-wide transition-colors ${
                    selected ? 'bg-crimson text-white' : 'text-ink-soft hover:bg-layer-2 hover:text-white'
                  } ${entry.bytes ? '' : 'opacity-40'}`}
                >
                  <Icon name={tab.icon} size={15} />
                  {tab.label}
                </button>
              )
            })}
          </div>

          <div className="mt-4 rounded-[4px] border border-stroke bg-layer-1/80 p-4 sm:p-5">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="text-lg font-black uppercase tracking-tight">{current.label}</h2>
                <p className="mt-1 text-[12px] text-ink-soft">
                  {VERSION} · {current.sizeLabel} · {current.requirement}
                </p>
                <p className="mt-0.5 truncate font-mono text-[11px] text-ink-mute">{current.name}</p>

                {current.bytes ? (
                  <a
                    href={current.file}
                    // A release asset is cross-origin, where `download` is ignored.
                    {...(current.file.startsWith('http') ? { rel: 'noreferrer' } : { download: current.name })}
                    className="btn btn-primary mt-4 inline-flex !py-3 px-5 text-[12px] uppercase tracking-wide"
                    data-nav="true"
                  >
                    <Icon name="download" size={17} />
                    {active === 'desktop' ? 'Download installer' : 'Download APK'}
                  </a>
                ) : (
                  <p className="mt-4 rounded-[3px] border border-stroke bg-layer-2/60 px-3 py-2 text-[12px] text-ink-soft">
                    This build is not published yet.
                  </p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-3 rounded-[4px] border border-stroke bg-canvas/60 p-2.5 pr-4">
                <img
                  src={current.qr}
                  alt={`QR code that opens the ${current.label} download`}
                  width={104}
                  height={104}
                  loading="lazy"
                  decoding="async"
                  className="h-[104px] w-[104px] rounded-[3px] bg-white p-1"
                />
                <span className="max-w-[10rem] text-[11px] leading-snug text-ink-soft">
                  <span className="block font-bold uppercase tracking-wider text-white">
                    {active === 'desktop' ? 'Open on the PC' : 'Scan to install'}
                  </span>
                  {active === 'desktop'
                    ? 'Scan with a phone, or type the address into the PC browser.'
                    : 'Point the camera here and this section opens with the download.'}
                </span>
              </div>
            </div>

            <h3 className="mt-5 border-t border-stroke pt-4 text-[11px] font-extrabold uppercase tracking-widest text-ink-soft">
              How to install
            </h3>
            <ol className="mt-3 space-y-2.5">
              {STEPS[active].map((step, index) => (
                <li key={index} className="flex gap-3 text-[13px] leading-relaxed text-white/90">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-crimson text-[11px] font-black text-white">
                    {index + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 flex items-start gap-2 border-t border-stroke pt-3 text-[11px] text-ink-mute">
              <Icon name="info" size={14} className="mt-0.5 shrink-0 text-crimson" />
              {NOTES[active]}
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px]">
            <Link to="/" className="flex items-center gap-1.5 font-bold text-white hover:text-crimson" data-nav="true">
              <Icon name="tv" size={14} className="text-crimson" />
              Continue in the browser
            </Link>
            <span className="text-ink-mute">Signed with the Vntera release key</span>
          </div>
        </div>
      </main>

      <footer className="relative z-10 flex flex-col items-center justify-between gap-2 px-4 py-4 text-[10px] text-ink-mute sm:flex-row md:px-8">
        <span className="font-bold uppercase tracking-wider">© {new Date().getFullYear()} Vntera Media Networks</span>
        <span>Version {VERSION} · phone · TV · Windows</span>
      </footer>
    </div>
  )

}
