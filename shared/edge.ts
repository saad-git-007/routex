/// <reference types="@cloudflare/workers-types" />
// Helpers shared by the Pages Functions: an edge cache wrapper and the Calgary region box.

export const UA = 'Mozilla/5.0 (compatible; routex-yyc.pages.dev)'

// Calgary plus the highways out to Airdrie, Cochrane, Okotoks and Canmore.
export const BOX = { s: 50.55, n: 51.65, w: -115.75, e: -113.3 }
export const inBox = (lat: number, lon: number) => lat > BOX.s && lat < BOX.n && lon > BOX.w && lon < BOX.e

export const json = (body: unknown, maxAge: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${maxAge}`, ...extra },
  })

/** Serve from the colo cache when fresh; otherwise build, store for `ttl` seconds and return. */
export async function cached(ctx: { request: Request; waitUntil(p: Promise<unknown>): void }, ttl: number, build: () => Promise<unknown>) {
  const cache = (caches as unknown as { default: Cache }).default
  const u = new URL(ctx.request.url)
  u.searchParams.set('_v', '5') // bump when a response shape changes
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

/** Google encoded polyline → [lat, lon][], thinned to points at least ~40 m apart. */
export function decodePolyline(s: string): [number, number][] {
  const out: [number, number][] = []
  let i = 0, lat = 0, lon = 0
  while (i < s.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number
      do { b = s.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20 && i < s.length)
      const d = result & 1 ? ~(result >> 1) : result >> 1
      if (which === 0) lat += d; else lon += d
    }
    const p: [number, number] = [+(lat / 1e5).toFixed(5), +(lon / 1e5).toFixed(5)]
    const last = out[out.length - 1]
    if (!last || Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) > 0.0008) out.push(p)
  }
  return out
}
