import { useEffect, useState } from 'react'

/** How long the smiley loader may stay in front of the app while the catalogue
 *  boots. Home usually appears long before this; the cap keeps a slow network
 *  from hiding the page forever. */
export const SPLASH_MAX_MS = 7_000

/**
 * Launch loader: a glowing smiley breathing in the dark while the catalogue pulls
 * its first page, with the wordmark and a progress line underneath.
 *
 * `progress` is the catalogue's own 0-100 figure; without it the line runs on its
 * own animation, which is what a lazy route load needs.
 */
export function Splash({ progress }: { progress?: number }) {
  // Reveal the mark once, not on every progress tick.
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 60)
    return () => window.clearTimeout(t)
  }, [])

  const known = typeof progress === 'number' && progress > 0
  const fill = known ? `${Math.max(4, Math.min(100, progress))}%` : undefined

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden bg-black text-white">
      {/* Vignette: the smiley sits in a pool of light, the edges fall to black. */}
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 38%, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.035) 34%, rgba(0,0,0,0) 68%)',
        }}
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center pb-24">
        <svg
          viewBox="0 0 200 200"
          role="img"
          aria-label="Vntera is loading"
          className={`splash-smiley h-[46svh] max-h-[22rem] w-auto ${shown ? 'splash-smiley--in' : 'opacity-0'}`}
        >
          <g fill="#fff">
            <circle cx="71" cy="72" r="21" />
            <circle cx="129" cy="72" r="21" />
            {/* A thick smile that stops short of the face edge, ends rounded. */}
            <path
              d="M42 116a58 58 0 0 0 116 0"
              fill="none"
              stroke="#fff"
              strokeWidth="22"
              strokeLinecap="round"
            />
          </g>
        </svg>
      </div>

      {/* Keeps the footer legible over the glow. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/70 to-transparent" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] md:pb-12">
        {/* One logo per screen class, so phones, tablets and TVs all get crisp pixels. */}
        <picture>
          <source media="(min-width: 1200px)" srcSet="/logos/splash-logo-lg.webp" />
          <source media="(min-width: 768px)" srcSet="/logos/splash-logo-md.webp" />
          <img
            src="/logos/splash-logo-sm.webp"
            alt="Vntera"
            width={150}
            height={100}
            decoding="async"
            className="h-12 w-auto md:h-16 xl:h-20"
          />
        </picture>

        <div className="h-[2px] w-[min(72vw,17rem)] overflow-hidden rounded-full bg-white/15 md:w-[22rem]">
          <div
            className={`splash-bar h-full bg-crimson ${known ? '' : 'splash-bar--run'}`}
            style={fill ? { width: fill, transition: 'width 400ms ease-out' } : undefined}
          />
        </div>
      </div>
    </div>
  )
}
