import { useCallback, useEffect, useRef, useState } from 'react'

const INTRO_SRC = '/media/intro.mp4'
/** Longest we wait before handing off, in case the file stalls. */
const INTRO_TIMEOUT = 20000

/**
 * Brand sting played before a movie or episode starts. The real stream is only
 * mounted once this finishes, so no audio from the title leaks under the logo.
 */
export function IntroPreroll({ title, onDone }: { title: string; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const finished = useRef(false)
  const [fading, setFading] = useState(false)

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    setFading(true)
    window.setTimeout(onDone, 240)
  }, [onDone])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    // A click brought the viewer here, so sound usually starts; if the browser
    // blocks it, fall back to a silent sting instead of stalling playback.
    void video.play().catch(() => {
      video.muted = true
      void video.play().catch(finish)
    })
    const guard = window.setTimeout(finish, INTRO_TIMEOUT)
    return () => window.clearTimeout(guard)
  }, [finish])

  return (
    <div
      className={`fixed inset-0 z-[70] flex items-center justify-center bg-black transition-opacity duration-200 ${
        fading ? 'opacity-0' : 'opacity-100'
      }`}
    >
      <video
        ref={videoRef}
        src={INTRO_SRC}
        playsInline
        preload="auto"
        disablePictureInPicture
        aria-label="Vntera intro"
        className="h-full w-full object-contain"
        onEnded={finish}
        onError={finish}
        data-nav="true"
      />
      <span className="pointer-events-none absolute left-5 top-5 max-w-[60%] truncate text-xs font-semibold uppercase tracking-[0.18em] text-white/55">
        {title}
      </span>
      <button
        type="button"
        onClick={finish}
        className="absolute bottom-6 right-5 rounded-[3px] border border-white/25 bg-black/55 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white/80 backdrop-blur-sm transition-colors hover:border-white/50 hover:text-white"
        data-nav="true"
        aria-label="Skip intro"
      >
        Skip intro
      </button>
    </div>
  )
}
