import type { Province } from './cities'
import { cumulative } from './geo'
import type { Alert, Camera, Community, Place, RoadCondition, RoadEvent, OptimizeBy, Route, Station, TripShape, Weather } from './types'

// ── Our edge endpoints ──────────────────────────────────────────────────────────
async function get<T>(url: string, signal?: AbortSignal): Promise<T> {
  const r = await fetch(url, { signal })
  // OSRM answers "no route between these points" with a 400 and a code in the body.
  if (r.status === 400 && url.startsWith(OSRM)) { const j = await r.json().catch(() => null) as { code?: string } | null; if (j?.code && j.code !== 'Ok') throw new Error('No route') }
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json() as Promise<T>
}
// Alberta keeps its original addresses (so cached copies stay valid); other provinces add ?prov=.
const q = (prov: Province, ab: string) => (prov === 'ab' ? ab : `prov=${prov}`)
// A source can send a point with a missing coordinate; one of those reaching the map would take the whole page down.
const placed = <T extends { lat: number; lon: number }>(xs: T[]) => xs.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon))
export const fetchCameras = (prov: Province = 'ab') => get<{ cameras: Camera[] }>(`/api/cameras?${q(prov, 'ab=all&town=3')}`).then((r) => placed(r.cameras))
export const fetchEvents = (prov: Province = 'ab') => get<{ events: RoadEvent[]; alerts: Alert[]; updated: string }>(`/api/events?${q(prov, 'ab=all')}`).then((r) => ({ ...r, events: placed(r.events) }))
export const fetchCommunities = () => get<{ communities: Community[] }>('/api/communities').then((r) => r.communities)
export const fetchRoads = (prov: Province = 'ab') => get<{ roads: RoadCondition[]; stations: Station[] }>(`/api/roads?${q(prov, 'ab=all')}`)

// ── Esri World Geocoder (keyless suggest + find) ───────────────────────────────
const GEO = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer'
// Search across Canada; home (or the chosen city) only biases nearby suggestions.
let near = '-114.07,51.045'
export const setSearchNear = (lat: number, lon: number) => { near = `${lon.toFixed(4)},${lat.toFixed(4)}` }
export type Suggestion = { text: string; magicKey: string }

export async function suggest(text: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const q = new URLSearchParams({
    f: 'json', text, location: near, countryCode: 'CAN', maxSuggestions: '6',
    category: 'Address,POI,Postal,Neighborhood,Street Name',
  })
  const r = await get<{ suggestions?: Suggestion[] }>(`${GEO}/suggest?${q}`, signal)
  return (r.suggestions ?? []).filter((s) => !(s as { isCollection?: boolean }).isCollection)
}
export async function findPlace(s: Suggestion): Promise<Place | null> {
  const q = new URLSearchParams({ f: 'json', singleLine: s.text, magicKey: s.magicKey, countryCode: 'CAN', maxLocations: '1', outFields: 'PlaceName,ShortLabel' })
  const r = await get<{ candidates?: { address: string; location: { x: number; y: number }; attributes: { PlaceName?: string; ShortLabel?: string } }[] }>(`${GEO}/findAddressCandidates?${q}`)
  const c = r.candidates?.[0]
  if (!c) return null
  const label = c.attributes.PlaceName || c.attributes.ShortLabel || s.text.split(',')[0]
  return { id: crypto.randomUUID(), label, lat: c.location.y, lon: c.location.x }
}
export async function reverse(lat: number, lon: number): Promise<string> {
  const r = await get<{ address?: { ShortLabel?: string; Match_addr?: string } }>(`${GEO}/reverseGeocode?f=json&location=${lon},${lat}`)
  return r.address?.ShortLabel || r.address?.Match_addr || 'Dropped pin'
}

// ── OSRM (public demo server): duration table, best stop order, then the route ──
const OSRM = 'https://router.project-osrm.org'
const ll = (ps: Place[]) => ps.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';')

function permutations(n: number): number[][] {
  if (n === 0) return [[]]
  const out: number[][] = []
  const rec = (cur: number[], left: number[]) => {
    if (!left.length) return void out.push(cur)
    left.forEach((x, i) => rec([...cur, x], [...left.slice(0, i), ...left.slice(i + 1)]))
  }
  rec([], Array.from({ length: n }, (_, i) => i + 1))
  return out
}

/** Order stops 1..n (0 is home) for the shortest drive. Exact up to 8 stops, nearest-neighbour + 2-opt beyond. */
export function tourCost(d: number[][], p: number[], shape: TripShape) {
  let c = d[0][p[0]]
  for (let i = 1; i < p.length; i++) c += d[p[i - 1]][p[i]]
  return shape === 'round' ? c + d[p[p.length - 1]][0] : c
}

export function bestOrder(d: number[][], shape: TripShape): number[] {
  const n = d.length - 1
  const cost = (p: number[]) => tourCost(d, p, shape)
  if (n <= 8) return permutations(n).reduce((a, b) => (cost(b) < cost(a) ? b : a))
  const left = new Set(Array.from({ length: n }, (_, i) => i + 1))
  const p: number[] = []
  let at = 0
  while (left.size) {
    const next = [...left].reduce((a, b) => (d[at][b] < d[at][a] ? b : a))
    p.push(next); left.delete(next); at = next
  }
  for (let improved = true; improved; ) {
    improved = false
    for (let i = 0; i < p.length - 1; i++)
      for (let j = i + 1; j < p.length; j++) {
        const q = [...p.slice(0, i), ...p.slice(i, j + 1).reverse(), ...p.slice(j + 1)]
        if (cost(q) + 1 < cost(p)) { p.splice(0, p.length, ...q); improved = true }
      }
  }
  return p
}

