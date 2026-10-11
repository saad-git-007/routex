
// Winter road conditions from the provincial 511 sites (same software as 511 Alberta). Their public map draws them
// from vector tiles (/map/mapWtaVector/{x}/{y}/{z}) where each road segment carries a style code, and the map page
// says what each code means. Tiles are simplified heavily when zoomed out (over 1 km off at zoom 6), so the app asks
// for detailed tiles (zoom 11) only where it needs them: around cameras, along the route and in the visible map.
// Shared by the app (decoding) and functions/api/wta.ts (proxying tiles, reading legends).

type Box = [w: number, s: number, e: number, n: number]
/** Each province's 511 sites (the letter matches camera ids and shared/canada.ts) and the box their roads fall in. */
export const WTA_SITES: Record<string, [letter: string, box: Box][]> = {
  on: [['o', [-95.2, 41.6, -74.3, 56.9]]],
  sk: [['s', [-110.1, 49, -101.3, 60]]],
  mb: [['m', [-102.1, 48.9, -88.9, 60]]],
  atl: [['n', [-69.1, 44.5, -63.7, 48.1]], ['v', [-66.4, 43.3, -59.6, 47.1]], ['p', [-64.5, 45.9, -61.9, 47.1]], ['l', [-67.9, 46.6, -52.5, 60.4]]],
  yt: [['k', [-141.1, 60, -123.8, 69.7]]],
}
export type Meaning = { condition: string; poorVisibility: boolean }

// ── Mapbox vector tile, just enough to read line features and their properties ──
function* fields(b: Uint8Array, start = 0, end = b.length) {
  let i = start
  const varint = () => { let r = 0, s = 0, c: number; do { c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7 } while (c >= 0x80); return r }
  while (i < end) {
    const key = varint(), f = Math.floor(key / 8), t = key & 7
    if (t === 0) yield { f, v: varint(), a: 0, z: 0 }
    else if (t === 2) { const n = varint(); yield { f, v: 0, a: i, z: i + n }; i += n }
    else if (t === 5) i += 4
    else if (t === 1) i += 8
    else return
  }
}
function packed(b: Uint8Array, a: number, z: number) {
  const out: number[] = []
  let i = a
  while (i < z) { let r = 0, s = 0, c: number; do { c = b[i++]; r += (c & 0x7f) * 2 ** s; s += 7 } while (c >= 0x80); out.push(r) }
  return out
}
const text = new TextDecoder()

/** Line features of one layer in a tile, as lat/lon lines with their string properties. */
export function readTile(buf: ArrayBuffer, x: number, y: number, z: number, layerName: string) {
  const b = new Uint8Array(buf)
  const out: { props: Record<string, string>; lines: [number, number][][] }[] = []
  for (const l of fields(b)) {
    if (l.f !== 3) continue
    let name = '', extent = 4096
    const keys: string[] = [], vals: string[] = [], feats: [number, number][] = []
    for (const g of fields(b, l.a, l.z)) {
      if (g.f === 1) name = text.decode(b.subarray(g.a, g.z))
      else if (g.f === 3) keys.push(text.decode(b.subarray(g.a, g.z)))
      else if (g.f === 4) { let v = ''; for (const h of fields(b, g.a, g.z)) { v = h.f === 1 ? text.decode(b.subarray(h.a, h.z)) : String(h.v) } vals.push(v) }
      else if (g.f === 5) extent = g.v
      else if (g.f === 2) feats.push([g.a, g.z])
    }
    if (name !== layerName) continue
    const n = 2 ** z
    const toLL = (px: number, py: number): [number, number] => {
      const lon = ((x + px / extent) / n) * 360 - 180
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / extent)) / n))) * 180) / Math.PI
      return [+lat.toFixed(5), +lon.toFixed(5)]
    }
    for (const [a, z2] of feats) {
      let tags: number[] = [], geom: number[] = []
      for (const g of fields(b, a, z2)) { if (g.f === 2) tags = packed(b, g.a, g.z); else if (g.f === 4) geom = packed(b, g.a, g.z) }
      const props: Record<string, string> = {}
      for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]]
      // Geometry commands: MoveTo starts a line, LineTo extends it (zig-zag encoded deltas).
      const lines: [number, number][][] = []
      let cx = 0, cy = 0, i = 0
      while (i < geom.length) {
        const cmd = geom[i] & 7, count = geom[i] >> 3; i++
        for (let k = 0; k < count && cmd !== 7; k++) {
          const dx = geom[i++], dy = geom[i++]
          cx += (dx >> 1) ^ -(dx & 1); cy += (dy >> 1) ^ -(dy & 1)
          if (cmd === 1) lines.push([toLL(cx, cy)])
          else lines[lines.length - 1]?.push(toLL(cx, cy))
        }
      }
      out.push({ props, lines: lines.filter((p) => p.length > 1) })
    }
  }
  return out
}

// ── What each style code means on a given site, read from its map page ──
export function legendFromPage(page: string): Record<string, Meaning> {
  const html = page.replace(/&quot;/g, '"').replace(/\\"/g, '"')
  // The style table: {"4":{"StrokeColour":"#999999",…},"4Visibility":{…},…} under the layer's name.
  const at = html.search(/"(RoadConditions|WinterRoads)":\{"\d/)
  if (at < 0) return {}
  let depth = 0, end = html.indexOf('{', at)
  const start = end
  for (; end < html.length; end++) { if (html[end] === '{') depth++; else if (html[end] === '}' && --depth === 0) break }
  const styles = JSON.parse(html.slice(start, end + 1)) as Record<string, { StrokeColour: string; OutlineDash: number[] | null }>
  // The legend follows the layer's checkbox; its winter-road part ends where a colour repeats.
  const box = html.search(/id="(WinterRoads|RoadConditions)"/)
  const names = new Map<string, string>()
  for (const m of html.slice(box, box + 8000).matchAll(/background:\s*(#[0-9A-Fa-f]{6});?['"]?>\s*<\/span>\s*<label>([^<]*)<\/label>/g)) {
    const c = m[1].toLowerCase()
    if (names.has(c)) break
    names.set(c, m[2].replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim())
  }
  return Object.fromEntries(Object.entries(styles).map(([code, st]) => [code, {
    condition: names.get(st.StrokeColour.toLowerCase()) ?? 'No Report', poorVisibility: /Visibility$/.test(code) || !!st.OutlineDash,
  }]))
}

/** Tile x/y at zoom z for a point (Web Mercator, the same scheme as the map). */
export function tileOf(lat: number, lon: number, z: number): [number, number] {
  const n = 2 ** z, r = (lat * Math.PI) / 180
  return [Math.floor(((lon + 180) / 360) * n), Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)]
}
/** The site whose box holds a point, among a province's sites. */
export const siteFor = (prov: string, lat: number, lon: number) =>
  WTA_SITES[prov]?.find(([, [w, s, e, n]]) => lon >= w && lon <= e && lat >= s && lat <= n)?.[0]
