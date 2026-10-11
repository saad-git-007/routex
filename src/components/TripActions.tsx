import { useState, type MouseEvent } from 'react'
import { appleMapsUrl, googleMapsAppUrl, googleMapsUrl, isApple, routeName, tripLink, type SavedRoute } from '../lib/trip'
import type { OptimizeBy, Place, Route, TripShape } from '../lib/types'
import { Icon } from './Icon'

// Save, favourite, share and export the current trip.
export function TripActions({ route, home, stops, shape, by, routes, setRoutes }: {
  route: Route; home: Place; stops: Place[]; shape: TripShape; by: OptimizeBy
  routes: SavedRoute[]; setRoutes: (f: (r: SavedRoute[]) => SavedRoute[]) => void
}) {
  const [note, setNote] = useState('')
  const flash = (t: string) => { setNote(t); setTimeout(() => setNote(''), 2400) }
  const sig = (h: Place, s: Place[], sh: TripShape) => [h, ...s].map((p) => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join(';') + sh
  const mine = routes.find((r) => sig(r.home, r.stops, r.shape) === sig(home, stops, shape))
  const name = routeName(home, route.order.slice(1, shape === 'round' ? -1 : undefined))
  const gm = googleMapsUrl(route, shape)

  const save = () => {
    if (mine) { setRoutes((rs) => rs.filter((r) => r.id !== mine.id)); flash('Removed from saved routes'); return }
    setRoutes((rs) => [{ id: crypto.randomUUID(), name, home, stops, shape, by, fav: false, saved: Date.now() }, ...rs])
    flash('Saved in this browser')
  }
  // On iPhone, try the Google Maps app; if it isn't installed the page never hides, so Apple Maps opens instead.
  const openMaps = (e: MouseEvent) => {
    if (!isApple()) return
    e.preventDefault()
    let left = false
    const hide = () => { left = true }
    document.addEventListener('visibilitychange', hide, { once: true })
    window.location.href = googleMapsAppUrl(route)
    setTimeout(() => { document.removeEventListener('visibilitychange', hide); if (!left && !document.hidden) window.location.href = appleMapsUrl(route) }, 1200)
  }
  const share = async () => {
    const url = tripLink(home, stops, shape, by)
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { try { await navigator.share({ title: name, url }); return } catch { /* cancelled */ } }
    try { await navigator.clipboard.writeText(url); flash('Trip link copied') } catch { prompt('Copy this link', url) }
  }

  return (
    <div className="trip-actions" aria-label="Trip actions">
      <button className={`btn-sm ${mine ? 'is-on' : ''}`} aria-pressed={!!mine} onClick={save} title={mine ? 'Remove from saved routes' : 'Save this route in this browser'}>
        <Icon name="bookmark" size={15} fill={!!mine} /> {mine ? 'Saved' : <>Save<span className="ta-more"> route</span></>}
      </button>
      <a className="btn-sm btn-link" href={gm.url} target="_blank" rel="noopener" onClick={openMaps} title={gm.dropped ? `Google Maps takes 9 stops in between; the last ${gm.dropped} are left out` : 'Open the route in Google Maps (on iPhone, Apple Maps if Google Maps isn\'t installed)'}>
        <Icon name="external" size={15} /> <span><span className="ta-more">Open in </span>Maps</span>
      </a>
      <button className="btn-sm" onClick={share} title="Copy a link that opens this trip"><Icon name="share" size={15} /> <span>Share<span className="ta-more"> route</span></span></button>
      <span className="trip-note" role="status">{note}</span>
    </div>
  )
}

// Saved routes, favourites first; tap to load.
export function SavedRoutes({ routes, setRoutes, onLoad }: { routes: SavedRoute[]; setRoutes: (f: (r: SavedRoute[]) => SavedRoute[]) => void; onLoad: (r: SavedRoute) => void }) {
  if (!routes.length) return null
  const list = [...routes].sort((a, b) => +b.fav - +a.fav || b.saved - a.saved)
  return (
    <section className="saved-routes card" aria-label="Saved routes">
      <p className="eyebrow-sm">Saved routes</p>
      <ul>
        {list.map((r) => (
          <li key={r.id}>
            <button className={`btn-icon btn-xs ${r.fav ? 'is-on' : ''}`} aria-pressed={r.fav} aria-label={r.fav ? 'Unfavourite' : 'Favourite'} title={r.fav ? 'Favourite' : 'Make favourite'} onClick={() => setRoutes((rs) => rs.map((x) => (x.id === r.id ? { ...x, fav: !x.fav } : x)))}>
              <Icon name="star" size={15} fill={r.fav} />
            </button>
            <button className="saved-route" onClick={() => onLoad(r)} title={`Load ${r.name}`}>
              <span>{r.name}</span>
              <small>{r.stops.length} stop{r.stops.length === 1 ? '' : 's'} · {r.shape === 'round' ? 'round trip' : 'one way'}</small>
            </button>
            <button className="btn-icon btn-xs" aria-label={`Delete ${r.name}`} title="Delete" onClick={() => setRoutes((rs) => rs.filter((x) => x.id !== r.id))}><Icon name="x" size={15} /></button>
          </li>
        ))}
      </ul>
    </section>
  )
}
