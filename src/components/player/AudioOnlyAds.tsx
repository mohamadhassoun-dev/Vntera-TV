import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../Icons'
import { adsSupported, hideAdsBanner, showAdsBanner } from '../../lib/admob'

interface PlatformAd {
  label: string
  logo: string
  tint: string
  copy: string
}

/** In-house promos shown while audio-only mode leaves the video area empty. */
const ADS: PlatformAd[] = [
  {
    label: 'Netflix',
    logo: '/logos/netflix.svg',
    tint: '#e50914',
    copy: 'The biggest Netflix films and series, streaming in one library.',
  },
  {
    label: 'Prime Video',
    logo: '/logos/prime.svg',
    tint: '#00a8e1',
    copy: 'Prime Video originals and blockbusters, ready to play.',
  },
  {
    label: 'Shahid',
    logo: '/logos/shahid.svg',
    tint: '#00c8c8',
    copy: 'Shahid exclusives and Arabic hits, all in one place.',
  },
  {
    label: 'Disney+',
    logo: '/logos/disney.svg',
    tint: '#4f7cff',
    copy: 'Disney, Pixar, Marvel and Star Wars on demand.',
  },
  {
    label: 'IMDb',
    logo: '/logos/imdb.svg',
    tint: '#f5c518',
    copy: 'Top-rated IMDb picks, refreshed every week.',
  },
  {
    label: 'WWE',
    logo: '/logos/wwe.svg',
    tint: '#d7182a',
    copy: 'Every WWE premium live event, on demand.',
  },
]

export function AudioOnlyAds({ title }: { title: string }) {
  const [index, setIndex] = useState(0)
  const [banner, setBanner] = useState(false)

  useEffect(() => {
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % ADS.length), 8000)
    return () => window.clearInterval(timer)
  }, [])

  // The AdMob banner belongs to this advertising panel alone: it arrives with the
  // panel and leaves with it, so no other screen ever shows an ad.
  useEffect(() => {
    if (!adsSupported()) return
    let live = true
    showAdsBanner().then((ok) => {
      if (!live) {
        if (ok) void hideAdsBanner()
        return
      }
      setBanner(ok)
    })
    return () => {
      live = false
      setBanner(false)
      void hideAdsBanner()
    }
  }, [])

  const ad = ADS[index]

  return (
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden bg-canvas" aria-live="polite">
      <div
        className="absolute inset-0 transition-colors duration-700"
        style={{ background: `radial-gradient(circle at 50% 42%, ${ad.tint}55, #0b0b0f 72%)` }}
      />
      <div className={`relative flex h-full items-center justify-center px-6 ${banner ? 'pb-14' : ''}`}>
        <div className="pointer-events-auto flex max-w-sm flex-col items-center gap-3 text-center">
          <span className="rounded-[2px] border border-white/25 px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.22em] text-white/65">
            Sponsored · Vntera
          </span>
          <img src={ad.logo} alt={`${ad.label} logo`} className="max-h-16 w-full max-w-[210px] object-contain drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)]" />
          <p className="text-[13px] leading-relaxed text-ink-soft">{ad.copy}</p>
          <Link
            to={`/search?q=${encodeURIComponent(ad.label)}`}
            className="btn btn-primary !py-2 text-xs"
            data-nav="true"
          >
            <Icon name="play" size={14} /> Browse {ad.label}
          </Link>
          <div className="mt-1 flex items-center gap-1.5">
            {ADS.map((entry, dot) => (
              <button
                key={entry.label}
                onClick={() => setIndex(dot)}
                aria-label={`Show ${entry.label} promotion`}
                aria-current={dot === index ? 'true' : undefined}
                className={`h-1 rounded-full transition-all ${dot === index ? 'w-5 bg-white' : 'w-1 bg-white/35'}`}
              />
            ))}
          </div>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-ink-mute">
            Audio only · {title}
          </p>
          {banner && (
            <p className="text-[9px] uppercase tracking-[0.2em] text-white/35">Advertisement</p>
          )}
        </div>
      </div>
    </div>
  )
}
