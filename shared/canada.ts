/// <reference types="@cloudflare/workers-types" />
import { getJSON, UA } from './edge'

// Every province beyond Alberta. Most provinces run the same 511 software (Iteris) as 511 Alberta, whose public
// lists need no key: one adapter covers Ontario, Saskatchewan, Manitoba, the Atlantic provinces and Yukon.
// British Columbia has DriveBC and Surrey; Ontario adds Toronto, York Region and Ottawa.

type Camera = { id: string; src: 'city' | 'ab' | 'town'; name: string; area: string; lat: number; lon: number }
type RoadEvent = { id: string; kind: 'incident' | 'closure' | 'construction'; src: 'city' | 'ab'; title: string; detail: string; lat: number; lon: number; start?: string; end?: string; updated?: string }
export type Prov = 'bc' | 'sk' | 'mb' | 'on' | 'atl' | 'yt'

// ── 511 sites (Iteris). The letter starts each camera id and tells /api/frames which host its picture is on. ──
export const ITERIS: Record<string, { host: string; name: string }> = {
  o: { host: '511on.ca', name: 'Ontario 511' },
  s: { host: 'hotline.gov.sk.ca', name: 'Saskatchewan Highway Hotline' },
  m: { host: 'www.manitoba511.ca', name: 'Manitoba 511' },
  n: { host: '511.gnb.ca', name: 'New Brunswick 511' },
  v: { host: '511.novascotia.ca', name: 'Nova Scotia 511' },
  p: { host: '511.gov.pe.ca', name: 'PEI 511' },
  l: { host: '511nl.ca', name: 'Newfoundland and Labrador 511' },
  k: { host: '511yukon.ca', name: 'Yukon 511' },
}

/** One of a 511 site's lists (cameras, incidents, roadwork…), 100 rows a page as the sites allow. */
async function list<T>(host: string, layer: string, ttl: number, max = 1200): Promise<T[]> {
  const page = async (start: number) => {
    const q = encodeURIComponent(JSON.stringify({ columns: [{ data: null, name: '' }, { name: 'sortOrder', s: true }], order: [{ column: 1, dir: 'asc' }], start, length: 100, search: { value: '' } }))
    const r = await fetch(`https://${host}/List/GetData/${layer}?query=${q}&lang=en`, { headers: { 'user-agent': UA }, cf: { cacheTtl: ttl, cacheEverything: true } })
    if (!r.ok) throw new Error(`${host} ${layer} ${r.status}`)
    return (await r.json()) as { recordsTotal: number; data: T[] }
  }
  const first = await page(0)
  const rest = await Promise.all(Array.from({ length: Math.max(0, Math.min(Math.ceil(max / 100), Math.ceil(first.recordsTotal / 100)) - 1) }, (_, i) => page((i + 1) * 100)))
  return [first, ...rest].flatMap((p) => p.data)
}

type IterisCam = { source: string; location: string; latLng: { geography: { wellKnownText: string } }; images: { id: number; description: string; disabled: boolean; blocked: boolean }[] }
const point = (wkt: string) => { const m = wkt.match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/); return m ? { lat: +m[2], lon: +m[1] } : null }

async function iterisCameras(letter: string, skip?: RegExp): Promise<Camera[]> {
  const { host, name } = ITERIS[letter]
  const out: Camera[] = []
  for (const c of await list<IterisCam>(host, 'Cameras', 3600)) {
    if (skip?.test(c.source)) continue
    const p = point(c.latLng.geography.wellKnownText)
    if (!p) continue
    const imgs = c.images.filter((i) => !i.disabled && !i.blocked)
    for (const i of imgs) out.push({ id: `${letter}${i.id}`, src: 'ab', name: imgs.length > 1 && i.description ? `${c.location} · ${i.description}` : c.location, area: name, ...p })
  }
  return out
}

type IterisEvent = { id: number; description: string; isFullClosure: boolean; endDate: string | null; lastUpdated: string | null; laneDescription: string | null; comment: string | null }
type Icons = { item2: { itemId: string; location: [number, number] }[] }
const LAYERS: [string, RoadEvent['kind'], number][] = [['Incidents', 'incident', 120], ['Closures', 'closure', 300], ['Construction', 'construction', 600]]
const ON_LAYERS: [string, RoadEvent['kind'], number][] = [['Incidents', 'incident', 120], ['IncidentClosures', 'closure', 120], ['ConstructionClosures', 'closure', 600], ['CurrentRoadwork', 'construction', 600]]

