import type { OnRoute, Route } from './types'

const R = 6371000, K = Math.PI / 180

export function metres(aLat: number, aLon: number, bLat: number, bLon: number) {
  const dLat = (bLat - aLat) * K, dLon = (bLon - aLon) * K
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * K) * Math.cos(bLat * K) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

export function cumulative(coords: [number, number][]) {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + metres(coords[i - 1][0], coords[i - 1][1], coords[i][0], coords[i][1]))
  return cum
}

// ── A grid over the route's segments (about 550 m cells), built once per route, so "how far is this point from the
// route" only looks at the segments nearby instead of all of them. ──
const CELL = 0.005
type Grid = { kx: number; cells: Map<number, number[]>; all: number[] }
const grids = new WeakMap<Route, Grid>()
const cellKey = (y: number, x: number) => y * 100003 + x
function gridOf(route: Route): Grid {
  let g = grids.get(route)
  if (g) return g
  const { coords } = route
  const kx = Math.cos((coords[0]?.[0] ?? 50) * K)
  const cells = new Map<number, number[]>()
  for (let i = 1; i < coords.length; i++) {
    const [aLat, aLon] = coords[i - 1], [bLat, bLon] = coords[i]
    const y0 = Math.floor(Math.min(aLat, bLat) / CELL), y1 = Math.floor(Math.max(aLat, bLat) / CELL)
    const x0 = Math.floor((Math.min(aLon, bLon) * kx) / CELL), x1 = Math.floor((Math.max(aLon, bLon) * kx) / CELL)
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const k = cellKey(y, x), l = cells.get(k)
      if (l) l.push(i); else cells.set(k, [i])
    }
  }
  g = { kx, cells, all: coords.map((_, i) => i).slice(1) }
  grids.set(route, g)
  return g
}
/** Segment indices (ascending, i.e. in driving order) within about `radius` metres of a point. */
function nearSegments(route: Route, lat: number, lon: number, radius: number) {
  const g = gridOf(route)
  const r = Math.ceil(radius / 550) + 1
  const y = Math.floor(lat / CELL), x = Math.floor((lon * g.kx) / CELL)
  const out = new Set<number>()
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const l = g.cells.get(cellKey(y + dy, x + dx))
    if (l) for (const i of l) out.add(i)
  }
  return [...out].sort((a, b) => a - b)
}

/**
 * Where a point meets the route: distance off the line and metres along it. On a round trip a camera can be passed
 * twice; the first pass within `radius` wins so cards follow the order you drive them. With `far` off, points nowhere
 * near the route come back as Infinity off (cheap); with it on, the true distance is worked out.
 */
export function project(route: Route, lat: number, lon: number, radius: number, far = true) {
  const near = nearSegments(route, lat, lon, radius)
  const hit = near.length ? scan(route, lat, lon, radius, near) : { off: Infinity, along: 0 }
  if (hit.off <= radius || !far) return hit
  return scan(route, lat, lon, radius, gridOf(route).all)
}
function scan(route: Route, lat: number, lon: number, radius: number, idx: number[]) {
  const { coords, cum } = route
  const cosLat = Math.cos(lat * K)
  let best = { off: Infinity, along: 0 }
  let first: { off: number; along: number } | null = null
  for (const i of idx) {
    const [aLat, aLon] = coords[i - 1], [bLat, bLon] = coords[i]
    // Local equirectangular projection around the point, in metres.
    const ax = (aLon - lon) * K * cosLat * R, ay = (aLat - lat) * K * R
    const bx = (bLon - lon) * K * cosLat * R, by = (bLat - lat) * K * R
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    const off = Math.hypot(ax + t * dx, ay + t * dy)
    const along = cum[i - 1] + t * (cum[i] - cum[i - 1])
    if (off < best.off) best = { off, along }
    // Within the first pass that comes inside the radius, keep its closest point.
    if (off <= radius && (!first || (off < first.off && along - first.along < 3000))) first = { off, along }
    // Once that pass is well behind us, a later pass (the drive home) doesn't matter.
    if (first && off > radius * 4 && along - first.along > 3000) break
  }
  return first ?? best
}

/** Min/max of a list without spreading it into arguments (long routes have more points than Safari allows as arguments). */
export function extent(v: number[]) {
  let lo = Infinity, hi = -Infinity
  for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x }
  return [lo, hi] as const
}

