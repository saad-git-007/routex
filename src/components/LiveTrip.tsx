import { AnimatePresence, motion } from 'motion/react'
import { km } from '../lib/geo'
import type { Route } from '../lib/types'
import { Icon } from './Icon'

// The trip as it's being driven: the next stop, how far and how long to it, and where you are between the last stop and it. Shown under the map while location is on and a route is planned; it folds down to one line.
export const ON_ROUTE_M = 300
const AT_STOP_M = 80

const minsLeft = (s: number) => (s < 60 ? 'under 1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`)

export function LiveTrip({ route, pos, follow, onFollow, open, setOpen, overlay = false }: {
  route: Route; pos: { along: number; off: number }
  follow: boolean; onFollow: () => void
  open: boolean; setOpen: (o: boolean) => void; overlay?: boolean
}) {
  const round = route.order.length > 2 && route.order[route.order.length - 1].id === route.order[0].id
  const name = (i: number) => (i === 0 || (round && i === route.order.length - 1) ? 'Home' : `D${i}`)
  const label = (i: number) => route.order[i].label.split(',')[0]
  const badge = (i: number) => <span className={`lt-badge ${name(i) === 'Home' ? 'is-home' : ''}`}>{name(i) === 'Home' ? <Icon name="home" size={12} /> : name(i)}</span>

  const off = pos.off > ON_ROUTE_M
  const along = Math.min(route.distance, Math.max(0, pos.along))
  let leg = 0
  while (leg + 1 < route.legStart.length && route.legStart[leg + 1] <= along) leg++
  const L = route.legs[leg], legFrom = route.legStart[leg]
  const inLeg = Math.max(0, along - legFrom), toNext = Math.max(0, L.distance - inLeg)
  const secs = (i: number, part: number) => (route.legs[i].distance ? (route.legs[i].duration * part) / route.legs[i].distance : 0)
  const toNextS = secs(leg, toNext)
  const done = route.distance - along < AT_STOP_M
  const pct = (m: number, of: number) => `${Math.min(100, (100 * m) / (of || 1))}%`

  const summary = off ? <b>You're {km(pos.off)} from your route</b>
    : done ? <b>You've arrived {round ? 'home' : `at ${name(route.order.length - 1)}`}</b>
    : <>{badge(leg + 1)}<b>{label(leg + 1)}</b><span className="tnum">{km(toNext)} · {minsLeft(toNextS)}</span></>

  return (
    <section className={`live ${overlay ? 'is-overlay' : ''} ${off ? 'is-off' : ''} ${open ? 'is-open' : ''}`} aria-label="Live trip">
      <div className="live-top">
        <button type="button" className="live-head" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="live-tag"><i />Live</span>
          <span className="live-sum">{summary}</span>
          <Icon name={open ? 'up' : 'down'} size={15} />
        </button>
        <button type="button" className={`btn-icon btn-xs live-follow ${follow ? 'is-on' : ''}`} aria-pressed={follow} onClick={onFollow}
          title={follow ? 'Following you on the map' : 'Keep the map on you'} aria-label={follow ? 'Following you on the map' : 'Keep the map on you'}>
          <Icon name="locate" size={16} />
        </button>
      </div>

      <AnimatePresence initial={false}>{open && (
        <motion.div className="live-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 34 }}>
          {off ? (
            <p className="live-note">Your progress shows here once you're on the route.</p>
          ) : (
            <>
              {/* Only the leg being driven: the last stop to the next, with you between them by distance. */}
              <div className="live-leg">
                {badge(leg)}
                <div className="live-legbar" role="img" aria-label={`${km(toNext)} and ${minsLeft(toNextS)} to ${label(leg + 1)}`}>
                  <span className="live-fill" style={{ width: pct(inLeg, L.distance) }} />
                  <span className="live-me" style={{ left: pct(inLeg, L.distance) }} />
                </div>
                {badge(leg + 1)}
              </div>
            </>
          )}
        </motion.div>
      )}</AnimatePresence>
    </section>
  )
}