const hwy = (ref: string) =>
  ref.split(/[;,]/).map((r) => r.trim().replace(/^(AB|Hwy|HWY|TCH)\s*/i, '')).filter((r) => /^\d{1,3}[A-Z]?$/i.test(r)).map((r) => `Hwy ${r.toUpperCase()}`)

// Routes are kept for the session (the last dozen), so switching between "My stops" and "Optimize route", or back to
// an earlier trip, is instant. The app also works out the other order in the background (see App).
const routes = new Map<string, Promise<Route>>()
const tables = new Map<string, Promise<{ durations: (number | null)[][]; distances: (number | null)[][] }>>()
function remember<T>(m: Map<string, Promise<T>>, key: string, make: () => Promise<T>) {
  let p = m.get(key)
  if (!p) {
    p = make(); m.set(key, p); p.catch(() => m.delete(key))
    if (m.size > 12) m.delete(m.keys().next().value!)
  }
  return p
}
export function planRoute(home: Place, stops: Place[], shape: TripShape, by: OptimizeBy = 'distance', keep = false, signal?: AbortSignal): Promise<Route> {
  const key = JSON.stringify([ll([home, ...stops]), stops.map((s) => s.id), shape, by, keep])
  const p = remember(routes, key, () => buildRoute(home, stops, shape, by, keep))
  if (!signal) return p
  return new Promise((res, rej) => {
    signal.addEventListener('abort', () => rej(new DOMException('Aborted', 'AbortError')), { once: true })
    p.then(res, rej)
  })
}

async function buildRoute(home: Place, stops: Place[], shape: TripShape, by: OptimizeBy, keep: boolean, signal?: AbortSignal): Promise<Route> {
  let ordered = stops
  let opt: Route['opt'] = null
  if (stops.length > 1) {
    // One OSRM table call gives the drive between every pair of places; the order is then solved locally.
    const t = await remember(tables, ll([home, ...stops]), () => get<{ durations: (number | null)[][]; distances: (number | null)[][] }>(`${OSRM}/table/v1/driving/${ll([home, ...stops])}?annotations=duration,distance`, signal))
    const m = (by === 'distance' ? t.distances : t.durations).map((row) => row.map((x) => (x == null ? 1e9 : x)))
    const best = bestOrder(m, shape)
    const entered = stops.map((_, i) => i + 1)
    // Either the order the stops were added in, or the shortest one; both costs are kept so the planner can compare.
    if (!keep) ordered = best.map((i) => stops[i - 1])
    opt = { by, best: tourCost(m, best, shape), entered: tourCost(m, entered, shape), exact: stops.length <= 8, reordered: best.some((v, i) => v !== i + 1), kept: keep }
  }
  const order = shape === 'round' ? [home, ...ordered, home] : [home, ...ordered]
  type OsrmRoute = { duration: number; distance: number; geometry: { coordinates: [number, number][] }; legs: { duration: number; distance: number; steps: { ref?: string }[] }[] }
  const r = await get<{ code: string; routes: OsrmRoute[] }>(`${OSRM}/route/v1/driving/${ll(order)}?overview=full&geometries=geojson&steps=true`, signal)
  if (r.code !== 'Ok' || !r.routes[0]) throw new Error('No route')
  const best = r.routes[0]
  const coords = best.geometry.coordinates.map(([x, y]) => [y, x] as [number, number])
  const legs = best.legs.map((l, i) => ({ from: order[i], to: order[i + 1], duration: l.duration, distance: l.distance }))
  const legStart = legs.reduce<number[]>((acc, _l, i) => (acc.push(i ? acc[i - 1] + legs[i - 1].distance : 0), acc), [])
  const highways = [...new Set(best.legs.flatMap((l) => l.steps.flatMap((s) => (s.ref ? hwy(s.ref) : []))))]
  return { order, coords, cum: cumulative(coords), legs, legStart, duration: best.duration, distance: best.distance, highways, opt }
}

// ── Open-Meteo (keyless): current weather at points along the route ────────────
export async function fetchWeather(points: { lat: number; lon: number; label: string; along: number }[]): Promise<Weather[]> {
  if (!points.length) return []
  const q = new URLSearchParams({
    latitude: points.map((p) => p.lat.toFixed(3)).join(','),
    longitude: points.map((p) => p.lon.toFixed(3)).join(','),
    current: 'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_gusts_10m,precipitation,snowfall,visibility',
    hourly: 'precipitation_probability', forecast_hours: '3', timezone: 'America/Edmonton',
  })
  type One = { current: Record<string, number>; hourly?: { precipitation_probability: (number | null)[] } }
  const r = await get<One | One[]>(`https://api.open-meteo.com/v1/forecast?${q}`)
  const arr = Array.isArray(r) ? r : [r]
  return arr.map((w, i) => ({
    ...points[i],
    temp: w.current.temperature_2m, feels: w.current.apparent_temperature, code: w.current.weather_code,
    wind: w.current.wind_speed_10m, gusts: w.current.wind_gusts_10m, precip: w.current.precipitation, snow: w.current.snowfall,
    visibility: w.current.visibility, nextPrecip: Math.max(0, ...(w.hourly?.precipitation_probability ?? []).map((x) => x ?? 0)),
  }))
}

// ── A small satellite picture of a place (Esri World Imagery export, keyless) ──
export function satThumb(lat: number, lon: number, w = 480, h = 200) {
  const dLat = 0.0016, dLon = (dLat * (w / h)) / Math.cos((lat * Math.PI) / 180)
  const q = new URLSearchParams({ bbox: [lon - dLon, lat - dLat, lon + dLon, lat + dLat].map((v) => v.toFixed(6)).join(','), bboxSR: '4326', imageSR: '3857', size: `${w},${h}`, format: 'jpg', f: 'image' })
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${q}`
}