export function onRoute<T extends { lat: number; lon: number }>(route: Route, items: T[], radius: number): OnRoute<T>[] {
  const lats = route.coords.map((c) => c[0]), lons = route.coords.map((c) => c[1])
  const pad = radius / 111000 + 0.002
  const [latLo, latHi] = extent(lats), [lonLo, lonHi] = extent(lons)
  const s = latLo - pad, n = latHi + pad
  const padLon = pad / Math.cos(((s + n) / 2) * K)
  const w = lonLo - padLon, e = lonHi + padLon
  const out: OnRoute<T>[] = []
  for (const it of items) {
    if (it.lat < s || it.lat > n || it.lon < w || it.lon > e) continue
    const p = project(route, it.lat, it.lon, radius, false)
    if (p.off > radius) continue
    let leg = 0
    while (leg + 1 < route.legStart.length && route.legStart[leg + 1] <= p.along) leg++
    out.push({ ...it, ...p, leg })
  }
  return out.sort((a, b) => a.along - b.along)
}

/** Point at a distance along the route (for weather samples and the "you are here" marker). */
export function pointAt(route: Route, along: number): [number, number] {
  const { coords, cum } = route
  let i = 1
  while (i < cum.length - 1 && cum[i] < along) i++
  const span = cum[i] - cum[i - 1] || 1, t = Math.max(0, Math.min(1, (along - cum[i - 1]) / span))
  return [coords[i - 1][0] + t * (coords[i][0] - coords[i - 1][0]), coords[i - 1][1] + t * (coords[i][1] - coords[i - 1][1])]
}

/** The route's coordinates up to a distance along it, for the gold "driven so far" line. */
export function sliceTo(route: Route, along: number): [number, number][] {
  const out: [number, number][] = []
  for (let i = 0; i < route.coords.length && route.cum[i] <= along; i++) out.push(route.coords[i])
  out.push(pointAt(route, along))
  return out
}

export const kmIn = (m: number) => (m < 150 ? 'At the start' : `${km(m)} in`)
export const km = (m: number) => (m >= 10000 ? `${Math.round(m / 1000)} km` : `${(m / 1000).toFixed(1)} km`)
export const mins = (s: number) => {
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} d ago`
}

/** Does a highway segment run along the route (not just cross it)? Needs several of its points on the route. */
export function overlaps(route: Route, line: [number, number][], tol = 90) {
  if (line.length < 2) return false
  let hits = 0
  for (const [lat, lon] of line) {
    if (project(route, lat, lon, tol, false).off <= tol && ++hits >= Math.max(3, Math.ceil(line.length * 0.2))) return true
  }
  return false
}

/** Shortest distance in metres from a point to a polyline (flat-earth, fine at city scale). */
export function offLine(lat: number, lon: number, line: [number, number][]) {
  const kx = 111320 * Math.cos(lat * K), ky = 110540
  let best = Infinity
  for (let i = 0; i < line.length; i++) {
    const ax = (line[i][1] - lon) * kx, ay = (line[i][0] - lat) * ky
    if (i === line.length - 1) { best = Math.min(best, Math.hypot(ax, ay)); break }
    const bx = (line[i + 1][1] - lon) * kx, by = (line[i + 1][0] - lat) * ky
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy
    const t = l2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy))
  }
  return best
}

/**
 * Where a live position is along the route, for following a trip as it's driven. Searches just behind and ahead of
 * the last known spot first, so a round trip's drive home (which may use the same roads) isn't mistaken for the
 * drive out; if that finds nothing near, it looks along the whole route again.
 */
export function track(route: Route, lat: number, lon: number, prev: number | null): { along: number; off: number } {
  if (prev == null) return project(route, lat, lon, 150)
  const { coords, cum } = route
  const cosLat = Math.cos(lat * K)
  const lo = prev - 300, hi = prev + 6000
  let best = { off: Infinity, along: prev }
  for (let i = 1; i < coords.length; i++) {
    if (cum[i] < lo) continue
    if (cum[i - 1] > hi) break
    const [aLat, aLon] = coords[i - 1], [bLat, bLon] = coords[i]
    const ax = (aLon - lon) * K * cosLat * R, ay = (aLat - lat) * K * R
    const bx = (bLon - lon) * K * cosLat * R, by = (bLat - lat) * K * R
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0
    const off = Math.hypot(ax + t * dx, ay + t * dy)
    if (off < best.off) best = { off, along: cum[i - 1] + t * (cum[i] - cum[i - 1]) }
  }
  if (best.off <= 150) return best
  // Lost the thread (no fixes for a while, or a jumpy one): of every pass near this spot, take the one closest to
  // where we last were, so a round trip's drive home doesn't snap back to the drive out.
  const g = gridOf(route), near = nearSegments(route, lat, lon, 150)
  let pick: { off: number; along: number } | null = null
  for (const i of near) {
    const h = scan(route, lat, lon, 150, [i])
    if (h.off <= 150 && (!pick || Math.abs(h.along - prev) < Math.abs(pick.along - prev))) pick = h
  }
  return pick ?? (best.off < Infinity ? best : scan(route, lat, lon, 150, g.all))
}
