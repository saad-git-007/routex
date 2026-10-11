import { useEffect, useMemo, useState } from 'react'
import { readTile, siteFor, tileOf, WTA_SITES, type Meaning } from '../../shared/wta'
import type { RoadCondition } from './types'

// Road conditions outside Alberta, from the provincial 511 sites' map tiles (see shared/wta.ts). Detailed tiles
// (zoom 11, about 12 km across) are loaded only around the points the app asks about, plus the visible map for the
// "All highway conditions" layer. Tiles and legends are kept for five minutes and shared by every caller.

const NEAR_Z = 11
const TTL = 5 * 60e3
type Seg = { style: string; lines: [number, number][][] }

const legends = new Map<string, Promise<Record<string, Meaning>>>()
const legend = (s: string) => {
  let p = legends.get(s)
  if (!p) {
    p = fetch(`/api/wta?s=${s}&legend=1`).then((r) => r.json()).then((j: { styles: Record<string, Meaning> }) => j.styles)
    p.catch(() => legends.delete(s))
    legends.set(s, p)
  }
  return p
}

const tiles = new Map<string, { at: number; p: Promise<Seg[]> }>()
function tile(s: string, z: number, x: number, y: number) {
  const key = `${s}/${z}/${x}/${y}`, hit = tiles.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.p
  const p = fetch(`/api/wta?s=${s}&z=${z}&x=${x}&y=${y}`)
    .then((r) => (r.status === 200 ? r.arrayBuffer() : null))
    .then((b) => (b ? readTile(b, x, y, z, 'segments').map((f) => ({ style: f.props.style, lines: f.lines })) : []))
  p.catch(() => tiles.delete(key))
  tiles.set(key, { at: Date.now(), p })
  return p
}

/** Load a set of tiles ("site/z/x/y" keys) and turn their segments into road conditions. */
async function load(keys: string[]): Promise<RoadCondition[]> {
  const out: RoadCondition[] = []
  await Promise.all(keys.map(async (k) => {
    const [s, z, x, y] = k.split('/')
    const [segs, meaning] = await Promise.all([tile(s, +z, +x, +y), legend(s)]).catch(() => [[], {}] as [Seg[], Record<string, Meaning>])
    for (const f of segs) {
      const m = meaning[f.style]
      if (!m) continue
      for (const line of f.lines)
        out.push({ id: 0, hwy: '', segment: '', condition: m.condition, extra: m.poorVisibility ? ['Poor visibility'] : [], visibility: '', updated: '', stale: false, line })
    }
  }))
  return out.map((r, i) => ({ ...r, id: i + 1 }))
}

function useTiles(keys: string[]) {
  const key = keys.join(',')
  const [roads, setRoads] = useState<RoadCondition[]>([])
  useEffect(() => {
    if (!key) { setRoads([]); return }
    let live = true
    const run = () => load(key.split(',')).then((r) => live && setRoads(r))
    run()
    const t = setInterval(run, TTL)
    return () => { live = false; clearInterval(t) }
  }, [key])
  return roads
}

export type View = { w: number; s: number; e: number; n: number; zoom: number }

/**
 * Road conditions for a province other than Alberta: `near` covers the given points in detail (for camera notes and
 * the route); `overlay` covers the visible map (detailed when zoomed in, coarser when zoomed out).
 */
export function useWtaRoads(prov: string, points: { lat: number; lon: number }[], view: View | null) {
  const nearKeys = useMemo(() => {
    if (!WTA_SITES[prov]) return []
    const set = new Set<string>()
    for (const p of points) {
      const s = siteFor(prov, p.lat, p.lon)
      if (s) { const [x, y] = tileOf(p.lat, p.lon, NEAR_Z); set.add(`${s}/${NEAR_Z}/${x}/${y}`) }
      if (set.size >= 60) break
    }
    return [...set].sort()
  }, [prov, points])
  const viewKeys = useMemo(() => {
    if (!view || !WTA_SITES[prov]) return []
    // Zoomed out, a coarse tile is fine (the error is a pixel or two); from zoom 9, detailed ones.
    const z = view.zoom >= 9 ? NEAR_Z : Math.max(5, Math.min(8, Math.floor(view.zoom)))
    const [x0, y0] = tileOf(view.n, view.w, z), [x1, y1] = tileOf(view.s, view.e, z)
    const out: string[] = []
    for (const [s, [w, so, e, n]] of WTA_SITES[prov]) {
      if (view.e < w || view.w > e || view.n < so || view.s > n) continue
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${s}/${z}/${x}/${y}`)
    }
    return out.length > 48 ? [] : out
  }, [prov, view])
  return { near: useTiles(nearKeys), overlay: useTiles(viewKeys) }
}
