import { ab511, cached, getJSON, inBox, UA, type Env } from '../../shared/edge'

// Every camera the app knows: City of Calgary cameras plus Alberta 511 cameras in the region.
// Locations barely change, so this list is cached at the edge for an hour.

type CityCam = { camera_url?: { url: string }; camera_location: string; quadrant?: string; point?: { coordinates: [number, number] } }
type AbCam = {
  id: number; roadway: string; direction: string; location: string
  latLng: { geography: { wellKnownText: string } }
  images: { id: number; description: string; disabled: boolean; blocked: boolean }[]
}
export type Camera = { id: string; src: 'city' | 'ab'; name: string; area: string; lat: number; lon: number }

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
    return { updated: new Date().toISOString(), cameras: cams, partial: partial || !pages.length }
  })
