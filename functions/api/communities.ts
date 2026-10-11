import { cached, getJSON } from '../../shared/edge'

// Calgary community boundaries and names (City of Calgary open data, surr-xmvs), simplified on the
// City's side and cached at the edge for a day: they change once a year at most.

type Feature = { properties: { name: string; class: string }; geometry: { type: 'MultiPolygon'; coordinates: number[][][][] } | null }
export type Community = { name: string; kind: 'home' | 'industry' | 'park'; label: [number, number]; rings: [number, number][][] }

const URL = 'https://data.calgary.ca/resource/surr-xmvs.geojson?$limit=400&$select=name,class,simplify_preserve_topology(multipolygon,0.0002)'
const KIND: Record<string, Community['kind']> = { Residential: 'home', Industrial: 'industry', 'Major Park': 'park' }

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bMc(\w)/g, (_, c: string) => 'Mc' + c.toUpperCase())

/** A point inside the ring: the middle of the widest stretch of the horizontal line through its centroid. */
function labelPoint(ring: [number, number][]): [number, number] {
  let a = 0, cy = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = ring[j][1] * ring[i][0] - ring[i][1] * ring[j][0]
    a += f; cy += (ring[j][0] + ring[i][0]) * f
  }
  const lat = a ? cy / (3 * a) : ring[0][0]
  const xs: number[] = []
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [la, lo] = ring[i], [lb, lob] = ring[j]
    if ((la > lat) !== (lb > lat)) xs.push(lo + ((lat - la) / (lb - la)) * (lob - lo))
  }
  xs.sort((p, q) => p - q)
  let best: [number, number] = [ring[0][0], ring[0][1]], w = -1
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > w) { w = xs[i + 1] - xs[i]; best = [lat, (xs[i] + xs[i + 1]) / 2] }
  return [+best[0].toFixed(5), +best[1].toFixed(5)]
}

const areaOf = (r: [number, number][]) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[1] * q[0] - q[1] * p[0] }, 0))

export const onRequestGet: PagesFunction = (ctx) =>
  cached(ctx, 86400, async () => {
    const fc = await getJSON<{ features: Feature[] }>(URL, 86400).catch(() => null)
    const communities: Community[] = []
    for (const f of fc?.features ?? []) {
      const kind = KIND[f.properties.class]
      if (!kind || !f.geometry) continue
      const polys = f.geometry.coordinates.map((poly) => poly.map((r) => r.map(([lon, lat]) => [+lat.toFixed(5), +lon.toFixed(5)] as [number, number])))
      const rings = polys.flat()
      const main = polys.map((p) => p[0]).reduce((b, r) => (areaOf(r) > areaOf(b) ? r : b))
      communities.push({ name: title(f.properties.name), kind, label: labelPoint(main), rings })
    }
    return { communities, partial: !communities.length }
  })
