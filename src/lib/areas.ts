import type { Camera } from './types'

// Calgary's five parts, then the rest of Alberta in six regions.
export type Area = 'nw' | 'ne' | 'centre' | 'sw' | 'se' | 'yycr' | 'edm' | 'bow' | 'central' | 'south' | 'north'
export type AreaInfo = { key: Area; label: string; short: string; center: [number, number]; zoom: number; calgary: boolean }
export const AREAS: AreaInfo[] = [
  { key: 'nw', label: 'Northwest Calgary', short: 'NW', center: [51.115, -114.17], zoom: 12, calgary: true },
  { key: 'ne', label: 'Northeast Calgary', short: 'NE', center: [51.1, -113.98], zoom: 12, calgary: true },
  { key: 'centre', label: 'Downtown Calgary', short: 'Core', center: [51.045, -114.065], zoom: 14, calgary: true },
  { key: 'sw', label: 'Southwest Calgary', short: 'SW', center: [50.97, -114.13], zoom: 12, calgary: true },
  { key: 'se', label: 'Southeast Calgary', short: 'SE', center: [50.95, -113.98], zoom: 12, calgary: true },
  { key: 'yycr', label: 'Around Calgary', short: 'Around Calgary', center: [51.05, -114.07], zoom: 9.5, calgary: false },
  { key: 'edm', label: 'Edmonton', short: 'Edmonton', center: [53.54, -113.5], zoom: 10, calgary: false },
  { key: 'bow', label: 'Bow Valley', short: 'Bow Valley', center: [51.2, -115.6], zoom: 9.5, calgary: false },
  { key: 'central', label: 'Central Alberta', short: 'Central', center: [52.4, -113.6], zoom: 8, calgary: false },
  { key: 'south', label: 'Southern Alberta', short: 'South', center: [49.9, -112.6], zoom: 7.5, calgary: false },
  { key: 'north', label: 'Northern Alberta', short: 'North', center: [55.4, -115.5], zoom: 6.5, calgary: false },
]
export const QUADRANTS = AREAS.filter((a) => a.calgary)
export const REGIONS = AREAS.filter((a) => !a.calgary)

// Calgary's quadrants meet at Centre Street and Centre Avenue; downtown is the core around it.
const ORIGIN = [51.0486, -114.0625] as const
const KX = 111320 * Math.cos((ORIGIN[0] * Math.PI) / 180), KY = 110540
const xy = (c: { lat: number; lon: number }) => [(c.lon - ORIGIN[1]) * KX, (c.lat - ORIGIN[0]) * KY] as const
const inCity = (c: Camera) => c.lat > 50.84 && c.lat < 51.22 && c.lon > -114.33 && c.lon < -113.86

// Outside the city: a box around Edmonton and its suburbs, the mountains west of Cochrane, then bands by latitude.
function regionOf(c: Camera): Area {
  if (c.lat > 53.25 && c.lat < 53.85 && c.lon > -114.1 && c.lon < -113.0) return 'edm'
  if (c.lat > 50.55 && c.lat < 51.65) return c.lon < -114.85 ? 'bow' : 'yycr'
  if (c.lat <= 50.55) return 'south'
  return c.lat < 53.25 ? 'central' : 'north'
}

export function areaOf(c: Camera): Area {
  if (!inCity(c)) return regionOf(c)
  const [x, y] = xy(c)
  if (Math.abs(x) < 1800 && y > -1600 && y < 700) return 'centre'
  // Calgary addresses carry their quadrant ("… 52 Street NE"); then the city's own label; then position.
  const named = c.name.match(/\b(NW|NE|SW|SE)\s*$/)?.[1]
  const q = named ?? (c.src === 'city' && /^(NW|NE|SW|SE)$/.test(c.area) ? c.area : `${y >= 0 ? 'N' : 'S'}${x >= 0 ? 'E' : 'W'}`)
  return q.toLowerCase() as Area
}

/**
 * Five cameras that cover an area as evenly as possible: k-means on the cameras' positions (seeded with the
 * farthest-apart cameras so it's deterministic), then the real camera nearest each cluster's centre.
 */
export function spread(cams: Camera[], k = 5): Camera[] {
  if (cams.length <= k) return cams
  const pts = cams.map(xy)
  const d2 = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2
  const mid = [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
  // Farthest-first seeds: start from the camera nearest the middle, then keep adding the one farthest from all seeds.
  const seeds = [pts.reduce((b, p, i) => (d2(p, mid) < d2(pts[b], mid) ? i : b), 0)]
  while (seeds.length < k) {
    let far = 0, farD = -1
    pts.forEach((p, i) => { const d = Math.min(...seeds.map((s) => d2(p, pts[s]))); if (d > farD) { farD = d; far = i } })
    seeds.push(far)
  }
  let cent = seeds.map((i) => [...pts[i]])
  for (let it = 0; it < 30; it++) {
    const sum = cent.map(() => [0, 0, 0])
    pts.forEach((p) => {
      const j = cent.reduce((b, c, i) => (d2(p, c) < d2(p, cent[b]) ? i : b), 0)
      sum[j][0] += p[0]; sum[j][1] += p[1]; sum[j][2]++
    })
    const next = sum.map((s, i) => (s[2] ? [s[0] / s[2], s[1] / s[2]] : cent[i]))
    if (next.every((c, i) => d2(c, cent[i]) < 1)) break
    cent = next
  }
  const used = new Set<number>()
  const picks = cent.map((c) => {
    const i = pts.reduce((b, p, j) => (!used.has(j) && (b < 0 || d2(p, c) < d2(pts[b], c)) ? j : b), -1)
    used.add(i)
    return cams[i]
  })
  // North to south, then west to east, so the order reads like the map.
  return picks.sort((a, b) => b.lat - a.lat || a.lon - b.lon)
}
