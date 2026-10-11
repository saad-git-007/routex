import { ab511, cached, decodePolyline, inBox, UA, type Env } from '../../shared/edge'

// Alberta 511 winter road conditions across the province, plus road weather stations (pavement temperature).
// With the developer key each segment comes with its shape, so it can be matched to a route by location;
// without it, segments are text only and matched by highway number.

type Row = { id: number; area: string; roadway: string; description: string; primaryCondition: string; secondaryConditions: string[]; visibility: string; lastUpdated: string; stale: boolean }
type ApiRow = { Id: number; LocationDescription: string; 'Primary Condition': string; 'Secondary Conditions': string[]; Visibility: string; AreaName: string; RoadwayName: string; EncodedPolyline: string | null; LastUpdated: number }
type ApiStation = { Id: number; Latitude: number; Longitude: number; LastUpdated: number; AirTemperature: string; PavementTemperature: string; WindSpeed: string; RelativeHumidity: string }
export type RoadCondition = { id: number; hwy: string; segment: string; condition: string; extra: string[]; visibility: string; updated: string; stale: boolean; line?: [number, number][] }
export type Station = { id: number; lat: number; lon: number; air: number; pavement: number; wind: number; updated: number }

const REGION = /./ // the whole province
const fmt = (t: number) => new Date(t * 1000).toLocaleString('en-CA', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

async function page(start: number) {
  const q = encodeURIComponent(JSON.stringify({ columns: [], start, length: 100 }))
  const r = await fetch(`https://511.alberta.ca/List/GetData/WinterRoads?query=${q}&lang=en-US`, { headers: { 'user-agent': UA }, cf: { cacheTtl: 600, cacheEverything: true } })
  if (!r.ok) return { total: 0, data: [] as Row[] }
  const j = (await r.json()) as { recordsTotal: number; data: Row[] }
  return { total: j.recordsTotal, data: j.data }
}

async function scraped(): Promise<RoadCondition[]> {
  const first = await page(0)
  const rest = await Promise.all(Array.from({ length: Math.min(19, Math.ceil(first.total / 100) - 1) }, (_, i) => page((i + 1) * 100)))
  return [first, ...rest].flatMap((p) => p.data).filter((r) => REGION.test(r.area ?? '')).map((r) => ({
    id: r.id, hwy: r.roadway, segment: r.description, condition: r.primaryCondition, extra: r.secondaryConditions ?? [],
    visibility: r.visibility, updated: r.lastUpdated, stale: r.stale,
  }))
}

async function official(env: Env) {
  const [rows, stations] = await Promise.all([ab511<ApiRow[]>(env, 'winterroads', 600), ab511<ApiStation[]>(env, 'weatherstations', 600).catch(() => [] as ApiStation[])])
  const roads: RoadCondition[] = []
  for (const r of rows) {
    const line = r.EncodedPolyline ? decodePolyline(r.EncodedPolyline) : []
    const near = line.length ? line.some(([a, b]) => inBox(a, b)) : REGION.test(r.AreaName ?? '')
    if (!near) continue
    roads.push({
      id: r.Id, hwy: r.RoadwayName, segment: r.LocationDescription, condition: r['Primary Condition'], extra: r['Secondary Conditions'] ?? [],
      visibility: r.Visibility, updated: fmt(r.LastUpdated), stale: Date.now() / 1000 - r.LastUpdated > 2 * 86400, line,
    })
  }
  const st: Station[] = stations.filter((s) => inBox(s.Latitude, s.Longitude)).map((s) => ({
    id: s.Id, lat: s.Latitude, lon: s.Longitude, air: +s.AirTemperature, pavement: +s.PavementTemperature, wind: +s.WindSpeed, updated: s.LastUpdated * 1000,
  }))
  return { roads, stations: st }
}

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  cached(ctx, 600, async () => {
    const data = await (ctx.env.AB511_KEY ? official(ctx.env) : scraped().then((roads) => ({ roads, stations: [] as Station[] }))).catch(() => null)
    return { updated: new Date().toISOString(), roads: data?.roads ?? [], stations: data?.stations ?? [], partial: !data?.roads.length }
  })
