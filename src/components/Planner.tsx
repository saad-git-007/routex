import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react'
import { memo, useEffect, useState, type ReactNode } from 'react'
import { satThumb } from '../lib/api'
import { km } from '../lib/geo'
import { shortLabel } from '../lib/trip'
import type { Place, Route, TripShape } from '../lib/types'
import { AddressSearch } from './AddressSearch'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

type Props = {
  home: Place | null; setHome: (p: Place | null) => void
  stops: Place[]; setStops: (f: (s: Place[]) => Place[]) => void
  saved: Place[]; setSaved: (f: (s: Place[]) => Place[]) => void
  shape: TripShape; setShape: (s: TripShape) => void
  keepOrder: boolean; setKeepOrder: (k: boolean) => void
  route: Route | null; routing: boolean; error: string
  onFocus: (p: Place) => void
}

const near = (a: Place, b: Place) => Math.abs(a.lat - b.lat) < 1e-4 && Math.abs(a.lon - b.lon) < 1e-4

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

function PlannerView({ home, setHome, stops, setStops, saved, setSaved, shape, setShape, keepOrder, setKeepOrder, route, routing, error, onFocus }: Props) {
  const [editHome, setEditHome] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  // Show stops in the order they'll be driven once a route exists.
  const ordered = route ? route.order.slice(1, shape === 'round' ? -1 : undefined).map((p) => stops.find((s) => s.id === p.id)).filter((s): s is Place => !!s) : stops
  // In "My stops" the list is the stops as you put them (so dragging one never waits for the route to come back).
  const list = keepOrder || ordered.length !== stops.length ? stops : ordered
  // Dragging a stop sets your own order, so the planner switches to "My stops".
  const reorder = (next: Place[]) => { if (!keepOrder) setKeepOrder(true); setStops(() => next) }
  const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= list.length) return; const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; reorder(next) }
  const isSaved = (p: Place) => saved.some((s) => near(s, p))
  const addStop = (p: Place) => setStops((s) => (s.some((x) => near(x, p)) ? s : [...s, p]))
  // Arrival at each stop if you left now (OSRM typical-traffic durations).
  const arrive = route ? route.legs.reduce<number[]>((a, l) => (a.push((a[a.length - 1] ?? Date.now()) + l.duration * 1000), a), []) : []
  const routeMatches = ordered.length === stops.length && !!route
  const opt = routeMatches ? route.opt : null
  // After the stops are put in the shortest order, say so for a few seconds.
  const [done, setDone] = useState('')
  useEffect(() => {
    if (!opt || opt.kept || routing) return
    const saved = opt.reordered ? opt.entered - opt.best : 0
    setDone(saved > 50 ? `Route optimized: you save ${(saved / 1000).toFixed(1)} km with the shortest route` : 'Route optimized: your stops were already in the shortest order')
    const t = setTimeout(() => setDone(''), 3500)
    return () => clearTimeout(t)
  }, [opt, routing])
  const quick = saved.filter((p) => !stops.some((s) => near(s, p)) && !(home && near(home, p)))

  return (
    <section className="planner card" aria-label="Trip">
      {home && stops.length > 1 && (
        <div className="opt-choice">
          <Segmented
            label="Stop order" value={keepOrder ? 'mine' : 'best'} onChange={(v) => setKeepOrder(v === 'mine')}
            options={[{ value: 'mine', label: 'My stops' }, { value: 'best', label: 'Optimize route' }]}
          />
          <AnimatePresence>{(done || (routing && !keepOrder)) && (
            <motion.div key="opt" className={`opt-note ${routing ? 'is-busy' : ''}`} role="status"
              initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.25 } }}>
              <Icon name={routing ? 'route' : 'check'} size={15} />
              <p>{routing ? <span className="shiny">Optimizing {stops.length} stops…</span> : done}</p>
            </motion.div>
          )}</AnimatePresence>
        </div>
      )}
      <div className="planner-home">
        <span className="node node-home"><Icon name="home" size={16} /></span>
        {home && !editHome ? (
          <>
            <div className="planner-place">
              <span className="eyebrow-sm">Home</span>
              <b title={home.label}>{shortLabel(home.label)}</b>
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
          {routing && <div className="progress-line" aria-label="Finding the route" />}
          <Reorder.Group as="ol" axis="y" values={list} onReorder={reorder} className={`stops ${routing ? 'is-busy' : ''}`} aria-busy={routing} aria-label="Stops in driving order">
            <AnimatePresence initial={false}>
              {list.map((p, i) => {
                const leg = routeMatches ? route.legs[i] : undefined
                const isOpen = open === p.id
                return (
                  <StopItem key={p.id} p={p} open={isOpen} canMove={list.length > 1} onMove={(d) => move(i, d)} label={shortLabel(p.label)} first={i === 0} last={i === list.length - 1} row={<>
                    <span className="node">D{i + 1}</span>
                    <button className="stop-main" aria-expanded={isOpen} onClick={() => { setOpen(isOpen ? null : p.id); if (!isOpen) onFocus(p) }}>
                      <span className="stop-label" title={p.label}>{shortLabel(p.label)}</span>
                      <span className="stop-meta tnum">
                        {leg ? <><span>{Math.round(leg.duration / 60)} min · {km(leg.distance)}</span> <span>from {i === 0 ? 'Home' : `D${i}`}</span> <span>· arrive {clock(arrive[i])}</span></> : p.label.split(',').slice(1, 3).join(',') || 'Destination'}
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
                  </>}>
                    <AnimatePresence initial={false}>{isOpen && (
                      <motion.div className="stop-preview-wrap" initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0, transition: { duration: 0.16, ease: [0.77, 0, 0.175, 1] } }} transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.6 }}>
                      <div className="stop-preview">
                        <div className="stop-sat"><img src={satThumb(p.lat, p.lon)} alt={`Satellite view of ${p.label}`} loading="lazy" /><i aria-hidden>D{i + 1}</i></div>
                        <p>{p.label}</p>
                        {leg && <p className="stop-meta tnum">Stop {i + 1} of {list.length} · from {i === 0 ? 'home' : shortLabel(list[i - 1].label)}</p>}
                      </div>
                      </motion.div>
                    )}</AnimatePresence>
                  </StopItem>
                )
              })}
            </AnimatePresence>
            {shape === 'round' && list.length > 0 && (
              <li className="stop-return"><div className="stop-row"><span className="node node-home node-return"><Icon name="home" size={14} /></span><span className="stop-main is-static"><span className="stop-label">Back home</span>{routeMatches && <span className="stop-meta tnum"><span>{Math.round(route.legs[route.legs.length - 1].duration / 60)} min · {km(route.legs[route.legs.length - 1].distance)}</span> <span>from D{list.length}</span> <span>· arrive {clock(arrive[arrive.length - 1])}</span></span>}</span></div></li>
            )}
          </Reorder.Group>

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
          {error && <p className="error-line"><Icon name="alert" size={15} /> {error}</p>}
        </>
      )}
    </section>
  )
}

