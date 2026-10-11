import { ITERIS } from '../../shared/canada'
import { cached, UA } from '../../shared/edge'
import { legendFromPage } from '../../shared/wta'

// A provincial 511 site's winter-road map, piece by piece: ?s=<site letter>&legend=1 for what each style code means
// (from the site's map page, cached a day), or ?s=…&z=…&x=…&y=… for one vector tile (cached five minutes, so each
// tile is asked of the 511 site at most every five minutes however many people look).

export const onRequestGet: PagesFunction = async (ctx) => {
  const q = new URL(ctx.request.url).searchParams
  const site = ITERIS[q.get('s') ?? '']
  if (!site) return new Response('unknown site', { status: 404 })
  if (q.get('legend')) {
    return cached(ctx, 86400, async () => {
      const r = await fetch(`https://${site.host}/map`, { headers: { 'user-agent': UA }, cf: { cacheTtl: 86400, cacheEverything: true } })
      const styles = r.ok ? legendFromPage(await r.text()) : {}
      return { styles, partial: !Object.keys(styles).length }
    })
  }
  const [z, x, y] = ['z', 'x', 'y'].map((k) => Number(q.get(k)))
  if (![z, x, y].every(Number.isInteger) || z < 5 || z > 12 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return new Response('bad tile', { status: 400 })
  const r = await fetch(`https://${site.host}/map/mapWtaVector/${x}/${y}/${z}`, { headers: { 'user-agent': UA }, cf: { cacheTtl: 300, cacheEverything: true } })
  return new Response(r.status === 200 ? r.body : null, {
    status: r.status === 200 ? 200 : 204,
    headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'public, max-age=300' },
  })
}
