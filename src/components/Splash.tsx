import { useEffect, useRef, useState } from 'react'

/**
 * Launch splash.
 *
 * On a fresh boot it plays the short brand intro over the home page, which keeps
 * loading behind it, so the first screen is never a dead loader. Lazy-route
 * fallbacks use the same component without the video: a route change must not
 * replay the intro.
 */
export function Splash({
  progress,
  intro = false,
  onDone,
}: {
  progress?: number
  intro?: boolean
  onDone?: () => void
}) {
  const [shown, setShown] = useState(false)
  const [videoFailed, setVideoFailed] = useState(false)
  const finished = useRef(false)
  // A TV browser and a reduced-motion viewer both get the still loader.
  const [videoWanted] = useState(() => {
    if (typeof window === 'undefined') return false
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  const finish = () => {
    if (finished.current) return
    finished.current = true
    onDone?.()
  }

  useEffect(() => {
    const t = window.setTimeout(() => setShown(true), 60)
    return () => window.clearTimeout(t)
  }, [])

  // The intro is a cover, not a gate: never hold the app longer than this even
  // when autoplay is blocked and no `ended` event ever arrives.
  useEffect(() => {
    if (!intro) return
    const cap = window.setTimeout(finish, 5_000)
    return () => window.clearTimeout(cap)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intro])

  const known = typeof progress === 'number' && progress > 0
  const fill = known ? `${Math.max(4, Math.min(100, progress))}%` : undefined
  const video = intro && videoWanted && !videoFailed

  return (
    <div
      className="fixed inset-0 z-[200] overflow-hidden bg-black text-white"
      onClick={intro ? finish : undefined}
      role={intro ? 'button' : undefined}
      aria-label={intro ? 'Skip intro' : undefined}
    >
      {video ? (
        <video
          src="/media/app-intro-hd.mp4"
          poster="/media/app-intro-poster.jpg"
          autoPlay
          muted
          playsInline
          preload="auto"
          // A blocked autoplay or a slow file falls back to the still loader.
          onEnded={finish}
          // Some WebViews miss `ended` on a muted sting; the clock is the truth.
          onTimeUpdate={(event) => {
            const el = event.currentTarget
            if (el.duration && el.currentTime >= el.duration - 0.05) finish()
          }}
          onError={() => setVideoFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <>
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
        </>
      )}

      {/* Keeps the footer legible over the picture. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-black via-black/70 to-transparent" />

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 px-6 pb-[max(1.75rem,env(safe-area-inset-bottom))] md:pb-12">
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
