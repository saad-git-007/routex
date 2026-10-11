/// <reference types="@cloudflare/workers-types" />
// Helpers shared by the Pages Functions: an edge cache wrapper and the Calgary region box.

export const UA = 'Mozilla/5.0 (compatible; routex-ca.pages.dev)'

// All of Alberta (and the highway cameras right at its borders).
export const BOX = { s: 48.95, n: 60.05, w: -120.1, e: -109.9 }
export const inBox = (lat: number, lon: number) => lat > BOX.s && lat < BOX.n && lon > BOX.w && lon < BOX.e

export const json = (body: unknown, maxAge: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, ...extra },
  })

/** Serve from the colo cache when fresh; otherwise build, store for `ttl` seconds and return. */
export async function cached(ctx: { request: Request; waitUntil(p: Promise<unknown>): void }, ttl: number, build: () => Promise<unknown>) {
  const cache = (caches as unknown as { default: Cache }).default
  const u = new URL(ctx.request.url)
  u.searchParams.set('_v', '9') // bump when a response shape changes
  const key = new Request(u.toString(), { method: 'GET' })
  const hit = await cache.match(key)
  if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), 'x-edge': 'hit' } })
  const body = (await build()) as { partial?: boolean }
  // A response missing an upstream source is only kept for a minute, so one failed call can't stick for an hour.
  const res = json(body, body.partial ? 60 : ttl, { 'x-edge': 'miss' })
  ctx.waitUntil(cache.put(key, res.clone()))
  return res
}

export async function getJSON<T>(url: string, ttl: number): Promise<T> {
  const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, cf: { cacheTtl: ttl, cacheEverything: true } })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return r.json() as Promise<T>
}

export type Env = { AB511_KEY?: string }

/** Official 511 Alberta API (needs a developer key; 10 calls a minute, so always behind the edge cache). */
export async function ab511<T>(env: Env, what: string, ttl: number): Promise<T> {
  const r = await fetch(`https://511.alberta.ca/api/v2/get/${what}?key=${env.AB511_KEY}&format=json&lang=en`, {
    headers: { 'user-agent': UA, accept: 'application/json' }, cf: { cacheTtl: ttl, cacheEverything: true },
  })
  if (!r.ok) throw new Error(`511 ${what} ${r.status}`)
  return r.json() as Promise<T>
}

/** Google encoded polyline → [lat, lon][], simplified so no point is more than ~20 m off the original line. */
export function decodePolyline(s: string): [number, number][] {
  const pts: [number, number][] = []
  let i = 0, lat = 0, lon = 0
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20 && i < s.length)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += d; else lon += d
    }
    pts.push([+(lat / 1e5).toFixed(4), +(lon / 1e5).toFixed(4)])
  }
  return simplify(pts, 0.0002)
}

/** Douglas–Peucker, in degrees (longitude scaled to Alberta's latitude). Highways are long and straight, so this drops most points. */
export function simplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts
  const k = 0.62, keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const [ay, ax] = pts[a], by = pts[b][0] - ay, bx = (pts[b][1] - ax) * k
    const len = Math.hypot(bx, by) || 1e-12
    let far = -1, farD = tol
    for (let j = a + 1; j < b; j++) {
      const py = pts[j][0] - ay, px = (pts[j][1] - ax) * k
      const d = Math.abs(px * by - py * bx) / len
      if (d > farD) { farD = d; far = j }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]) }
  }
  return pts.filter((_, j) => keep[j])
}
