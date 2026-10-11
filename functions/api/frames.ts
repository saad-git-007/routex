import { UA } from '../../shared/edge'

// One call returns the latest picture of up to 40 cameras. The client sends what it already holds
// (`id:lastModified`), and only newer pictures come back, as base64. Upstream images are cached at the
// edge for 60 s, so each camera's source is asked at most once a minute however many people are watching.

const MAX = 40
const source = (id: string) => {
  const g = id.match(/^([oty])(\d{1,7})$/)
  if (g) return g[1] === 'o' ? `https://511on.ca/map/Cctv/${g[2]}` : g[1] === 't' ? `https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc${g[2]}.jpg` : `https://ww5.yorkmaps.ca/webtrafficimages/loc${g[2]}.jpg`
  const m = id.match(/^([ca])(\d{1,6})$/)
  if (!m) return null
  return m[1] === 'c' ? `https://trafficcam.calgary.ca/loc${m[2]}.jpg` : `https://511.alberta.ca/map/Cctv/${m[2]}`
}

function b64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export const onRequestGet: PagesFunction = async ({ request }) => {
  const want = (new URL(request.url).searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, MAX)
  const frames = await Promise.all(want.map(async (pair) => {
    const [id, have] = pair.split(':')
    const url = source(id)
    if (!url) return null
    try {
      const r = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 60, cacheEverything: true } })
      if (!r.ok || !(r.headers.get('content-type') ?? '').startsWith('image/')) return { id, error: r.status }
      const lm = Date.parse(r.headers.get('last-modified') ?? '') || Date.now()
      if (have && +have >= lm) { r.body?.cancel(); return { id, lm } }
      return { id, lm, data: b64(await r.arrayBuffer()), edge: r.headers.get('cf-cache-status') }
    } catch {
      return { id, error: 0 }
    }
  }))
  return new Response(JSON.stringify({ at: Date.now(), frames: frames.filter(Boolean) }), {
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  })
}
