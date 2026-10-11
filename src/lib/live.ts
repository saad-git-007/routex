// Cameras that don't go through our picture proxy:
// Edmonton's are live HLS video, and their id carries the stream's server, forge and code;
// Banff's server refuses Cloudflare, so the browser loads its pictures straight from banff.ca.
export const isLive = (id: string) => id.startsWith('e')
export const isBanff = (id: string) => id.startsWith('b')
export const isDirect = (id: string) => isLive(id) || isBanff(id)
export function streamUrl(id: string) {
  const [host, forge, code] = id.slice(1).split('/')
  return `https://${host}/${forge}/public/hls/${code}.m3u8`
}
/** The current Banff picture; the minute in the query string makes the browser fetch a fresh one each minute. */
export const banffUrl = (id: string, minute: number) => `https://ftp.banff.ca/images/${encodeURIComponent(id.slice(1))}.jpg?m=${minute}`
