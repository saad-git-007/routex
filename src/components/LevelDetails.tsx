import { useEffect, useRef, useState } from 'react'
import { LEVEL_TEXT, type Level } from '../lib/conditions'
import { kmIn } from '../lib/geo'
import type { Alert, OnRoute, RoadEvent } from '../lib/types'
import { Icon } from './Icon'

const until = (s: string) => {
  const d = new Date(s)
  return isNaN(+d) ? s : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
const KINDS = [['closure', 'Closures'], ['incident', 'Incidents'], ['construction', 'Construction']] as const

// The route's Clear / Caution / Slow going pill; tap it to see what's behind it.
export function LevelDetails({ level, reasons, events, alerts, showReasons = false }: {
  level: Level; reasons: string[]; events: OnRoute<RoadEvent>[]; alerts: Alert[]; showReasons?: boolean
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const out = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('pointerdown', out)
    return () => document.removeEventListener('pointerdown', out)
  }, [open])
  // Reasons the lists below don't already cover (road surface, weather, cameras not updating).
  const other = reasons.filter((r) => !/closure|incident|construction|weather alert/.test(r))
  const sorted = [...events].sort((a, b) => a.along - b.along)
  const empty = !events.length && !alerts.length && !other.length

  return (
    <div className="lvl" ref={box} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Escape' && open) { e.preventDefault(); setOpen(false) } }}>
      <button type="button" className={`level level-${level} lvl-btn`} aria-expanded={open} onClick={() => setOpen(!open)} title="What's on the route">
        <i />{LEVEL_TEXT[level]}{showReasons && reasons.length ? <span> · {reasons.slice(0, 3).join(' · ')}</span> : null}
        <Icon name={open ? 'up' : 'down'} size={13} />
      </button>
      {open && (
        <div className="lvl-pop" role="dialog" aria-label="On the route">
          {empty && <p className="lvl-none">Nothing reported on this route.</p>}
          {alerts.length > 0 && (
            <section>
              <p className="eyebrow-sm">Weather alerts</p>
              {alerts.map((a) => <div key={a.id} className={`lvl-item ${a.high ? 'is-high' : ''}`}><b>{a.title}</b>{a.notes && <p>{a.notes}</p>}{a.end && <small>Until {a.end}</small>}</div>)}
            </section>
          )}
          {KINDS.map(([k, label]) => {
            const list = sorted.filter((e) => e.kind === k)
            return list.length > 0 && (
              <section key={k}>
                <p className="eyebrow-sm">{label}</p>
                {list.map((e) => <div key={e.id} className={`lvl-item kind-${k}`}><b>{e.title}</b>{e.detail && e.detail !== e.title && <p>{e.detail}</p>}<small>{kmIn(e.along)}{e.end ? ` · until ${until(e.end)}` : ''}</small></div>)}
              </section>
            )
          })}
          {other.length > 0 && (
            <section>
              <p className="eyebrow-sm">Also</p>
              {other.map((r) => <div key={r} className="lvl-item"><b>{r}</b></div>)}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
