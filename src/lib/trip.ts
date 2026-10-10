import type { OptimizeBy, Place, Route, TripShape } from './types'

export type SavedRoute = { id: string; name: string; home: Place; stops: Place[]; shape: TripShape; by: OptimizeBy; fav: boolean; saved: number }

const short = (p: Place) => p.label.split(',')[0]
export const routeName = (_home: Place, stops: Place[]) => ['Home', ...stops.map(short)].join(' → ')

// Google Maps directions URL (free, no key). Stops go in the optimized order; Maps takes up to 9 waypoints.
export function googleMapsUrl(route: Route, shape: TripShape) {
  const pts = route.order.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`)
  const origin = pts[0], destination = pts[pts.length - 1]
  const waypoints = pts.slice(1, -1)
  const q = new URLSearchParams({ api: '1', origin, destination, travelmode: 'driving' })
  if (waypoints.length) q.set('waypoints', waypoints.slice(0, 9).join('|'))
  return { url: `https://www.google.com/maps/dir/?${q}`, dropped: Math.max(0, waypoints.length - 9), shape }
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)
// GPX 1.1: the stops as waypoints plus the driven line as a track, for Garmin, OsmAnd, Organic Maps and others.
export function gpx(route: Route, name: string) {
  const step = Math.max(1, Math.floor(route.coords.length / 2000))
  const trk = route.coords.filter((_, i) => i % step === 0 || i === route.coords.length - 1).map(([a, b]) => `<trkpt lat="${a.toFixed(6)}" lon="${b.toFixed(6)}"/>`).join('')
  const wpts = route.order.map((p, i) => `<wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${i === 0 ? 'Home' : i === route.order.length - 1 && p.id === route.order[0].id ? 'Home' : `${i}. ${esc(short(p))}`}</name><desc>${esc(p.label)}</desc></wpt>`).join('')
  return `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" creator="RouteX" xmlns="http://www.topografix.com/GPX/1/1"><metadata><name>${esc(name)}</name></metadata>${wpts}<trk><name>${esc(name)}</name><trkseg>${trk}</trkseg></trk></gpx>`
}

// A shareable link to this app with the trip in the URL hash (nothing is sent to a server).
type Packed = { h: [string, number, number]; s: [string, number, number][]; r: TripShape; b: OptimizeBy }
const pack = (p: Place): [string, number, number] => [p.label, +p.lat.toFixed(6), +p.lon.toFixed(6)]
export function tripLink(home: Place, stops: Place[], shape: TripShape, by: OptimizeBy) {
  const data: Packed = { h: pack(home), s: stops.map(pack), r: shape, b: by }
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${location.origin}/#trip=${b64}`
}
export function readTripLink(): { home: Place; stops: Place[]; shape: TripShape; by: OptimizeBy } | null {
  const m = location.hash.match(/trip=([\w-]+)/)
  if (!m) return null
  try {
    const d: Packed = JSON.parse(decodeURIComponent(escape(atob(m[1].replace(/-/g, '+').replace(/_/g, '/')))))
    const place = ([label, lat, lon]: [string, number, number]) => ({ id: crypto.randomUUID(), label: String(label), lat: +lat, lon: +lon })
    if (!Array.isArray(d.h) || !Array.isArray(d.s)) return null
    return { home: place(d.h), stops: d.s.slice(0, 25).map(place), shape: d.r === 'oneway' ? 'oneway' : 'round', by: d.b === 'time' ? 'time' : 'distance' }
  } catch { return null }
}
