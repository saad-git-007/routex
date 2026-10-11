import { memo, useState, useMemo } from 'react'
import { GRADE_COLOR, GRADES, roadGrade, roadIsGood } from '../lib/conditions'
import { ago, km, kmIn, onRoute, extent } from '../lib/geo'
import type { OnRoute, RoadCondition, RoadEvent, Route } from '../lib/types'
import { useNow } from '../lib/useNow'
import { useNewIds } from '../lib/useSeen'
import { Icon, type IconName } from './Icon'

const KIND: Record<RoadEvent['kind'], { icon: IconName; label: string }> = {
  incident: { icon: 'alert', label: 'Incident' },
  closure: { icon: 'closure', label: 'Closure' },
  construction: { icon: 'cone', label: 'Construction' },
}
const RANK = { closure: 0, incident: 1, construction: 2 }

function when(e: RoadEvent, now: number) {
  if (e.src === 'city' && e.kind === 'incident' && e.start) return `Started ${ago(Date.parse(e.start), now)}`
  if (e.end) {
    const t = /^\d{4}-\d\d-\d\dT/.test(e.end) ? new Date(e.end) : null
    return `Until ${t && !isNaN(+t) ? t.toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : e.end}`
  }
  return e.updated ? `Updated ${e.updated}` : ''
}

// Where each 511 segment sits along the drive: project its shape onto the route, keep the covered stretch.
function along(route: Route, roads: RoadCondition[]) {
  return roads.flatMap((r) => {
    if (!r.line?.length) return []
    const hits = onRoute(route, r.line.map(([lat, lon]) => ({ lat, lon })), 120)
    if (!hits.length) return []
    const a = hits.map((h) => h.along)
    const [from, to] = extent(a)
    return [{ r, from, to }]
  }).filter((x) => x.to - x.from > 200).sort((a, b) => a.from - b.from)
}

function AlertsPanelView({ events, roads, highways, route, onShow, onShowRoad, selected }: {
  events: OnRoute<RoadEvent>[]; roads: RoadCondition[]; highways: string[]; route: Route
  onShow: (e: RoadEvent) => void; onShowRoad: (r: RoadCondition) => void; selected: string | null
}) {
  const now = useNow(30000)
  const [open, setOpen] = useState<string | null>(null)
  const fresh = useNewIds(events.map((e) => e.id))
  const sorted = useMemo(() => [...events].sort((a, b) => RANK[a.kind] - RANK[b.kind] || a.along - b.along), [events])
  const segs = useMemo(() => along(route, roads), [route, roads])
  const byHwy = segs.length ? [] : highways.map((h) => ({ h, rows: roads.filter((r) => r.hwy.toUpperCase() === h.toUpperCase()) })).filter((x) => x.rows.length)

  return (
    <div className="alerts">
      {sorted.length === 0 ? (
        <div className="quiet"><Icon name="road" size={20} /><p>Nothing reported on your route.</p></div>
      ) : (
        <ul className="ev-list">
          {sorted.map((e) => (
            <li key={e.id} className={fresh.has(e.id) ? 'is-new' : ''}>
              <article className={`ev ev-${e.kind} ${selected === e.id ? 'is-selected' : ''}`}>
                <span className="ev-icon"><Icon name={KIND[e.kind].icon} size={17} /></span>
                <div className="ev-main">
                  <p className="ev-kicker"><span>{KIND[e.kind].label}</span>{e.src === 'ab' && <span className="tag">511</span>}<span className="tnum">{kmIn(e.along)}</span></p>
                  <h3>{e.title}</h3>
                  {e.detail && <p className={`ev-detail ${open === e.id ? 'open' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)}>{e.detail}</p>}
                  <p className="ev-when">{when(e, now)}</p>
                </div>
                <button className="btn-icon btn-xs" onClick={() => onShow(e)} aria-label={`Show ${e.title} on the map`} title="Show on map"><Icon name="pin" size={16} /></button>
              </article>
            </li>
          ))}
        </ul>
      )}

      {segs.length > 0 && (
        <section className="roads">
          <h3 className="sub-h">Road conditions on your route <span className="tag">511</span></h3>
          <div className="cond-strip" aria-hidden>
            {segs.map(({ r, from, to }) => (
              <i key={r.id} style={{ background: GRADE_COLOR[roadGrade(r)], left: `${(from / route.distance) * 100}%`, width: `${Math.max(0.8, ((to - from) / route.distance) * 100)}%` }} />
            ))}
          </div>
          <div className="cond-scale mono"><span>Home</span><span>{km(route.distance)}</span></div>
          <RoadLegend present={segs.map((x) => roadGrade(x.r))} />
          <ol className="cond-list">
            {segs.map(({ r, from, to }) => (
              <li key={r.id} className={roadIsGood(r) ? 'good' : 'bad'} style={{ '--grade': GRADE_COLOR[roadGrade(r)] } as React.CSSProperties}>
                <button onClick={() => onShowRoad(r)} title="Show on the map">
                  <span className="cond-km tnum">{km(from).replace(' km', '')}–{km(to)}</span>
                  <span className="cond-main"><b>{r.hwy || r.condition}</b><small>{r.segment}</small></span>
                  <span className="cond-val">{[r.condition, ...r.extra].join(' · ')}{r.visibility && r.visibility !== 'Good' ? <small>Visibility {r.visibility.toLowerCase()}</small> : null}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      )}

      {byHwy.length > 0 && (
        <section className="roads">
          <h3 className="sub-h">Highway conditions <span className="tag">511</span></h3>
          {byHwy.map(({ h, rows }) => (
            <div key={h} className="road-group">
              <p className="road-hwy">{h}</p>
              <ul>
                {rows.map((r) => (
                  <li key={r.id} className={roadIsGood(r) ? 'good' : 'bad'}>
                    <span className="road-seg">{r.segment}</span>
                    <span className="road-cond">{[r.condition, ...r.extra].join(' · ')}</span>
                    {r.visibility && r.visibility !== 'Good' && <span className="road-vis">Visibility {r.visibility.toLowerCase()}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}
    </div>
  )
}

// What each road colour means. Grades seen on this route come first; the rest are dimmed.
export function RoadLegend({ present }: { present: string[] }) {
  return (
    <ul className="cond-legend" aria-label="Road condition colours">
      {GRADES.map((g) => (
        <li key={g.key} className={present.includes(g.key) ? 'is-here' : ''}><i style={{ background: g.color }} />{g.label}</li>
      ))}
      <li><i />City streets: no 511 report</li>
    </ul>
  )
}

export const AlertsPanel = memo(AlertsPanelView)
