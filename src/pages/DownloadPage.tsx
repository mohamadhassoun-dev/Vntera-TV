import { Link } from 'react-router-dom'
import { Icon } from '../components/Icons'
import { ANDROID_RELEASE } from '../lib/release'

const STEPS = [
  'Download the file on your Android phone.',
  'Open it from your downloads and allow installing from this source when Android asks.',
  'Sign in with the same account you use on the web — your list and progress come with you.',
]

export default function DownloadPage() {
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
        <div className="mx-auto w-full max-w-2xl">
          <img
            src="/logos/login-logo.webp"
            alt="Vntera"
            width={360}
            height={240}
            fetchPriority="high"
            decoding="async"
            className="mb-7 block h-24 w-auto sm:h-28"
          />

          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-black uppercase tracking-tight md:text-[30px]">Get the Android app</h1>
            <span className="rounded-[2px] bg-crimson px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-widest text-white">
              APK
            </span>
          </div>
          <p className="mt-2 max-w-xl text-sm text-ink-soft">
            The same library, live channels and watchlist as the web app, in a phone-sized player.
            Version {ANDROID_RELEASE.version} · {ANDROID_RELEASE.sizeLabel} · Android {ANDROID_RELEASE.minAndroid}+.
          </p>

          <a
            href={ANDROID_RELEASE.file}
            download={`vntera-${ANDROID_RELEASE.version}.apk`}
            className="btn btn-primary mt-6 inline-flex !py-3.5 px-6 uppercase tracking-wide"
            data-nav="true"
          >
            <Icon name="download" size={18} />
            Download APK
          </a>

          <div className="mt-8 rounded-[4px] border border-stroke bg-layer-1/80 p-4 sm:p-5">
            <h2 className="text-[11px] font-extrabold uppercase tracking-widest text-ink-soft">Install in three steps</h2>
            <ol className="mt-3 space-y-2.5">
              {STEPS.map((step, index) => (
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
              This is a signed release build installed outside the Play Store, so Android may warn you the
              first time. Updates install straight over the old version and keep your sign-in.
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
        <span>Android {ANDROID_RELEASE.minAndroid}+ · {ANDROID_RELEASE.version}</span>
      </footer>
    </div>
  )
}
