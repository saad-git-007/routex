export type Place = { id: string; label: string; lat: number; lon: number }
export type Camera = { id: string; src: 'city' | 'ab' | 'town'; name: string; area: string; lat: number; lon: number }
export type RoadEvent = {
  id: string; kind: 'incident' | 'closure' | 'construction'; src: 'city' | 'ab'
  title: string; detail: string; lat: number; lon: number; start?: string; end?: string; updated?: string
}
export type RoadCondition = { id: number; hwy: string; segment: string; condition: string; extra: string[]; visibility: string; updated: string; stale: boolean; line?: [number, number][] }
export type Community = { name: string; kind: 'home' | 'industry' | 'park'; label: [number, number]; rings: [number, number][][] }
export type Station = { id: number; lat: number; lon: number; air: number; pavement: number; wind: number; updated: number }
export type Alert = { id: number; title: string; notes: string; end?: string; high: boolean }
export type TripShape = 'round' | 'oneway'
export type OptimizeBy = 'distance' | 'time'

export type Leg = { from: Place; to: Place; duration: number; distance: number }
export type Route = {
  order: Place[]            // home first, then stops in driving order, home again for a round trip
  coords: [number, number][] // [lat, lon]
  cum: number[]              // metres along the route at each coord
  legs: Leg[]
  legStart: number[]         // metres along the route where each leg starts
  duration: number; distance: number
  highways: string[]         // "Hwy 201", "Hwy 2", ...
  // How the stop order was chosen: cost (metres or seconds) of the best order vs the order the stops were added.
  opt: { by: OptimizeBy; best: number; entered: number; exact: boolean; reordered: boolean } | null
}
export type OnRoute<T> = T & { along: number; off: number; leg: number }

export type Weather = {
  lat: number; lon: number; label: string; along: number
  temp: number; feels: number; code: number; wind: number; gusts: number; precip: number; snow: number; visibility: number
  nextPrecip: number // max precipitation probability over the next 3 hours, %
}
