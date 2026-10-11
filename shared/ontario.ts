/// <reference types="@cloudflare/workers-types" />
import { getJSON, UA } from './edge'

// The Greater Toronto Area: Ontario 511 (provincial highways, no key needed for its public lists), the City of
// Toronto's open-data cameras and road restrictions, and York Region's cameras.

type Camera = { id: string; src: 'city' | 'ab' | 'town'; name: string; area: string; lat: number; lon: number }
type RoadEvent = { id: string; kind: 'incident' | 'closure' | 'construction'; src: 'city' | 'ab'; title: string; detail: string; lat: number; lon: number; start?: string; end?: string; updated?: string }

// Hamilton to Clarington, Lake Ontario to Lake Simcoe's south shore.
export const inGTA = (lat: number, lon: number) => lat > 43.0 && lat < 44.4 && lon > -80.35 && lon < -78.4

/** One of Ontario 511's lists (cameras, incidents, roadwork…), 100 rows a page as the site allows. */
async function list<T>(layer: string, ttl: number, max = 1200): Promise<T[]> {
  const page = async (start: number) => {
    const q = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }], order: [{ column: 1, dir: 'asc' }], start, length: 100, search: { value: '' } }))
    const r = await fetch(`https://511on.ca/List/GetData/${layer}?query=${q}&lang=en`, { headers: { 'user-agent': UA }, cf: { cacheTtl: ttl, cacheEverything: true } })
    if (!r.ok) throw new Error(`511on ${layer} ${r.status}`)
    return (await r.json()) as { recordsTotal: number; data: T[] }
  }
  const first = await page(0)
  const rest = await Promise.all(Array.from({ length: Math.min(Math.ceil(max / 100), Math.ceil(first.recordsTotal / 100)) - 1 }, (_, i) => page((i + 1) * 100)))
  return [first, ...rest].flatMap((p) => p.data)
}

type OnCam = { id: number; source: string; location: string; latLng: { geography: { wellKnownText: string } }; images: { id: number; description: string; disabled: boolean; blocked: boolean }[] }
type TorCam = { properties: { REC_ID: number; MAINROAD: string; CROSSROAD: string }; geometry: { coordinates: [number, number][] } }
type YorkCam = { attributes: { FACILITYID: string; cameralocation: string }; geometry: { x: number; y: number } }

const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

export async function ontarioCameras(): Promise<{ cameras: Camera[]; partial: boolean }> {
  const [on, tor, york] = await Promise.allSettled([
    list<OnCam>('Cameras', 3600),
    getJSON<{ features: TorCam[] }>('https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson', 3600),
    getJSON<{ features: YorkCam[] }>('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Traffic/MapServer/0/query?where=1%3D1&outFields=FACILITYID,cameralocation&outSR=4326&f=json', 3600),
  ])
  const cams: Camera[] = []
  if (tor.status === 'fulfilled')
    for (const f of tor.value.features) {
      const p = f.geometry?.coordinates?.[0]
      if (p) cams.push({ id: `t${f.properties.REC_ID}`, src: 'city', name: `${title(f.properties.MAINROAD)} & ${title(f.properties.CROSSROAD)}`, area: 'Toronto', lat: p[1], lon: p[0] })
    }
  if (york.status === 'fulfilled')
    for (const f of york.value.features)
      if (/^\d+$/.test(f.attributes.FACILITYID)) cams.push({ id: `y${f.attributes.FACILITYID}`, src: 'city', name: f.attributes.cameralocation.trim(), area: 'York Region', lat: f.geometry.y, lon: f.geometry.x })
  if (on.status === 'fulfilled')
    for (const c of on.value) {
      // Toronto's own feed already has the city's expressway cameras, as lighter pictures.
      if (/toronto/i.test(c.source)) continue
      const m = c.latLng.geography.wellKnownText.match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/)
      if (!m || !inGTA(+m[2], +m[1])) continue
      const imgs = c.images.filter((i) => !i.disabled && !i.blocked)
      for (const i of imgs) cams.push({ id: `o${i.id}`, src: 'ab', name: imgs.length > 1 && i.description ? `${c.location} · ${i.description}` : c.location, area: 'Ontario 511', lat: +m[2], lon: +m[1] })
    }
  return { cameras: cams, partial: [on, tor, york].some((r) => r.status === 'rejected') }
}