/** A 511 site's events. Its lists carry the text and its map icons the positions, joined by id. */
async function iterisEvents(letter: string, layers = LAYERS): Promise<{ events: RoadEvent[]; failed: boolean }> {
  const { host } = ITERIS[letter]
  let failed = false
  const all = await Promise.allSettled(layers.map(async ([layer, kind, ttl]) => {
    const [rows, icons] = await Promise.all([list<IterisEvent>(host, layer, ttl, 600), getJSON<Icons>(`https://${host}/map/mapIcons/${layer}`, ttl)])
    const at = new Map(icons.item2.map((i) => [i.itemId, i.location]))
    return rows.flatMap((e): RoadEvent[] => {
      const p = at.get(String(e.id))
      return p ? [{
        id: `${letter}${e.id}`, kind: e.isFullClosure ? 'closure' : kind, src: 'ab', lat: p[0], lon: p[1],
        title: e.description.replace(/\s+/g, ' ').trim(), detail: [e.laneDescription, e.comment].filter(Boolean).join('\n'),
        end: e.endDate ?? undefined, updated: e.lastUpdated ?? undefined,
      }] : []
    })
  }))
  const seen = new Set<string>(), events: RoadEvent[] = []
  for (const r of all) {
    if (r.status === 'rejected') { failed = true; continue }
    for (const e of r.value) if (!seen.has(e.id)) { seen.add(e.id); events.push(e) }
  }
  return { events, failed }
}

// ── Ontario's cities ──
type TorCam = { properties: { REC_ID: number; MAINROAD: string; CROSSROAD: string }; geometry: { coordinates: [number, number][] } }
type YorkCam = { attributes: { FACILITYID: string; cameralocation: string }; geometry: { x: number; y: number } }
type OttawaCam = { cameraOwner: string; latitude: number; longitude: number; name: string; camera_number: number }
const title = (s: string) => s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())

async function toronto(): Promise<Camera[]> {
  const j = await getJSON<{ features: TorCam[] }>('https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/a3309088-5fd4-4d34-8297-77c8301840ac/resource/4a568300-c7f8-496d-b150-dff6f5dc6d4f/download/traffic-camera-list-4326.geojson', 3600)
  return j.features.flatMap((f) => {
    const p = f.geometry?.coordinates?.[0]
    return p ? [{ id: `t${f.properties.REC_ID}`, src: 'city' as const, name: `${title(f.properties.MAINROAD)} & ${title(f.properties.CROSSROAD)}`, area: 'Toronto', lat: p[1], lon: p[0] }] : []
  })
}
async function york(): Promise<Camera[]> {
  const j = await getJSON<{ features: YorkCam[] }>('https://ww8.yorkmaps.ca/arcgis/rest/services/OpenData/Traffic/MapServer/0/query?where=1%3D1&outFields=FACILITYID,cameralocation&outSR=4326&f=json', 3600)
  return j.features.filter((f) => /^\d+$/.test(f.attributes.FACILITYID))
    .map((f) => ({ id: `y${f.attributes.FACILITYID}`, src: 'city' as const, name: f.attributes.cameralocation.trim(), area: 'York Region', lat: f.geometry.y, lon: f.geometry.x }))
}
// Ottawa's public traffic map; its provincial (MTO) cameras are already in Ontario 511.
async function ottawa(): Promise<Camera[]> {
  const j = await getJSON<{ cameras: OttawaCam[] }>('https://traffic.ottawa.ca/map/service/camera', 3600)
  return j.cameras.filter((c) => c.cameraOwner === 'CITY' && c.latitude)
    .map((c) => ({ id: `w${c.camera_number}`, src: 'city' as const, name: c.name.replace(/ /g, ' '), area: 'Ottawa', lat: c.latitude, lon: c.longitude }))
}

