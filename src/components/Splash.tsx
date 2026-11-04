import { useEffect, useRef, useState } from 'react'

/** Launch loader: the brand sting fills the whole screen while the catalogue boots. */
const POSTER = '/media/app-intro-poster.jpg'

const TV_SRC = '/media/app-intro-tv.mp4'
const TABLET_SRC = '/media/app-intro-hd.mp4'
const PHONE_SRC = '/media/app-intro.mp4'

/** Portrait clip cut for phones, an upscaled copy for tablets, a 16:9 crop for TVs. */
function introSource(w: number, h: number): string {
  if (!w || !h) return PHONE_SRC
  if (w / h >= 1.2) return TV_SRC
  return w >= 768 ? TABLET_SRC : PHONE_SRC
}

export function Splash() {
  // The right film for the current screen shape, kept in sync so rotating a
  // phone or resizing the window never leaves a letterboxed strip behind.
  const [src, setSrc] = useState(() => introSource(window.innerWidth, window.innerHeight))
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const sync = () => {
      const next = introSource(window.innerWidth, window.innerHeight)
      setSrc((current) => (current === next ? current : next))
    }
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => {
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
    }
  }, [])

  // Swapping the film on rotation recreates the element; start it again at once.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    void video.play().catch(() => {
      video.muted = true
      void video.play().catch(() => undefined)
    })
  }, [src])

  return (
    <div className="fixed inset-0 z-[200] overflow-hidden bg-black text-white">
      <video
        ref={videoRef}
        key={src}
        src={src}
        poster={POSTER}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        disablePictureInPicture
        tabIndex={-1}
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Keeps the footer legible over the brightest frames of the sting. */}
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
          <div className="splash-bar h-full bg-crimson" />
        </div>
      </div>
    </div>
  )
}