type OnEvent = { id: number; layerName: string; roadwayName: string; description: string; isFullClosure: boolean; startDate: string | null; endDate: string | null; lastUpdated: string | null; laneDescription: string | null; comment: string | null }
type Icons = { item2: { itemId: string; location: [number, number] }[] }
type Restriction = { id: string; type: string; name: string; road: string; description: string; latitude: string; longitude: string; startTime: string | null; endTime: string | null; lastUpdated: string | null; source: string; currImpact: string }

const ON_LAYERS: [string, RoadEvent['kind'], number][] = [['Incidents', 'incident', 120], ['IncidentClosures', 'closure', 120], ['ConstructionClosures', 'closure', 600], ['CurrentRoadwork', 'construction', 600]]

export async function ontarioEvents(): Promise<{ events: RoadEvent[]; partial: boolean }> {
  const events: RoadEvent[] = []
  let partial = false
  // Ontario 511's lists carry the text and its map icons the positions; join them by id.
  const layers = await Promise.allSettled(ON_LAYERS.map(async ([layer, kind, ttl]) => {
    const [rows, icons] = await Promise.all([list<OnEvent>(layer, ttl, 600), getJSON<Icons>(`https://511on.ca/map/mapIcons/${layer}`, ttl)])
    const at = new Map(icons.item2.map((i) => [i.itemId, i.location]))
    return rows.flatMap((e) => {
      const p = at.get(String(e.id))
      if (!p || !inGTA(p[0], p[1])) return []
      return [{
        id: `on${e.id}`, kind: e.isFullClosure ? 'closure' : kind, src: 'ab' as const, lat: p[0], lon: p[1],
        title: e.description.replace(/\s+/g, ' ').trim(), detail: [e.laneDescription, e.comment].filter(Boolean).join('\n'),
        end: e.endDate ?? undefined, updated: e.lastUpdated ?? undefined,
      }]
    })
  }))
  const seen = new Set<string>()
  for (const l of layers) {
    if (l.status === 'rejected') { partial = true; continue }
    for (const e of l.value) if (!seen.has(e.id)) { seen.add(e.id); events.push(e) }
  }

  // Toronto's road restrictions: only what affects traffic right now. The feed has stray backslashes, so clean before parsing.
  try {
    const r = await fetch('https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json', { headers: { 'user-agent': UA }, cf: { cacheTtl: 300, cacheEverything: true } })
    const text = (await r.text()).replace(/\\(?!["\\/bfnrtu])/g, '')
    const rows = (JSON.parse(text) as { Closure: Restriction[] }).Closure
    const iso = (ms: string | null) => (ms ? new Date(+ms).toISOString() : undefined)
    const local = (ms: string | null) => (ms ? new Date(+ms).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined)
    for (const x of rows) {
      if (x.currImpact === 'None' || !x.latitude) continue
      const kind: RoadEvent['kind'] = x.type === 'ROAD_CLOSED' ? (/police|collision/i.test(`${x.source} ${x.description}`) ? 'incident' : 'closure') : x.type === 'HAZARD' ? 'incident' : 'construction'
      events.push({ id: `tr${x.id}`, kind, src: 'city', lat: +x.latitude, lon: +x.longitude, title: x.name || x.road, detail: (x.description ?? '').trim(), start: iso(x.startTime), end: local(x.endTime), updated: local(x.lastUpdated) })
    }
  } catch { partial = true }
  return { events, partial }
}
