import { km } from '../lib/geo'
import type { Camera, OnRoute, Route } from '../lib/types'
import { Icon } from './Icon'

// The trip as it's being driven: where you are between your stops, how far and how long to the next one, and the next
// camera ahead. Shown on the map while location is on and a route is planned.
export const ON_ROUTE_M = 300
const AT_STOP_M = 80

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const minsLeft = (s: number) => (s < 60 ? 'under 1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`)

export function LiveTrip({ route, pos, cams, follow, onFollow, onCam }: {
  route: Route; pos: { along: number; off: number }; cams: OnRoute<Camera>[]
  follow: boolean; onFollow: () => void; onCam: (id: string) => void
}) {
  const round = route.order.length > 2 && route.order[route.order.length - 1].id === route.order[0].id
  const name = (i: number) => (i === 0 || (round && i === route.order.length - 1) ? 'Home' : `D${i}`)
  const label = (i: number) => route.order[i].label.split(',')[0]

  if (pos.off > ON_ROUTE_M) {
    return (
      <section className="live is-off" aria-live="polite">
        <div className="live-top">
          <span className="live-tag"><i />Live</span>
          <p className="live-next"><b>You're {km(pos.off)} from your route</b><small>Your progress shows here once you're on it.</small></p>
          <FollowBtn follow={follow} onFollow={onFollow} />
        </div>
      </section>
    )
  }

  const along = Math.min(route.distance, Math.max(0, pos.along))
  let leg = 0
  while (leg + 1 < route.legStart.length && route.legStart[leg + 1] <= along) leg++
  const L = route.legs[leg], legEnd = route.legStart[leg] + L.distance
  const toNext = Math.max(0, legEnd - along)
  const atStop = along - route.legStart[leg] < AT_STOP_M && leg > 0
  const secs = (i: number, part: number) => (route.legs[i].distance ? (route.legs[i].duration * part) / route.legs[i].distance : 0)
  const toNextS = secs(leg, toNext)
  const leftS = toNextS + route.legs.slice(leg + 1).reduce((a, l) => a + l.duration, 0)
  const done = route.distance - along < AT_STOP_M
  const nextCam = cams.find((c) => c.along > along + 30)
  const pct = (m: number) => `${(100 * m) / route.distance}%`

  return (
    <section className="live" aria-live="polite">
      <div className="live-top">
        <span className="live-tag"><i />Live</span>
        {done ? (
          <p className="live-next"><b>You've arrived {round ? 'home' : `at ${name(route.order.length - 1)}`}</b><small>{label(route.order.length - 1)}</small></p>
        ) : (
          <p className="live-next">
            <b><span className={`lt-badge ${name(leg + 1) === 'Home' ? 'is-home' : ''}`}>{name(leg + 1) === 'Home' ? <Icon name="home" size={12} /> : name(leg + 1)}</span>{label(leg + 1)}</b>
            <small className="tnum">
              {atStop ? <>Leaving {name(leg)} · </> : null}{km(toNext)} · {minsLeft(toNextS)} · <span className="lt-arr">arrive </span>{clock(Date.now() + toNextS * 1000)}
            </small>
          </p>
        )}
        <FollowBtn follow={follow} onFollow={onFollow} />
      </div>

      <div className="live-bar" role="img" aria-label={`${km(along)} of ${km(route.distance)} driven`}>
        <span className="live-fill" style={{ width: pct(along) }} />
        {route.legStart.map((s, i) => (
          <span key={i} className={`live-stop ${name(i + 1) === 'Home' ? 'is-home' : ''} ${s + route.legs[i].distance <= along ? 'is-past' : ''} ${i === leg ? 'is-next' : ''}`} style={{ left: pct(s + route.legs[i].distance) }} title={label(i + 1)}>
            {name(i + 1) === 'Home' ? <Icon name="home" size={9} /> : name(i + 1)}
          </span>
        ))}
        <span className="live-start"><Icon name="home" size={9} /></span>
        <span className="live-me" style={{ left: pct(along) }} />
      </div>

      <div className="live-foot tnum">
        <span>{done ? 'Trip complete' : <>{km(route.distance - along)} left · {minsLeft(leftS)}{route.legs.length - leg > 1 ? ` · ${route.legs.length - leg - 1} more stop${route.legs.length - leg - 1 > 1 ? 's' : ''} after this` : ''}</>}</span>
        {nextCam && !done && (
          <button className="live-cam" onClick={() => onCam(nextCam.id)} title={`Show ${nextCam.name}`}>
            <Icon name="cctv" size={14} /><span>Next camera in {km(nextCam.along - along)}</span><Icon name="chevron" size={13} />
          </button>
        )}
      </div>
    </section>
  )
}

function FollowBtn({ follow, onFollow }: { follow: boolean; onFollow: () => void }) {
  return (
    <button className={`btn-icon btn-xs live-follow ${follow ? 'is-on' : ''}`} aria-pressed={follow} onClick={onFollow}
      title={follow ? 'Following you on the map' : 'Keep the map on you'} aria-label={follow ? 'Following you on the map' : 'Keep the map on you'}>
      <Icon name="locate" size={16} />
    </button>
  )
}
