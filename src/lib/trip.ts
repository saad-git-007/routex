import type { OptimizeBy, Place, Route, TripShape } from './types'

export type SavedRoute = { id: string; name: string; home: Place; stops: Place[]; shape: TripShape; by: OptimizeBy; fav: boolean; saved: number }

// A place as a short name: the street number and street (or the place's name), without the city, province or postal code.
const POSTAL = /\b[A-Z]\d[A-Z] ?\d[A-Z]\d\b/i
const ABBR: Record<string, string> = {
  northwest: 'NW', northeast: 'NE', southwest: 'SW', southeast: 'SE', street: 'St', avenue: 'Ave', road: 'Rd', drive: 'Dr',
  boulevard: 'Blvd', trail: 'Tr', crescent: 'Cres', court: 'Crt', highway: 'Hwy', parkway: 'Pkwy',
}
const STREET = new RegExp(`\\b(${Object.keys(ABBR).join('|')})\\b`, 'gi')
export const shortLabel = (label: string) => {
  const first = label.split(',')[0].trim()
  if (new RegExp(`^${POSTAL.source}$`, 'i').test(first)) return first
  const parts = label.split(',').map((x) => x.replace(POSTAL, '').trim()).filter(Boolean)
  if (!parts.length) return label
  const name = /^\d+[A-Z]?$/i.test(parts[0]) && parts[1] ? `${parts[0]} ${parts[1]}` : parts[0]
  // Street words are shortened only in addresses ("123 Main Street Southwest"), never in a place's own name.
  return /^\d/.test(name) ? name.replace(STREET, (w) => ABBR[w.toLowerCase()]) : name
}
const short = (p: Place) => shortLabel(p.label)
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

// Apple Maps links take a start and one destination, so the first leg of the trip is handed over (in driving order).
export function appleMapsUrl(route: Route) {
  const pts = route.order.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`)
  return `https://maps.apple.com/?${new URLSearchParams({ saddr: pts[0], daddr: pts[1] ?? pts[0], dirflg: 'd' })}`
}
/** The Google Maps app's own link (iOS), with stops chained as "+to:" destinations. */
export function googleMapsAppUrl(route: Route) {
  const pts = route.order.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`)
  return `comgooglemaps://?saddr=${pts[0]}&daddr=${pts.slice(1, 11).join('+to:')}&directionsmode=driving`
}
/** iPhone and iPad (iPadOS reports itself as a Mac with touch). */
export const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)

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
