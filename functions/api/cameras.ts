import { ab511, cached, getJSON, inBox, UA, type Env } from '../../shared/edge'
import { ontarioCameras } from '../../shared/ontario'

// Every camera the app knows: City of Calgary cameras, every Alberta 511 camera in the province, the Town of Banff's
// street cameras and the City of Edmonton's live video cameras.
// Locations barely change, so this list is cached at the edge for an hour.

type CityCam = { camera_url?: { url: string }; camera_location: string; quadrant?: string; point?: { coordinates: [number, number] } }
type AbCam = {
  id: number; roadway: string; direction: string; location: string
  latLng: { geography: { wellKnownText: string } }
  images: { id: number; description: string; disabled: boolean; blocked: boolean }[]
}
export type Camera = { id: string; src: 'city' | 'ab' | 'town'; name: string; area: string; lat: number; lon: number }

// Banff publishes JPEGs at fixed names (banff.ca/1065/Traffic-Cameras) with no locations; these are placed by hand.
// Its server refuses Cloudflare, so browsers load these pictures straight from ftp.banff.ca. The Middle Springs,
// Valleyview and Rimrock cameras had been frozen for weeks in October 2026 and are left out.
export const BANFF: { file: string; name: string; lat: number; lon: number }[] = [
  { file: 'Banff_Ave_Buffalo', name: 'Banff Ave & Buffalo St, looking south', lat: 51.1745, lon: -115.5714 },
  { file: 'Banff_Caribou', name: 'Banff Ave & Caribou St, looking north', lat: 51.1763, lon: -115.5707 },
  { file: 'Wolf_Lynx', name: 'Wolf St & Lynx St, looking south', lat: 51.1781, lon: -115.5745 },
  { file: 'Banff_Moose', name: 'Banff Ave & Moose St, looking south', lat: 51.1790, lon: -115.5692 },
  { file: 'bear-st-mid-ptz', name: 'Bear St, looking south', lat: 51.1772, lon: -115.5729 },
  { file: 'Bow_River_Bridge', name: 'Spray Ave, looking north over the Bow River Bridge', lat: 51.1718, lon: -115.5703 },
  { file: 'BSH_Photo', name: 'Spray Ave & Rundle Ave, towards the Banff Springs', lat: 51.1705, lon: -115.5689 },
  { file: 'spray-west', name: 'Spray Ave, looking east towards the Banff Springs', lat: 51.1688, lon: -115.5652 },
  { file: 'Norquay_North', name: 'Mt Norquay Rd at the Fenlands, looking north', lat: 51.1852, lon: -115.5797 },
  { file: 'Norquay_South', name: 'Mt Norquay Rd at the Fenlands, looking south', lat: 51.1849, lon: -115.5795 },
  { file: 'train-w', name: 'Train station parking, entrance', lat: 51.1823, lon: -115.5776 },
  { file: 'train-e', name: 'Train station parking, looking east', lat: 51.1821, lon: -115.5765 },
]

const banff = (): Camera[] => BANFF.map((b) => ({ id: `b${b.file}`, src: 'town', name: b.name, area: 'Banff', lat: b.lat, lon: b.lon }))

// Edmonton's cameras are live HLS video, listed by the city's camera site. The stream's server, forge and code make up the id.
type EdmCam = { Code: number; Forge: number; Latitude: string; Longitude: string; MMSUrl: string; PrimaryRoad: string; SecondaryRoad: string; Status: string; StreamCode: string }
async function edmonton(): Promise<Camera[]> {
  const r = await fetch('https://edmontontrafficcam.com/Default.aspx/GetCameras', {
    method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'user-agent': UA },
  })
  if (!r.ok) return []
  const j = (await r.json()) as { d: EdmCam[] | string }
  const list = typeof j.d === 'string' ? (JSON.parse(j.d) as EdmCam[]) : j.d
  return list.filter((c) => c.Status === '1' && /^[\w-]+$/.test(c.StreamCode) && /^[\w.-]+$/.test(c.MMSUrl)).map((c) => ({
    id: `e${c.MMSUrl}/${c.Forge}/${c.StreamCode}`, src: 'town', name: `${c.PrimaryRoad} & ${c.SecondaryRoad}`, area: 'Edmonton', lat: +c.Latitude, lon: +c.Longitude,
  }))
}

