// What the map and lists show. Hiding a layer only hides it; the route's Clear/Caution level still counts everything.
export type LayerKey = 'city' | 'ab' | 'town' | 'others' | 'incident' | 'closure' | 'construction' | 'roads' | 'allRoads'

export const LAYERS: { key: LayerKey; label: string; group: 'Cameras' | 'On the road'; tripOnly?: boolean; albertaOnly?: boolean }[] = [
  { key: 'city', label: 'City cameras', group: 'Cameras' },
  { key: 'ab', label: '511 cameras', group: 'Cameras' },
  { key: 'town', label: 'Edmonton & Banff', group: 'Cameras', albertaOnly: true },
  { key: 'others', label: 'Off-route cameras', group: 'Cameras', tripOnly: true },
  { key: 'incident', label: 'Incidents', group: 'On the road' },
  { key: 'closure', label: 'Closures', group: 'On the road' },
  { key: 'construction', label: 'Construction', group: 'On the road' },
  { key: 'roads', label: 'Conditions on route', group: 'On the road', tripOnly: true },
  { key: 'allRoads', label: 'All highway conditions', group: 'On the road' },
]

/** The 511-type cameras' chip, named after who runs them in each province. */
const PROV_CAMS: Record<string, string> = { ab: '511 Alberta cameras', bc: 'DriveBC cameras', sk: 'Highway Hotline cameras', mb: 'Manitoba 511 cameras', on: 'Ontario 511 cameras', atl: 'Provincial 511 cameras', yt: 'Yukon 511 cameras' }
export const layerLabel = (key: LayerKey, prov: string) => (key === 'ab' ? PROV_CAMS[prov] ?? '511 cameras' : LAYERS.find((l) => l.key === key)!.label)
/** Provinces with no road-condition feed (BC publishes none we can read). */
export const NO_ROADS = new Set(['bc'])

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = { city: true, ab: true, town: true, others: true, incident: true, closure: true, construction: true, roads: true, allRoads: false }

/** Who runs a camera, from its id's first letter. */
const SOURCES: Record<string, string> = {
  c: 'City of Calgary', a: '511 Alberta', e: 'City of Edmonton', b: 'Town of Banff',
  t: 'City of Toronto', y: 'York Region', o: 'Ontario 511', w: 'City of Ottawa',
  d: 'DriveBC', r: 'City of Surrey', s: 'Saskatchewan Highway Hotline', m: 'Manitoba 511',
  n: 'New Brunswick 511', v: 'Nova Scotia 511', p: 'PEI 511', l: 'Newfoundland and Labrador 511', k: 'Yukon 511',
}
export const sourceLabel = (c: { id: string }) => SOURCES[c.id[0]] ?? 'Traffic camera'
