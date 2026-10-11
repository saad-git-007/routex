import type { Camera } from './types'

// Alberta cities and towns, with how far out (km) a camera still counts as theirs. Only the ones with at least
// one camera are offered; the counts come from the live camera list.
export type City = { key: string; name: string; lat: number; lon: number; km: number }
export const CITIES: City[] = ([
  ['Calgary', 51.045, -114.07, 20], ['Edmonton', 53.546, -113.49, 20], ['Airdrie', 51.29, -114.01, 7], ['Cochrane', 51.19, -114.47, 7],
  ['Chestermere', 51.05, -113.82, 5], ['Okotoks', 50.725, -113.975, 7], ['Strathmore', 51.04, -113.4, 7], ['High River', 50.58, -113.87, 7],
  ['Canmore', 51.09, -115.35, 7], ['Banff', 51.178, -115.57, 6], ['Lake Louise', 51.43, -116.18, 10], ['Red Deer', 52.27, -113.81, 12],
  ['Lethbridge', 49.69, -112.84, 12], ['Medicine Hat', 50.04, -110.68, 12], ['Grande Prairie', 55.17, -118.8, 15], ['Fort McMurray', 56.73, -111.38, 15],
  ['St. Albert', 53.63, -113.62, 5], ['Sherwood Park', 53.52, -113.3, 7], ['Spruce Grove', 53.545, -113.91, 6], ['Stony Plain', 53.53, -114.0, 5],
  ['Leduc', 53.26, -113.55, 7], ['Fort Saskatchewan', 53.71, -113.21, 7], ['Beaumont', 53.36, -113.41, 4], ['Camrose', 53.02, -112.83, 10],
  ['Brooks', 50.56, -111.9, 10], ['Lloydminster', 53.28, -110.0, 10], ['Hinton', 53.4, -117.57, 12], ['Jasper', 52.88, -118.08, 12],
  ['Whitecourt', 54.14, -115.68, 12], ['Edson', 53.58, -116.44, 12], ['Olds', 51.79, -114.1, 8], ['Drumheller', 51.46, -112.71, 10],
  ['Sylvan Lake', 52.31, -114.08, 8], ['Lacombe', 52.47, -113.73, 8], ['Wetaskiwin', 52.97, -113.37, 8], ['Cold Lake', 54.46, -110.18, 12],
  ['Slave Lake', 55.28, -114.77, 12], ['Peace River', 56.23, -117.29, 12], ['High Level', 58.52, -117.14, 15], ['Athabasca', 54.72, -113.29, 12],
  ['Bonnyville', 54.27, -110.74, 10], ['Taber', 49.78, -112.15, 8], ['Pincher Creek', 49.49, -113.95, 10], ['Crowsnest Pass', 49.63, -114.48, 12],
  ['Fort Macleod', 49.72, -113.41, 8], ['Cardston', 49.2, -113.3, 10], ['Coutts', 49.0, -111.96, 8], ['Waterton', 49.05, -113.91, 10],
  ['Nanton', 50.35, -113.77, 8], ['Claresholm', 50.03, -113.58, 8], ['Valleyview', 55.07, -117.27, 12], ['Fox Creek', 54.4, -116.81, 12],
  ['Hanna', 51.64, -111.93, 10], ['Ponoka', 52.68, -113.58, 8], ['Innisfail', 52.03, -113.95, 8], ['Didsbury', 51.66, -114.13, 6],
  ['Vegreville', 53.49, -112.05, 8], ['Vermilion', 53.35, -110.85, 8], ['Rocky Mountain House', 52.37, -114.92, 10], ['Westlock', 54.15, -113.86, 8],
  ['Barrhead', 54.12, -114.4, 8], ['St. Paul', 53.99, -111.29, 8],
] as const).map(([name, lat, lon, km]) => ({ key: name.toLowerCase().replace(/[^a-z]+/g, '-'), name, lat, lon, km }))

const dist = (c: City, p: { lat: number; lon: number }) =>
  Math.hypot((p.lat - c.lat) * 111.2, (p.lon - c.lon) * 111.2 * Math.cos((c.lat * Math.PI) / 180))

/** Each city with its camera count; a camera belongs to the nearest city whose radius it falls in. */
export function citiesWithCameras(cams: Camera[]) {
  const n = new Map<string, number>()
  for (const cam of cams) {
    let best: City | null = null, bd = Infinity
    for (const c of CITIES) { const d = dist(c, cam); if (d <= c.km && d / c.km < bd) { bd = d / c.km; best = c } }
    if (best) n.set(best.key, (n.get(best.key) ?? 0) + 1)
  }
  return CITIES.filter((c) => n.has(c.key)).map((c) => ({ ...c, cams: n.get(c.key)! })).sort((a, b) => a.name.localeCompare(b.name))
}

/** How close to zoom for a city: the big two show the whole city, towns a closer view. */
export const cityZoom = (c: City) => (c.km >= 20 ? 11 : c.km >= 10 ? 12 : 13)
