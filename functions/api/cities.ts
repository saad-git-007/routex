import { citiesWithCameras, PROVINCES } from '../../shared/cities'
import { cached } from '../../shared/edge'

// How many cameras each Canadian city has, for the welcome search. Built from each province's own (edge-cached)
// camera list, so it costs one small download instead of every province's full list.
type Cam = { id: string; lat: number; lon: number }
const query = (p: string) => (p === 'ab' ? 'ab=all&town=2' : `prov=${p}`)

export const onRequestGet: PagesFunction = (ctx) =>
  cached(ctx, 3600, async () => {
    const origin = new URL(ctx.request.url).origin
    const lists = await Promise.allSettled(PROVINCES.map((p) => fetch(`${origin}/api/cameras?${query(p.key)}`).then((r) => r.json() as Promise<{ cameras: Cam[] }>)))
    const cams = lists.flatMap((l) => (l.status === 'fulfilled' ? l.value.cameras : []))
    const cities = citiesWithCameras(cams).map((c) => ({ key: c.key, cams: c.cams }))
    return { cities, total: cams.length, partial: lists.some((l) => l.status === 'rejected') }
  })
