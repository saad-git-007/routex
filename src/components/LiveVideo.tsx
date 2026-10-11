import { useEffect, useRef, useState } from 'react'
import { streamUrl } from '../lib/live'
import { Icon } from './Icon'

// A live camera stream, muted. It only plays while on screen, and hls.js is only downloaded for browsers
// without built-in HLS (Safari and iOS play it natively).
export function LiveVideo({ id, alt, className, videoRef }: { id: string; alt: string; className?: string; videoRef?: (el: HTMLVideoElement | null) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const v = useRef<HTMLVideoElement | null>(null)
  const [state, setState] = useState<'loading' | 'live' | 'error'>('loading')
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => setSeen(e.isIntersecting), { threshold: 0.05 })
    io.observe(box.current!)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const el = v.current
    if (!el || !seen) return
    const url = streamUrl(id)
    let dead = false, hls: { destroy(): void } | null = null
    setState((s) => (s === 'live' ? s : 'loading'))
    const playing = () => setState('live')
    el.addEventListener('playing', playing)
    if (el.canPlayType('application/vnd.apple.mpegurl')) {
      el.src = url
      el.onerror = () => setState('error')
      el.play().catch(() => {})
    } else {
      void import('hls.js').then(({ default: Hls }) => {
        if (dead) return
        if (!Hls.isSupported()) return setState('error')
        const h = new Hls({ maxBufferLength: 6, liveSyncDurationCount: 2, manifestLoadingMaxRetry: 2 })
        h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) setState('error') })
        h.loadSource(url)
        h.attachMedia(el)
        hls = h
        el.play().catch(() => {})
      }).catch(() => setState('error'))
    }
    return () => {
      dead = true
      el.removeEventListener('playing', playing)
      hls?.destroy()
      el.removeAttribute('src'); el.load()
    }
  }, [id, seen])

  return (
    <div ref={box} className={`shot is-live ${className ?? ''}`}>
      {state === 'loading' && <div className="shot-loading" />}
      {state === 'error' && <div className="shot-empty"><Icon name="camera" size={22} /><span>Video unavailable</span></div>}
      <video ref={(el) => { v.current = el; videoRef?.(el) }} muted playsInline autoPlay disablePictureInPicture aria-label={alt} />
      {state === 'live' && <span className="live-badge" aria-hidden>Live</span>}
    </div>
  )
}
