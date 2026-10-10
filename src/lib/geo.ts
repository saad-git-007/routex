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

/**
 * Where a point meets the route: distance off the line and metres along it. On a round trip a camera can be passed
 * twice; the first pass within `radius` wins so cards follow the order you drive them.
 */
export function project(route: Route, lat: number, lon: number, radius: number) {
  const { coords, cum } = route
  const cosLat = Math.cos(lat * K)
  let best = { off: Infinity, along: 0 }
  let first: { off: number; along: number } | null = null
  for (let i = 1; i < coords.length; i++) {
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

export function onRoute<T extends { lat: number; lon: number }>(route: Route, items: T[], radius: number): OnRoute<T>[] {
  const lats = route.coords.map((c) => c[0]), lons = route.coords.map((c) => c[1])
  const pad = radius / 111000 + 0.002
  const s = Math.min(...lats) - pad, n = Math.max(...lats) + pad
  const padLon = pad / Math.cos(((s + n) / 2) * K)
  const w = Math.min(...lons) - padLon, e = Math.max(...lons) + padLon
  const out: OnRoute<T>[] = []
  for (const it of items) {
    if (it.lat < s || it.lat > n || it.lon < w || it.lon > e) continue
    const p = project(route, it.lat, it.lon, radius)
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
    if (project(route, lat, lon, tol).off <= tol && ++hits >= Math.max(3, Math.ceil(line.length * 0.2))) return true
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
