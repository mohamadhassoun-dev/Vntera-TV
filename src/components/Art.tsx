import { useEffect, useMemo, useRef, useState } from 'react'
import { channelArt, backdropArt, posterArt } from '../lib/artwork'

interface ArtProps {
  src?: string
  title: string
  kind?: 'poster' | 'backdrop' | 'channel'
  className?: string
  seed?: string
  priority?: boolean
  /** Called when a real image URL fails; lets cards remove themselves. */
  onFail?: () => void
  /** Called once a real image paints, so a card can judge what arrived. */
  onLoad?: (image: HTMLImageElement) => void
}

/** Artwork with generated cinematic fallback: missing images never leave a hole. */
export function Art({ src, title, kind = 'poster', className, seed, priority, onFail, onLoad }: ArtProps) {
  const [failed, setFailed] = useState(false)
  useEffect(() => setFailed(false), [src])
  const generated = useMemo(() => {
    const s = seed || title
    if (kind === 'channel') return channelArt(s)
    if (kind === 'backdrop') return backdropArt(title, s)
    return posterArt(title, s)
  }, [kind, seed, title])

  return (
    <img
      src={!src || failed ? generated : src}
      alt=""
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => {
        setFailed(true)
        if (src) onFail?.()
      }}
      onLoad={(event) => onLoad?.(event.currentTarget)}
      className={className}
    />
  )
}

interface InViewOptions {
  rootMargin?: string
  once?: boolean
}

export function useInView<T extends HTMLElement>({ rootMargin = '200px', once = true }: InViewOptions = {}) {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setInView(true)
            if (once) observer.disconnect()
          } else if (!once) setInView(false)
        }
      },
      { rootMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [once, rootMargin])

  return { ref, inView }
}
