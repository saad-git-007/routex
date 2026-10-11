import type { Camera } from './types'

// Calgary's five parts. Every other city is shown whole (see lib/cities).
export type Area = 'nw' | 'ne' | 'centre' | 'sw' | 'se'
export type AreaInfo = { key: Area; label: string; short: string; center: [number, number]; zoom: number }
export const QUADRANTS: AreaInfo[] = [
  { key: 'nw', label: 'Northwest Calgary', short: 'NW', center: [51.115, -114.17], zoom: 12 },
  { key: 'ne', label: 'Northeast Calgary', short: 'NE', center: [51.1, -113.98], zoom: 12 },
  { key: 'centre', label: 'Downtown Calgary', short: 'Core', center: [51.045, -114.065], zoom: 14 },
  { key: 'sw', label: 'Southwest Calgary', short: 'SW', center: [50.97, -114.13], zoom: 12 },
  { key: 'se', label: 'Southeast Calgary', short: 'SE', center: [50.95, -113.98], zoom: 12 },
]

// Calgary's quadrants meet at Centre Street and Centre Avenue; downtown is the core around it.
const ORIGIN = [51.0486, -114.0625] as const
const KX = 111320 * Math.cos((ORIGIN[0] * Math.PI) / 180), KY = 110540
const xy = (c: { lat: number; lon: number }) => [(c.lon - ORIGIN[1]) * KX, (c.lat - ORIGIN[0]) * KY] as const
const inCity = (c: Camera) => c.lat > 50.84 && c.lat < 51.22 && c.lon > -114.33 && c.lon < -113.86

export function areaOf(c: Camera): Area | null {
  if (!inCity(c)) return null
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