// One stop in the list. It drags only by its handle, so taps and scrolling on the rest of the row work as usual;
// the handle also moves it with the arrow keys.
function StopItem({ p, open, canMove, onMove, label, first, last, row, children }: {
  p: Place; open: boolean; canMove: boolean; onMove: (d: number) => void; label: string; first: boolean; last: boolean; row: ReactNode; children: ReactNode
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={p} dragListener={false} dragControls={controls}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ layout: { type: 'spring', stiffness: 360, damping: 32, mass: 0.6 }, opacity: { duration: 0.2, ease: [0.16, 1, 0.3, 1] } }}
      whileDrag={{ scale: 1.02, backgroundColor: 'rgba(24,31,44,.98)', boxShadow: '0 10px 30px rgba(0,0,0,.45)', zIndex: 5 }}
      className={`${open ? 'is-open' : ''} ${canMove ? 'can-move' : ''}`}
    >
      <div className="stop-row">
        {row}
        {canMove && (
          <button type="button" className="stop-grip" onPointerDown={(e) => { e.preventDefault(); controls.start(e) }}
            onKeyDown={(e) => { if (e.key === 'ArrowUp' && !first) { e.preventDefault(); onMove(-1) } if (e.key === 'ArrowDown' && !last) { e.preventDefault(); onMove(1) } }}
            aria-label={`Move ${label}: drag, or use the arrow keys`} title="Drag to change the order">
            <Icon name="grip" size={18} />
          </button>
        )}
      </div>
      {children}
    </Reorder.Item>
  )
}

export const Planner = memo(PlannerView)
