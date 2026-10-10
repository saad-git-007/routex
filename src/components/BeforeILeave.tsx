import { useEffect, useMemo, useRef, useState } from 'react'
import { LEVEL_TEXT, sky, type Level } from '../lib/conditions'
import { km, kmIn, mins } from '../lib/geo'
import type { Camera, OnRoute, RoadCondition, RoadEvent, Route, Weather } from '../lib/types'
import { Freshness, RoadNote, Shot } from './CameraCard'
import { Icon } from './Icon'

const DWELL = 5000

// Full-screen, one camera per screen in driving order, auto-advancing. Glance through the whole drive in a minute.
export function BeforeILeave({ open, onClose, route, cams, events, camRoads, weather, level, reasons, onZoom }: {
  open: boolean; onClose: () => void; route: Route; cams: OnRoute<Camera>[]; events: OnRoute<RoadEvent>[]; camRoads: Map<string, RoadCondition | null>
  weather: Weather[]; level: Level; reasons: string[]; onZoom: (c: Camera) => void
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [cycle, setCycle] = useState(0)

  useEffect(() => {
    if (open) { dlg.current?.showModal(); requestAnimationFrame(() => scroller.current?.focus({ preventScroll: true })); setI(0); setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches); scroller.current?.scrollTo({ top: 0 }) }
    else dlg.current?.close()
  }, [open])

  // Track the slide in view (manual scroll, keys or autoplay).
  useEffect(() => {
    const root = scroller.current
    if (!root || !open) return
    const io = new IntersectionObserver((es) => {
      const e = es.find((x) => x.isIntersecting)
      if (e) setI(+(e.target as HTMLElement).dataset.i!)
    }, { root, threshold: 0.6 })
    root.querySelectorAll('[data-i]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [open, cams])

  const go = (n: number) => {
    const t = Math.max(0, Math.min(cams.length - 1, n))
    scroller.current?.querySelector(`[data-i="${t}"]`)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' })
    setI(t); setCycle((c) => c + 1)
  }

  useEffect(() => {
    if (!open || !playing || !cams.length) return
    const t = setTimeout(() => (i >= cams.length - 1 ? setPlaying(false) : go(i + 1)), DWELL)
    return () => clearTimeout(t)
  }, [open, playing, i, cycle, cams.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mini route: equirectangular projection into a 100-wide box.
  const mini = useMemo(() => {
    const lats = route.coords.map((c) => c[0]), lons = route.coords.map((c) => c[1])
    const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180)
    const w = (Math.max(...lons) - Math.min(...lons)) * k || 1e-3, h = Math.max(...lats) - Math.min(...lats) || 1e-3
    const s = 88 / Math.max(w, h), W = w * s + 12, H = h * s + 12
    const xy = (lat: number, lon: number) => [6 + (lon - Math.min(...lons)) * k * s, 6 + (Math.max(...lats) - lat) * s] as const
    const step = Math.max(1, Math.floor(route.coords.length / 400))
    const d = route.coords.filter((_, j) => j % step === 0).map(([a, b], j) => `${j ? 'L' : 'M'}${xy(a, b).map((v) => v.toFixed(2)).join(' ')}`).join('')
    return { W, H, d, xy }
  }, [route])

  const cam = cams[i]
  const near = cam ? events.filter((e) => Math.abs(e.along - cam.along) < 1500 && e.kind !== 'construction') : []
  const temps = weather.map((w) => w.temp)

  return (
    <dialog ref={dlg} className="bil" onClose={onClose} onKeyDown={(e) => {
      if (['ArrowDown', 'ArrowRight', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); setPlaying(false); go(i + 1) }
      if (['ArrowUp', 'ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); setPlaying(false); go(i - 1) }
    }}>
      {open && (
        <>
          <aside className="bil-rail">
            <div className="bil-head">
              <p className="eyebrow">Before I leave</p>
              <h2><span className="tnum">{mins(route.duration)}</span> <em>· {km(route.distance)}</em></h2>
              <p className={`level level-${level}`}><i />{LEVEL_TEXT[level]}{reasons.length ? <span> · {reasons.slice(0, 3).join(' · ')}</span> : null}</p>
              {weather.length > 0 && (
                <p className="bil-wx"><Icon name={sky(weather[0].code).icon} size={16} /> {sky(weather[0].code).text} · <span className="tnum">{Math.round(Math.min(...temps))}°–{Math.round(Math.max(...temps))}°</span></p>
              )}
            </div>
            <svg className="bil-mini" viewBox={`0 0 ${mini.W} ${mini.H}`} aria-hidden>
              <path d={mini.d} className="mini-route" />
              {cams.map((c, j) => {
                const [x, y] = mini.xy(c.lat, c.lon)
                return <circle key={c.id} cx={x} cy={y} r={j === i ? 2.6 : 1.5} className={j === i ? 'on' : j < i ? 'past' : ''} onClick={() => { setPlaying(false); go(j) }} />
              })}
            </svg>
            <ol className="bil-dots" aria-label="Cameras">
              {cams.map((c, j) => (
                <li key={c.id}><button aria-current={j === i} onClick={() => { setPlaying(false); go(j) }} title={c.name}><span className="tnum">{j + 1}</span>{c.name}</button></li>
              ))}
            </ol>
          </aside>

          <div className="bil-stage" ref={scroller} tabIndex={-1}>
            {cams.map((c, j) => (
              <section key={c.id} className="bil-slide" data-i={j} aria-label={c.name}>
                <div className="bil-near" aria-live="polite">{j === i && near.map((e) => <span key={e.id} className={`chip chip-${e.kind}`}><Icon name={e.kind === 'closure' ? 'closure' : 'alert'} size={13} /> {e.title}</span>)}</div>
                <button className="bil-zoom" onClick={() => { setPlaying(false); onZoom(c) }} aria-label={`Zoom into ${c.name}`} title="Tap to zoom"><Shot id={c.id} alt={`Latest picture from ${c.name}`} className="bil-shot" /></button>
                <div className="bil-cap">
                  <span className="bil-n tnum">{j + 1}<small>/{cams.length}</small></span>
                  <div>
                    <h3>{c.name}</h3>
                    <p><span className="tnum">{kmIn(c.along)}</span> · <Freshness id={c.id} /></p>
                    <RoadNote road={camRoads.get(c.id)} className="bil-road" />
                  </div>
                </div>
              </section>
            ))}
          </div>

          <div className="bil-bar">
            <button className="btn-icon" onClick={() => { setPlaying(false); go(i - 1) }} aria-label="Previous camera" disabled={i === 0}><Icon name="up" /></button>
            <button className="btn-accent btn-round" onClick={() => { if (!playing && i >= cams.length - 1) go(0); setPlaying(!playing) }} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} fill />
            </button>
            <button className="btn-icon" onClick={() => { setPlaying(false); go(i + 1) }} aria-label="Next camera" disabled={i >= cams.length - 1}><Icon name="down" /></button>
            <span className="bil-progress" aria-hidden>{playing && <i key={`${i}-${cycle}`} style={{ animationDuration: `${DWELL}ms` }} />}</span>
            <button className="btn-icon" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button>
          </div>
        </>
      )}
    </dialog>
  )
}
