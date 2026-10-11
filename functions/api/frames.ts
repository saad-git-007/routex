import { ITERIS } from '../../shared/canada'
import { UA } from '../../shared/edge'

// One call returns the latest picture of up to 40 cameras. The client sends what it already holds
// (`id:lastModified`), and only newer pictures come back, as base64. Upstream images are cached at the
// edge for 60 s, so each camera's source is asked at most once a minute however many people are watching.

const MAX = 40
// Each camera id starts with a letter for its source (see shared/canada.ts and functions/api/cameras.ts).
const source = (id: string) => {
  const k = id[0], n = id.slice(1)
  if (ITERIS[k] && /^\d{1,7}$/.test(n)) return `https://${ITERIS[k].host}/map/Cctv/${n}`
  if (/^\d{1,7}$/.test(n)) {
    if (k === 't') return `https://opendata.toronto.ca/transportation/tmc/rescucameraimages/CameraImages/loc${n}.jpg`
    if (k === 'y') return `https://ww5.yorkmaps.ca/webtrafficimages/loc${n}.jpg`
    if (k === 'w') return `https://traffic.ottawa.ca/map/camera?id=${n}`
    if (k === 'd') return `https://www.drivebc.ca/images/${n}.jpg`
  }
  if (k === 'r' && /^[\w-]+\/[\w.-]+\.jpg$/.test(n)) return `https://stcameleonprod.blob.core.windows.net/prodcameleon-blob/${n}`
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
      const type = r.headers.get('content-type') ?? ''
      // 511 sites answer a dead camera with a "No live camera feed" PNG; their real pictures are JPEGs.
      if (!r.ok || !type.startsWith('image/') || (ITERIS[id[0]] && type.includes('png'))) { r.body?.cancel(); return { id, error: r.status } }
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
