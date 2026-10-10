import type { IconName } from '../components/Icon'
import { offLine } from './geo'
import type { OnRoute, RoadCondition, RoadEvent, Station, Weather } from './types'

// WMO weather codes (Open-Meteo) → a short word and an icon.
export function sky(code: number): { text: string; icon: IconName } {
  if (code === 0) return { text: 'Clear', icon: 'sun' }
  if (code <= 2) return { text: 'Partly cloudy', icon: 'cloud' }
  if (code === 3) return { text: 'Overcast', icon: 'cloud' }
  if (code <= 48) return { text: 'Fog', icon: 'fog' }
  if (code <= 55) return { text: 'Drizzle', icon: 'rain' }
  if (code <= 57) return { text: 'Freezing drizzle', icon: 'rain' }
  if (code <= 65) return { text: 'Rain', icon: 'rain' }
  if (code <= 67) return { text: 'Freezing rain', icon: 'rain' }
  if (code <= 77) return { text: 'Snow', icon: 'snow' }
  if (code <= 82) return { text: 'Showers', icon: 'rain' }
  if (code <= 86) return { text: 'Snow showers', icon: 'snow' }
  return { text: 'Thunderstorm', icon: 'storm' }
}

/** Things about the weather a driver should know, as short phrases. */
export function weatherFlags(w: Weather): string[] {
  const f: string[] = []
  if (w.snow > 0 || (w.code >= 71 && w.code <= 77) || w.code === 85 || w.code === 86) f.push('Snow')
  if (w.code === 56 || w.code === 57 || w.code === 66 || w.code === 67 || (w.precip > 0 && w.temp <= 0.5)) f.push('Icy')
  if (w.visibility < 1000) f.push('Low visibility')
  if (w.gusts >= 60) f.push(`Gusts ${Math.round(w.gusts)} km/h`)
  return f
}

const GOOD = /bare (dry|wet)|seasonal|good/i

// 511 Alberta's winter road report, from best to worst. Colours are shared by the map, the strip and the legend.
export type Grade = 'dry' | 'wet' | 'partly' | 'covered' | 'closed' | 'unknown'
export const GRADES: { key: Grade; label: string; color: string }[] = [
  { key: 'dry', label: 'Bare, dry', color: '#5fd39a' },
  { key: 'wet', label: 'Bare, wet', color: '#b9dc5e' },
  { key: 'partly', label: 'Partly snow or ice covered', color: '#f5c542' },
  { key: 'covered', label: 'Snow or ice covered', color: '#f28c38' },
  { key: 'closed', label: 'Travel not recommended or closed', color: '#f2626b' },
  { key: 'unknown', label: 'Not reported', color: '#8a94a6' },
]
export const GRADE_COLOR = Object.fromEntries(GRADES.map((g) => [g.key, g.color])) as Record<Grade, string>
export function roadGrade(r: RoadCondition): Grade {
  const c = r.condition.toLowerCase()
  if (/closed|not recommended|impassable/.test(c)) return 'closed'
  if (/partl|partial|patch|track|centre bare|center bare/.test(c)) return 'partly'
  if (/cover|packed|snow|ice|icy|slush|drift/.test(c)) return 'covered'
  if (/wet/.test(c)) return 'wet'
  if (/bare|dry|seasonal|good/.test(c)) return 'dry'
  return 'unknown'
}
export const roadIsGood = (r: RoadCondition) => GOOD.test(r.condition) && !r.extra.length

export type Level = 'clear' | 'caution' | 'heavy'
export function routeLevel(events: OnRoute<RoadEvent>[], roads: RoadCondition[], weather: Weather[], staleCams: number, stations: Station[] = [], alerts = 0): { level: Level; reasons: string[] } {
  const incidents = events.filter((e) => e.kind === 'incident').length
  const closures = events.filter((e) => e.kind === 'closure').length
  const works = events.filter((e) => e.kind === 'construction').length
  const badRoads = roads.filter((r) => !roadIsGood(r)).length
  const flags = [...new Set([...weather.flatMap(weatherFlags), ...(stations.some((s) => s.pavement <= 0) ? ['Icy'] : [])])]
  const reasons: string[] = []
  if (closures) reasons.push(`${closures} closure${closures > 1 ? 's' : ''}`)
  if (incidents) reasons.push(`${incidents} incident${incidents > 1 ? 's' : ''}`)
  if (badRoads) reasons.push(`${badRoads} highway segment${badRoads > 1 ? 's' : ''} not bare`)
  reasons.push(...flags)
  if (works) reasons.push(`${works} construction`)
  if (alerts) reasons.push(`${alerts} weather alert${alerts > 1 ? 's' : ''}`)
  if (staleCams) reasons.push(`${staleCams} camera${staleCams > 1 ? 's' : ''} not updating`)
  const heavy = closures > 0 || incidents >= 3 || flags.includes('Icy') || flags.includes('Snow') || badRoads >= 3
  const caution = alerts > 0 || incidents > 0 || badRoads > 0 || flags.length > 0 || works >= 3
  return { level: heavy ? 'heavy' : caution ? 'caution' : 'clear', reasons }
}
export const LEVEL_TEXT: Record<Level, string> = { clear: 'Clear', caution: 'Caution', heavy: 'Slow going' }

/** The 511 highway segment a camera looks at: the closest segment line within `near` metres. City streets have none. */
export function roadAt(p: { lat: number; lon: number }, roads: RoadCondition[], near = 250) {
  let best: RoadCondition | null = null, d = near
  for (const r of roads) {
    if (!r.line?.length) continue
    const off = offLine(p.lat, p.lon, r.line)
    if (off < d) { d = off; best = r }
  }
  return best
}
