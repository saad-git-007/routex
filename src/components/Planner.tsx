import { AnimatePresence, motion } from 'motion/react'
import { useState } from 'react'
import { satThumb } from '../lib/api'
import { km } from '../lib/geo'
import type { OptimizeBy, Place, Route, TripShape } from '../lib/types'
import { AddressSearch } from './AddressSearch'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

type Props = {
  home: Place | null; setHome: (p: Place | null) => void
  stops: Place[]; setStops: (f: (s: Place[]) => Place[]) => void
  saved: Place[]; setSaved: (f: (s: Place[]) => Place[]) => void
  shape: TripShape; setShape: (s: TripShape) => void
  route: Route | null; routing: boolean; error: string
  onFocus: (p: Place) => void
}

const near = (a: Place, b: Place) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const cost = (by: OptimizeBy, v: number) => (by === 'distance' ? km(v) : `${Math.max(1, Math.round(v / 60))} min`)

export function Planner({ home, setHome, stops, setStops, saved, setSaved, shape, setShape, route, routing, error, onFocus }: Props) {
  const [editHome, setEditHome] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  // Show stops in the order they'll be driven once a route exists.
  const ordered = route ? route.order.slice(1, shape === 'round' ? -1 : undefined).map((p) => stops.find((s) => s.id === p.id)).filter((s): s is Place => !!s) : stops
  const list = ordered.length === stops.length ? ordered : stops
  const isSaved = (p: Place) => saved.some((s) => near(s, p))
  const addStop = (p: Place) => setStops((s) => (s.some((x) => near(x, p)) ? s : [...s, p]))
  // Arrival at each stop if you left now (OSRM typical-traffic durations).
  const arrive = route ? route.legs.reduce<number[]>((a, l) => (a.push((a[a.length - 1] ?? Date.now()) + l.duration * 1000), a), []) : []
  const routeMatches = ordered.length === stops.length && !!route
  const opt = routeMatches ? route.opt : null
  const quick = saved.filter((p) => !stops.some((s) => near(s, p)) && !(home && near(home, p)))

  return (
    <section className="planner card" aria-label="Trip">
      <div className="planner-home">
        <span className="node node-home"><Icon name="home" size={16} /></span>
        {home && !editHome ? (
          <>
            <div className="planner-place">
              <span className="eyebrow-sm">Home</span>
              <b>{home.label}</b>
            </div>
            <button className="btn-icon" onClick={() => setEditHome(true)} aria-label="Change home" title="Change home"><Icon name="edit" size={16} /></button>
          </>
        ) : (
          <div className="planner-grow">
            <AddressSearch placeholder="Set your home address" locate autoFocus={editHome} onPick={(p) => { setHome(p); setEditHome(false) }} />
            {editHome && <button className="btn-ghost btn-sm" onClick={() => setEditHome(false)}>Cancel</button>}
          </div>
        )}
      </div>

      {home && (
        <>
          {stops.length > 1 && (
            <div className={`opt-note ${routing ? 'is-busy' : ''}`} aria-live="polite">
              <Icon name={routing ? 'route' : 'check'} size={15} />
              <p>
                {routing ? <span className="shiny">Finding the best order for {stops.length} stops…</span>
                  : opt ? (opt.reordered && opt.entered - opt.best > (opt.by === 'distance' ? 50 : 30)
                    ? <>Reordered for the {opt.by === 'distance' ? 'shortest drive' : 'quickest drive'}, saves <b>{cost(opt.by, opt.entered - opt.best)}</b> vs. the order you added them</>
                    : <>Already in the {opt.by === 'distance' ? 'shortest' : 'quickest'} order</>)
                  : <>Working out the order…</>}
              </p>
            </div>
          )}
          <ol className="stops" aria-label="Stops in driving order">
            <AnimatePresence initial={false}>
              {list.map((p, i) => {
                const leg = routeMatches ? route.legs[i] : undefined
                const isOpen = open === p.id
                return (
                  <motion.li
                    key={p.id}
                    layout="position"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0, transition: { duration: 0.12 } }}
                    transition={{ layout: { type: 'spring', stiffness: 360, damping: 32, mass: 0.6 }, opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
                    className={isOpen ? 'is-open' : ''}
                  >
                    <div className="stop-row">
                      <span className="node">S{i + 1}</span>
                      <button className="stop-main" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : p.id); if (!isOpen) onFocus(p) }}>
                        <span className="stop-label">{p.label.split(',')[0]}</span>
                        <span className="stop-meta tnum">
                          {leg ? <>{Math.round(leg.duration / 60)} min · {km(leg.distance)} · arrive {clock(arrive[i])}</> : p.label.split(',').slice(1, 3).join(',') || 'Destination'}
                        </span>
                      </button>
                      <button
                        className={`btn-icon btn-xs ${isSaved(p) ? 'is-on' : ''}`}
                        aria-pressed={isSaved(p)}
                        aria-label={isSaved(p) ? `Unsave ${p.label}` : `Save ${p.label}`}
                        title={isSaved(p) ? 'Saved' : 'Save place'}
                        onClick={() => setSaved((s) => (isSaved(p) ? s.filter((x) => !near(x, p)) : [...s, { ...p, id: crypto.randomUUID() }]))}
                      >
                        <Icon name="star" size={15} fill={isSaved(p)} />
                      </button>
                      <button className="btn-icon btn-xs" aria-label={`Remove ${p.label}`} title="Remove" onClick={() => setStops((s) => s.filter((x) => x.id !== p.id))}>
                        <Icon name="x" size={15} />
                      </button>
                    </div>
                    <AnimatePresence initial={false}>{isOpen && (
                      <motion.div className="stop-preview-wrap" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0, transition: { duration: 0.16, ease: [0.77, 0, 0.175, 1] } }} transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.6 }}>
                      <div className="stop-preview">
                        <div className="stop-sat"><img src={satThumb(p.lat, p.lon)} alt={`Satellite view of ${p.label}`} loading="lazy" /><i aria-hidden>S{i + 1}</i></div>
                        <p>{p.label}</p>
                        {leg && <p className="stop-meta tnum">Stop {i + 1} of {list.length} · from {i === 0 ? 'home' : list[i - 1].label.split(',')[0]}</p>}
                      </div>
                      </motion.div>
                    )}</AnimatePresence>
                  </motion.li>
                )
              })}
            </AnimatePresence>
            {shape === 'round' && list.length > 0 && (
              <li className="stop-return"><div className="stop-row"><span className="node node-home node-ghost"><Icon name="home" size={13} /></span><span className="stop-main is-static"><span className="stop-label">Back home</span>{routeMatches && <span className="stop-meta tnum">{Math.round(route.legs[route.legs.length - 1].duration / 60)} min · {km(route.legs[route.legs.length - 1].distance)} · arrive {clock(arrive[arrive.length - 1])}</span>}</span></div></li>
            )}
          </ol>

          <AddressSearch big placeholder={stops.length ? 'Add another destination' : 'Where are you driving?'} onPick={addStop} />

          {quick.length > 0 && (
            <div className="saved" aria-label="Saved places">
              {quick.map((p) => (
                <button key={p.id} className="chip" onClick={() => addStop({ ...p, id: crypto.randomUUID() })} title={`Add ${p.label}`}>
                  <Icon name="star" size={13} fill /> {p.label}
                </button>
              ))}
            </div>
          )}

          <div className="planner-opts">
            <Segmented
              label="Trip shape"
              value={shape}
              onChange={setShape}
              options={[
                { value: 'round', label: <><Icon name="round" size={15} /> Round trip</> },
                { value: 'oneway', label: <><Icon name="oneway" size={15} /> One way</> },
              ]}
            />
          </div>
          {routing && stops.length < 2 && <div className="progress-line" aria-label="Finding the route" />}
          {error && <p className="error-line"><Icon name="alert" size={15} /> {error}</p>}
        </>
      )}
    </section>
  )
}