type Restriction = { id: string; type: string; name: string; road: string; description: string; latitude: string; longitude: string; startTime: string | null; endTime: string | null; lastUpdated: string | null; source: string; currImpact: string }
/** Toronto's road restrictions, only what affects traffic right now. The feed has stray backslashes, so clean before parsing. */
async function torontoRestrictions(): Promise<RoadEvent[]> {
  const r = await fetch('https://secure.toronto.ca/opendata/cart/road_restrictions/v3?format=json', { headers: { 'user-agent': UA }, cf: { cacheTtl: 300, cacheEverything: true } })
  const rows = (JSON.parse((await r.text()).replace(/\\(?!["\\/bfnrtu])/g, '')) as { Closure: Restriction[] }).Closure
  const local = (ms: string | null) => (ms ? new Date(+ms).toLocaleString('en-CA', { timeZone: 'America/Toronto', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined)
  return rows.filter((x) => x.currImpact !== 'None' && x.latitude).map((x) => ({
    id: `tr${x.id}`, src: 'city', lat: +x.latitude, lon: +x.longitude, title: x.name || x.road, detail: (x.description ?? '').trim(),
    kind: x.type === 'ROAD_CLOSED' ? (/police|collision/i.test(`${x.source} ${x.description}`) ? 'incident' : 'closure') : x.type === 'HAZARD' ? 'incident' : 'construction',
    start: x.startTime ? new Date(+x.startTime).toISOString() : undefined, end: local(x.endTime), updated: local(x.lastUpdated),
  }))
}

// ── British Columbia ──
type DriveBcCam = { id: number; name: string; caption: string; location: { coordinates: [number, number] }; is_on: boolean; should_appear: boolean }
type SurreyCam = { attributes: { LOCATION: string | null; IMAGE: string | null }; geometry: { x: number; y: number } }
const SURREY_BLOB = 'https://stcameleonprod.blob.core.windows.net/prodcameleon-blob/'

async function driveBC(): Promise<Camera[]> {
  const j = await getJSON<DriveBcCam[]>('https://www.drivebc.ca/api/webcams/', 3600)
  return j.filter((c) => c.is_on && c.should_appear && c.location?.coordinates)
    .map((c) => ({ id: `d${c.id}`, src: 'ab' as const, name: c.caption || c.name, area: 'DriveBC', lat: c.location.coordinates[1], lon: c.location.coordinates[0] }))
}
async function surrey(): Promise<Camera[]> {
  const j = await getJSON<{ features: SurreyCam[] }>('https://gisservices.surrey.ca/arcgis/rest/services/Public/Transportation/MapServer/2/query?where=1%3D1&outFields=LOCATION,IMAGE&outSR=4326&f=json', 3600)
  return j.features.filter((f) => f.attributes.IMAGE?.startsWith(SURREY_BLOB)).map((f) => ({
    id: `r${f.attributes.IMAGE!.slice(SURREY_BLOB.length)}`, src: 'city' as const, name: f.attributes.LOCATION ?? 'Surrey camera', area: 'Surrey', lat: f.geometry.y, lon: f.geometry.x,
  }))
}

type Open511 = { id: string; headline: string; event_type: string; severity: string; description: string; geography: { type: string; coordinates: number[] | number[][] }; updated: string; schedule?: { intervals?: string[] } }
async function driveBCEvents(): Promise<RoadEvent[]> {
  // Pages of 500 (the API refuses more), until a short page.
  const events: Open511[] = []
  for (let offset = 0; offset < 2000; offset += 500) {
    const j = await getJSON<{ events: Open511[] }>(`https://api.open511.gov.bc.ca/events?format=json&status=ACTIVE&limit=500&offset=${offset}`, 120)
    events.push(...j.events)
    if (j.events.length < 500) break
  }
  return events.flatMap((e): RoadEvent[] => {
    const g = e.geography
    const p = (g.type === 'Point' ? g.coordinates : (g.coordinates as number[][])[Math.floor((g.coordinates as number[][]).length / 2)]) as number[] | undefined
    if (!p) return []
    const closed = /closed|closure/i.test(`${e.headline} ${e.description.slice(0, 120)}`)
    const kind: RoadEvent['kind'] = e.event_type === 'CONSTRUCTION' ? (closed ? 'closure' : 'construction') : closed ? 'closure' : 'incident'
    return [{ id: `bc${e.id.split('/').pop()}`, kind, src: 'ab', lat: p[1], lon: p[0], title: e.description.split('. ')[0], detail: e.description, updated: e.updated }]
  })
}

// ── Each province's cameras and events ──
const settle = async <T>(parts: Promise<T[]>[]) => {
  const r = await Promise.allSettled(parts)
  return { items: r.flatMap((x) => (x.status === 'fulfilled' ? x.value : [])), partial: r.some((x) => x.status === 'rejected') }
}

export async function provinceCameras(prov: Prov): Promise<{ cameras: Camera[]; partial: boolean }> {
  const parts: Record<Prov, () => Promise<Camera[]>[]> = {
    // Toronto's own feed already has the city's expressway cameras, as lighter pictures, so 511's copies are skipped.
    on: () => [toronto(), york(), ottawa(), iterisCameras('o', /toronto/i)],
    bc: () => [driveBC(), surrey()],
    sk: () => [iterisCameras('s')],
    mb: () => [iterisCameras('m')],
    atl: () => [iterisCameras('n'), iterisCameras('v'), iterisCameras('p'), iterisCameras('l')],
    yt: () => [iterisCameras('k')],
  }
  const { items, partial } = await settle(parts[prov]())
  return { cameras: items, partial }
}

export async function provinceEvents(prov: Prov): Promise<{ events: RoadEvent[]; partial: boolean }> {
  const fromIteris = (letters: string[], layers = LAYERS) => letters.map((l) => iterisEvents(l, layers).then((r) => { if (r.failed && !r.events.length) throw new Error(l); return r.events }))
  const parts: Record<Prov, () => Promise<RoadEvent[]>[]> = {
    on: () => [...fromIteris(['o'], ON_LAYERS), torontoRestrictions()],
    bc: () => [driveBCEvents()],
    sk: () => fromIteris(['s']),
    mb: () => fromIteris(['m']),
    atl: () => fromIteris(['n', 'v', 'p', 'l']),
    yt: () => fromIteris(['k']),
  }
  const { items, partial } = await settle(parts[prov]())
  return { events: items, partial }
}

export const isProv = (p: string | null): p is Prov => !!p && ['bc', 'sk', 'mb', 'on', 'atl', 'yt'].includes(p)
