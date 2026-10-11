// Cameras that don't go through our picture proxy:
// Edmonton's are live HLS video, and their id carries the stream's server, forge and code;
// Banff's server refuses Cloudflare, and Saskatchewan's pictures are 1080p and up to 800 KB, so the browser loads
// both straight from their source.
export const isLive = (id: string) => id.startsWith('e')
const DIRECT: Record<string, (rest: string) => string> = {
  b: (f) => `https://ftp.banff.ca/images/${encodeURIComponent(f)}.jpg`,
  s: (n) => `https://hotline.gov.sk.ca/map/Cctv/${encodeURIComponent(n)}`,
}
export const isStill = (id: string) => id[0] in DIRECT
export const isDirect = (id: string) => isLive(id) || isStill(id)
export function streamUrl(id: string) {
  const [host, forge, code] = id.slice(1).split('/')
  return `https://${host}/${forge}/public/hls/${code}.m3u8`
}
/** A direct picture's URL; the minute in the query string makes the browser fetch a fresh one each minute. */
export const directUrl = (id: string, minute: number) => `${DIRECT[id[0]](id.slice(1))}?m=${minute}`
