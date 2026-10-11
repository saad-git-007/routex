import { useEffect, useRef, useState } from 'react'
import { GRADE_COLOR, roadGrade } from '../lib/conditions'
import { useFrame } from '../lib/frames'
import { ago, kmIn } from '../lib/geo'
import type { Camera, OnRoute, RoadCondition } from '../lib/types'
import { useNow } from '../lib/useNow'
import { Icon } from './Icon'
import { directUrl, isStill, isDirect, isLive } from '../lib/live'
import { LiveVideo } from './LiveVideo'

export const STALE_MS = 15 * 60e3

/** What a camera with no 511 road report says; Alberta covers its highways, so there it means a city street. */
export const NO_REPORT = { text: 'City street · no 511 road report' }

/** Cross-fades to each new picture so a refresh never flashes empty. */
export function Shot({ id, alt, className }: { id: string; alt: string; className?: string }) {
  if (isLive(id)) return <LiveVideo id={id} alt={alt} className={className} />
  if (isStill(id)) return <DirectStill id={id} alt={alt} className={className} />
  return <Still id={id} alt={alt} className={className} />
}

// Banff and Saskatchewan pictures load straight from their source, a fresh copy each minute, cross-fading like the others.
function DirectStill({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const minute = Math.floor(useNow(60e3) / 60e3)
  const [shown, setShown] = useState<string[]>([])
  const [error, setError] = useState(false)
  const next = directUrl(id, minute)
  return (
    <div className={`shot ${className ?? ''}`}>
      {!shown.length && (error ? <div className="shot-empty"><Icon name="camera" size={22} /><span>No picture</span></div> : <div className="shot-loading" />)}
      {shown.map((u, i) => <img key={u} src={u} alt={i === shown.length - 1 ? alt : ''} className={i === shown.length - 1 && shown.length > 1 ? 'in' : ''} draggable={false} />)}
      {shown[shown.length - 1] !== next && (
        <img key={next} src={next} alt="" hidden onLoad={() => { setError(false); setShown((s) => [...s.slice(-1), next]) }} onError={() => setError(true)} />
      )}
    </div>
  )
}

function Still({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const f = useFrame(id)
  const [layers, setLayers] = useState<string[]>([])
  const [fresh, setFresh] = useState(0)
  const first = useRef(true)
  useEffect(() => {
    if (!f?.url) return
    setLayers((l) => (l[l.length - 1] === f.url ? l : [...l.slice(-1), f.url]))
    if (!first.current) setFresh((n) => n + 1)
    first.current = false
  }, [f?.url])
  const now = useNow(10000)
  const stale = f && f.lm && now - f.lm > STALE_MS
  return (
    <div className={`shot ${stale ? 'is-stale' : ''} ${className ?? ''}`}>
      {layers.length === 0 && (f?.error ? <div className="shot-empty"><Icon name="camera" size={22} /><span>No picture</span></div> : <div className="shot-loading" />)}
      {layers.map((u, i) => <img key={u} src={u} alt={i === layers.length - 1 ? alt : ''} className={i === layers.length - 1 && layers.length > 1 ? 'in' : ''} draggable={false} />)}
      {fresh > 0 && <span key={fresh} className="shot-sweep" aria-hidden />}
    </div>
  )
}

export function Freshness({ id }: { id: string }) {
  if (isLive(id)) return <span className="fresh fresh-live"><i />Live video</span>
  if (isStill(id)) return <span className="fresh fresh-live"><i />Refreshes every minute</span>
  return <Age id={id} />
}

function Age({ id }: { id: string }) {
  const f = useFrame(id)
  const now = useNow(5000)
  if (!f?.lm) return null
  const age = now - f.lm
  const cls = age > STALE_MS ? 'stale' : age > 3 * 60e3 ? 'old' : 'live'
  return <span className={`fresh fresh-${cls}`}><i />{age > STALE_MS ? `Not updating · ${ago(f.lm, now)}` : ago(f.lm, now)}</span>
}

// The 511 road report for the stretch a camera shows, or a note that city streets aren't covered.
export function RoadNote({ road, className = '' }: { road: RoadCondition | null | undefined; className?: string }) {
  if (!road) return <p className={`road-note is-none ${className}`}><Icon name="road" size={14} /><span>{NO_REPORT.text}</span></p>
  const extra = [...road.extra, ...(road.visibility && !/good|normal/i.test(road.visibility) ? [`${road.visibility} visibility`] : [])]
  return (
    <p className={`road-note ${className}`} style={{ color: GRADE_COLOR[roadGrade(road)] }} title={['511', [road.hwy, road.segment].filter(Boolean).join(' '), road.updated && `updated ${road.updated}`].filter(Boolean).join(' · ')}>
      <Icon name="road" size={14} /><span><b>{road.condition}</b>{extra.length ? ` · ${extra.join(', ')}` : ''}{road.hwy && <small> · {road.hwy}</small>}</span>
    </p>
  )
}

export function CameraCard({ cam, index, legLabel, road, active, onSelect, onTimelapse, onZoom, cardRef }: {
  cam: OnRoute<Camera>; index: number; legLabel: string; road: RoadCondition | null | undefined; active: boolean
  onSelect: () => void; onTimelapse: () => void; onZoom: () => void; cardRef?: (el: HTMLElement | null) => void
}) {
  return (
    <div className={`magic cam-card ${active ? 'is-active' : ''}`} data-cam={cam.id} ref={cardRef}>
      {active && <span className="card-trace" aria-hidden />}
      <button className="cam-hit" onClick={onSelect} aria-label={`Show ${cam.name} on the map`}>
        <Shot id={cam.id} alt={`Latest picture from ${cam.name}`} />
        <span className="cam-index tnum">{index + 1}</span>
        <Freshness id={cam.id} />
      </button>
      <div className="cam-body">
        <div className="cam-title">
          <h3>{cam.name}</h3>
          <p className="cam-meta"><span className="tnum">{kmIn(cam.along)}</span> · {legLabel}{cam.src !== 'city' && <span className="tag">{cam.src === 'ab' ? '511' : cam.area}</span>}</p>
          <RoadNote road={road} />
        </div>
        <button className="btn-icon btn-xs" onClick={onZoom} aria-label={`Zoom into ${cam.name}`} title="Zoom into the picture"><Icon name="zoomin" size={16} /></button>
        {!isDirect(cam.id) && <button className="btn-ghost btn-sm" onClick={onTimelapse} title="Time-lapse of the last hours"><Icon name="film" size={15} /> <span className="cam-tl-label">Time-lapse</span></button>}
      </div>
    </div>
  )
}