const metres = (a: Camera, b: Camera) => {
  const k = Math.PI / 180, x = (b.lon - a.lon) * k * Math.cos(((a.lat + b.lat) / 2) * k), y = (b.lat - a.lat) * k
  return Math.hypot(x, y) * 6371000
}

async function abPage(start: number) {
  const q = encodeURIComponent(JSON.stringify({ columns: [], start, length: 100 }))
  const r = await fetch(`https://511.alberta.ca/List/GetData/Cameras?query=${q}&lang=en-US`, { headers: { 'user-agent': UA }, cf: { cacheTtl: 3600, cacheEverything: true } })
  return r.ok ? ((await r.json()) as { data: AbCam[] }).data : []
}

type AbApiCam = { Id: number; Roadway: string; Latitude: number; Longitude: number; Location: string; Views: { Id: number; Url: string; Status: string; Description: string }[] }

async function abCameras(env: Env): Promise<AbCam[]> {
  if (!env.AB511_KEY) return (await Promise.all([0, 100, 200, 300, 400].map(abPage))).flat()
  const cams = await ab511<AbApiCam[]>(env, 'cameras', 3600)
  return cams.map((c) => ({
    id: c.Id, roadway: c.Roadway, direction: '', location: c.Location,
    latLng: { geography: { wellKnownText: `POINT (${c.Longitude} ${c.Latitude})` } },
    images: c.Views.map((v) => ({ id: +(v.Url.match(/Cctv\/(\d+)/)?.[1] ?? v.Id), description: v.Description, disabled: v.Status !== 'Enabled', blocked: false })),
  }))
}

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  cached(ctx, 3600, async () => {
    if (new URL(ctx.request.url).searchParams.get('prov') === 'on') {
      const on = await ontarioCameras()
      return { updated: new Date().toISOString(), ...on }
    }
    const city = await getJSON<CityCam[]>('https://data.calgary.ca/resource/k7p9-kppz.json?$limit=2000', 3600)
    const cams: Camera[] = []
    for (const c of city) {
      const n = c.camera_url?.url.match(/loc(\d+)\.jpg/i)?.[1]
      const p = c.point?.coordinates
      if (!n || !p) continue
      cams.push({ id: `c${n}`, src: 'city', name: c.camera_location.trim(), area: c.quadrant ?? '', lat: p[1], lon: p[0] })
    }
    let partial = false
    const pages = await abCameras(ctx.env).catch(() => { partial = true; return [] as AbCam[] })
    for (const a of pages) {
      const m = a.latLng.geography.wellKnownText.match(/POINT \((-?[\d.]+) (-?[\d.]+)\)/)
      if (!m) continue
      const lon = +m[1], lat = +m[2]
      if (!inBox(lat, lon)) continue
      const imgs = a.images.filter((i) => !i.disabled && !i.blocked)
      for (const img of imgs) {
        const cam: Camera = {
          id: `a${img.id}`, src: 'ab', lat, lon, area: a.roadway,
          name: imgs.length > 1 && img.description ? `${a.location} · ${img.description}` : a.location,
        }
        // The city already streams most in-town intersections; keep 511 for the ring road and highways.
        if (!cams.some((c) => c.src === 'city' && metres(c, cam) < 120)) cams.push(cam)
      }
    }
    const e = await edmonton().catch(() => [])
    cams.push(...banff(), ...e)
    return { updated: new Date().toISOString(), cameras: cams, partial: partial || !pages.length || !e.length }
  })
