// What the map and lists show. Hiding a layer only hides it; the route's Clear/Caution level still counts everything.
export type LayerKey = 'city' | 'ab' | 'town' | 'others' | 'incident' | 'closure' | 'construction' | 'roads' | 'allRoads'

export const LAYERS: { key: LayerKey; label: string; group: 'Cameras' | 'On the road'; tripOnly?: boolean }[] = [
  { key: 'city', label: 'City cameras', group: 'Cameras' },
  { key: 'ab', label: '511 cameras', group: 'Cameras' },
  { key: 'town', label: 'Edmonton & Banff', group: 'Cameras' },
  { key: 'others', label: 'Off-route cameras', group: 'Cameras', tripOnly: true },
  { key: 'incident', label: 'Incidents', group: 'On the road' },
  { key: 'closure', label: 'Closures', group: 'On the road' },
  { key: 'construction', label: 'Construction', group: 'On the road' },
  { key: 'roads', label: 'Conditions on route', group: 'On the road', tripOnly: true },
  { key: 'allRoads', label: 'All highway conditions', group: 'On the road' },
]

export const DEFAULT_LAYERS: Record<LayerKey, boolean> = { city: true, ab: true, town: true, others: true, incident: true, closure: true, construction: true, roads: true, allRoads: false }

/** Who runs a camera, for labels. */
export const sourceLabel = (c: { src: 'city' | 'ab' | 'town'; area: string }) =>
  c.src === 'city' ? 'City of Calgary' : c.src === 'ab' ? '511 Alberta' : c.area === 'Edmonton' ? 'City of Edmonton' : 'Town of Banff'
