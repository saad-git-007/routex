import { ab511, cached, getJSON, inBox, UA, type Env } from '../../shared/edge'

// Everything that can slow a drive: City of Calgary incidents and construction detours, and Alberta 511
// incidents, closures and construction in the region. Cached for two minutes at the edge.

export type RoadEvent = {
  id: string; kind: 'incident' | 'closure' | 'construction'; src: 'city' | 'ab'
  title: string; detail: string; lat: number; lon: number; start?: string; end?: string; updated?: string
}
type CityIncident = { id: string; incident_info: string; description: string; start_dt_utc: string; modified_dt_utc: string; latitude: string; longitude: string }
type Detour = { construction_info: string; description: string; start_dt: string; end_dt: string; latitude: string; longitude: string }
type Icons = { item2: { itemId: string; location: [number, number] }[] }

const clean = (s: string) => s.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()

async function abDetail(type: string, id: string) {
  const r = await fetch(`https://511.alberta.ca/tooltip/${type}/${id}?lang=en-US&noCss=true`, { headers: { 'user-agent': UA }, cf: { cacheTtl: 300, cacheEverything: true } })
  if (!r.ok) return null
  const html = await r.text()
  const cells = [...html.matchAll(/<td colspan="2"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => clean(m[1]))
  const rows = Object.fromEntries([...html.matchAll(/<th[^>]*>([\s\S]*?)<\/th>\s*<td>([\s\S]*?)<\/td>/g)].map((m) => [clean(m[1]), clean(m[2])]))
  const comment = cells.find((c) => c.startsWith('Comment'))?.replace(/^Comment\s*/, '') ?? ''
  return { title: cells[0] ?? '', detail: comment, start: rows['Start Time'], end: rows['Anticipated End Time'], updated: rows['Last Updated'] }
}

type AbEvent = {
  ID: number; RoadwayName: string; DirectionOfTravel: string; Description: string; Details: string; EventType: string; IsFullClosure: boolean
  Latitude: number; Longitude: number; StartDate: number | null; PlannedEndDate: number | null; LastUpdated: number | null; LanesAffected: string
}
type AbAlert = { Id: number; Message: string; Notes: string; StartTime: number; EndTime: number | null; Regions: string[]; HighImportance: boolean }
export type Alert = { id: number; title: string; notes: string; end?: string; high: boolean }

const KINDS: Record<string, RoadEvent['kind']> = { accidentsAndIncidents: 'incident', closures: 'closure', roadwork: 'construction' }
const iso = (t: number | null) => (t ? new Date(t * 1000).toISOString() : undefined)
const fmt = (t: number | null) => (t ? new Date(t * 1000).toLocaleString('en-CA', { timeZone: 'America/Edmonton', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined)

async function official(env: Env) {
  const [ev, al] = await Promise.all([ab511<AbEvent[]>(env, 'event', 120), ab511<AbAlert[]>(env, 'alerts', 120).catch(() => [] as AbAlert[])])
  const events: RoadEvent[] = ev
    .filter((e) => KINDS[e.EventType] && inBox(e.Latitude, e.Longitude))
    .map((e) => ({
      id: `ab${e.ID}`, kind: e.IsFullClosure ? 'closure' : KINDS[e.EventType], src: 'ab', lat: e.Latitude, lon: e.Longitude,
      title: e.Description.replace(/\s+Activities:.*$/s, '').trim(),
      detail: [e.LanesAffected, e.Details].filter((x) => x && x !== 'No Data').join('\n').trim(),
      start: iso(e.StartDate), end: fmt(e.PlannedEndDate), updated: fmt(e.LastUpdated),
    }))
  const now = Date.now() / 1000
  const alerts: Alert[] = al
    .filter((a) => a.Regions.some((r) => /calgary|banff/i.test(r)) && (!a.EndTime || a.EndTime > now))
    .map((a) => ({ id: a.Id, title: a.Message, notes: clean(a.Notes).replace(/\n+/g, ' ').trim(), end: fmt(a.EndTime), high: a.HighImportance }))
  return { events, alerts }
}

export const onRequestGet: PagesFunction<Env> = (ctx) =>
  cached(ctx, 120, async () => {
    const events: RoadEvent[] = []
    const now = new Date()
    // Detour times are local Calgary time without an offset; compare as local wall-clock strings.
    const local = new Date(now.toLocaleString('en-US', { timeZone: 'America/Edmonton' }))
    const pad = (n: number) => String(n).padStart(2, '0')
    const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`
    const nowLocal = stamp(local), soon = stamp(new Date(local.getTime() + 12 * 3600e3))

    const [inc, det] = await Promise.allSettled([
      // The incidents dataset is an archive; only the last few hours describe the road right now.
      getJSON<CityIncident[]>(`https://data.calgary.ca/resource/35ra-9556.json?$limit=200&$order=start_dt_utc%20DESC&$where=${encodeURIComponent(`start_dt_utc > '${new Date(now.getTime() - 4 * 3600e3).toISOString().slice(0, 19)}'`)}`, 60),
      getJSON<Detour[]>(`https://data.calgary.ca/resource/w8zq-79bq.json?$limit=1000&$where=${encodeURIComponent(`end_dt > '${nowLocal}' AND start_dt < '${soon}'`)}`, 600),
    ])
    if (inc.status === 'fulfilled')
      inc.value.forEach((i, n) => events.push({
        id: `ci${n}-${i.start_dt_utc}`, kind: 'incident', src: 'city', title: (i.incident_info ?? 'Incident').trim(), detail: (i.description ?? '').trim(),
        lat: +i.latitude, lon: +i.longitude, start: i.start_dt_utc + 'Z', updated: i.modified_dt_utc + 'Z',
      }))
    if (det.status === 'fulfilled')
      det.value.forEach((d, n) => d.latitude && events.push({
        id: `cd${n}`, kind: 'construction', src: 'city', title: (d.construction_info ?? 'Construction').trim(), detail: (d.description ?? '').replace(/¿/g, '\n').replace(/\t/g, ' ').trim(),
        lat: +d.latitude, lon: +d.longitude, start: d.start_dt, end: d.end_dt,
      }))

    if (ctx.env.AB511_KEY) {
      const o = await official(ctx.env).catch(() => null)
      return { updated: now.toISOString(), events: [...events, ...(o?.events ?? [])], alerts: o?.alerts ?? [], partial: !o || inc.status === 'rejected' }
    }

    const types = [['Incidents', 'incident'], ['Closures', 'closure'], ['Construction', 'construction']] as const
    const icons = await Promise.allSettled(types.map(([t]) => getJSON<Icons>(`https://511.alberta.ca/map/mapIcons/${t}`, 120)))
    const wanted = types.flatMap(([t, kind], i) => {
      const r = icons[i]
      return r.status === 'fulfilled' ? r.value.item2.filter((x) => inBox(x.location[0], x.location[1])).map((x) => ({ t, kind, x })) : []
    }).slice(0, 38)
    const details = await Promise.all(wanted.map((w) => abDetail(w.t, w.x.itemId).catch(() => null)))
    wanted.forEach((w, i) => {
      const d = details[i]
      if (d) events.push({ id: `ab${w.t[0]}${w.x.itemId}`, kind: w.kind, src: 'ab', lat: w.x.location[0], lon: w.x.location[1], ...d })
    })
    return { updated: now.toISOString(), events, alerts: [] }
  })
