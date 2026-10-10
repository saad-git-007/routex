import { useEffect, useMemo, useRef, useState } from 'react'
import { AREAS, areaOf, spread, type Area } from '../lib/areas'
import { roadAt } from '../lib/conditions'
import { useFrames, useWatch } from '../lib/frames'
import type { Camera, RoadCondition } from '../lib/types'
import { Freshness, RoadNote, Shot } from './CameraCard'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

const DWELL = 5000

// Full screen, like Before I leave: five cameras spread across one part of the city, one per screen.
export function AreaShow({ open, onClose, cameras, roads, area, setArea, onZoom }: {
  open: boolean; onClose: () => void; cameras: Camera[]; roads: RoadCondition[]
  area: Area; setArea: (a: Area) => void; onZoom: (c: Camera) => void
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [cycle, setCycle] = useState(0)
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  const { frames } = useFrames()
  const inArea = useMemo(() => cameras.filter((c) => areaOf(c) === area), [cameras, area])
  // Cameras whose picture failed are left out, so a dead feed gets replaced by its neighbour.
  const offline = inArea.filter((c) => frames.get(c.id)?.error).map((c) => c.id).join()
  const cams = useMemo(() => spread(inArea.filter((c) => !offline.includes(c.id))), [inArea, offline])
  useWatch(open ? cams.map((c) => c.id) : [])
  const info = AREAS.find((a) => a.key === area)!

  const restart = () => { setI(0); setPlaying(!reduced()); scroller.current?.scrollTo({ top: 0 }) }
  useEffect(() => {
    if (open) { dlg.current?.showModal(); requestAnimationFrame(() => scroller.current?.focus({ preventScroll: true })); restart() }
    else dlg.current?.close()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open) restart() }, [area]) // eslint-disable-line react-hooks/exhaustive-deps

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
    scroller.current?.querySelector(`[data-i="${t}"]`)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
    setI(t); setCycle((c) => c + 1)
  }
  useEffect(() => {
    if (!open || !playing || !cams.length) return
    const t = setTimeout(() => (i >= cams.length - 1 ? setPlaying(false) : go(i + 1)), DWELL)
    return () => clearTimeout(t)
  }, [open, playing, i, cycle, cams.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mini map: every camera in the area, the five picks numbered.
  const mini = useMemo(() => {
    if (!inArea.length) return null
    const lats = inArea.map((c) => c.lat), lons = inArea.map((c) => c.lon)
    const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180)
    const w = (Math.max(...lons) - Math.min(...lons)) * k || 1e-3, h = Math.max(...lats) - Math.min(...lats) || 1e-3
    const s = 88 / Math.max(w, h)
    const xy = (c: Camera) => [6 + (c.lon - Math.min(...lons)) * k * s, 6 + (Math.max(...lats) - c.lat) * s] as const
    return { W: w * s + 12, H: h * s + 12, xy }
  }, [inArea])

  return (
    <dialog ref={dlg} className="bil areashow" onClose={onClose} onKeyDown={(e) => {
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); setPlaying(false); go(i + 1) }
      if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); setPlaying(false); go(i - 1) }
    }}>
      {open && (
        <>
          <aside className="bil-rail">
            <div className="bil-head">
              <p className="eyebrow">Areas</p>
              <h2>{info.label}</h2>
              <Segmented label="Area" className="area-seg" value={area} onChange={setArea} options={AREAS.map((a) => ({ value: a.key, label: a.short }))} />
              <p className="area-note">{cams.length} of {inArea.length} cameras, picked to spread across the area</p>
            </div>
            {mini && (
              <svg className="bil-mini" viewBox={`0 0 ${mini.W} ${mini.H}`} aria-hidden>
                {inArea.map((c) => { const [x, y] = mini.xy(c); return <circle key={c.id} cx={x} cy={y} r={0.9} className="area-other" /> })}
                {cams.map((c, j) => {
                  const [x, y] = mini.xy(c)
                  return <circle key={c.id} cx={x} cy={y} r={j === i ? 3 : 2.2} className={j === i ? 'on' : ''} onClick={() => { setPlaying(false); go(j) }} />
                })}
              </svg>
            )}
            <ol className="bil-dots" aria-label="Cameras">
              {cams.map((c, j) => (
                <li key={c.id}><button aria-current={j === i} onClick={() => { setPlaying(false); go(j) }} title={c.name}><span className="tnum">{j + 1}</span>{c.name}</button></li>
              ))}
            </ol>
          </aside>

          <div className="bil-stage" ref={scroller} tabIndex={-1}>
            {cams.map((c, j) => (
              <section key={c.id} className="bil-slide" data-i={j} aria-label={c.name}>
                <div className="bil-near" />
                <button className="bil-zoom" onClick={() => { setPlaying(false); onZoom(c) }} aria-label={`Zoom into ${c.name}`} title="Tap to zoom"><Shot id={c.id} alt={`Latest picture from ${c.name}`} className="bil-shot" /></button>
                <div className="bil-cap">
                  <span className="bil-n tnum">{j + 1}<small>/{cams.length}</small></span>
                  <div>
                    <h3>{c.name}</h3>
                    <p>{info.label} · <Freshness id={c.id} /></p>
                    <RoadNote road={roadAt(c, roads)} className="bil-road" />
                  </div>
                </div>
              </section>
            ))}
            {!cams.length && <div className="quiet"><Icon name="camera" size={20} /><p>No cameras in this area right now.</p></div>}
          </div>

          <div className="bil-bar">
            <button className="btn-icon" onClick={() => { setPlaying(false); go(i - 1) }} aria-label="Previous camera" disabled={i === 0}><Icon name="up" /></button>
            <button className="btn-accent btn-round" onClick={() => { if (!playing && i >= cams.length - 1) go(0); setPlaying(!playing) }} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} fill />
            </button>
            <button className="btn-icon" onClick={() => { setPlaying(false); go(i + 1) }} aria-label="Next camera" disabled={i >= cams.length - 1}><Icon name="down" /></button>
            <span className="bil-progress" aria-hidden>{playing && <i key={`${area}-${i}-${cycle}`} style={{ animationDuration: `${DWELL}ms` }} />}</span>
            <button className="btn-icon" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button>
          </div>
        </>
      )}
    </dialog>
  )
}
