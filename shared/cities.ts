// Shared by the app and the Pages Functions (functions/api/cities.ts counts cameras per city).
type Camera = { id: string; lat: number; lon: number }

// Cities and towns, with how far out (km) a camera still counts as theirs. Only the ones with at least one camera
// are offered; the counts come from the live camera list. Each province's cameras are loaded separately.
export type Province = 'ab' | 'bc' | 'sk' | 'mb' | 'on' | 'atl' | 'yt'
export const PROVINCES: { key: Province; label: string; short: string }[] = [
  { key: 'bc', label: 'British Columbia', short: 'BC' },
  { key: 'ab', label: 'Alberta', short: 'Alberta' },
  { key: 'sk', label: 'Saskatchewan', short: 'Saskatchewan' },
  { key: 'mb', label: 'Manitoba', short: 'Manitoba' },
  { key: 'on', label: 'Ontario', short: 'Ontario' },
  { key: 'atl', label: 'Atlantic Canada', short: 'Atlantic' },
  { key: 'yt', label: 'Yukon', short: 'Yukon' },
]
export type City = { key: string; name: string; lat: number; lon: number; km: number; prov: Province }
const ALBERTA = ([
  ['Calgary', 51.045, -114.07, 20], ['Edmonton', 53.546, -113.49, 20], ['Airdrie', 51.29, -114.01, 7], ['Cochrane', 51.19, -114.47, 7],
  ['Chestermere', 51.05, -113.82, 5], ['Okotoks', 50.725, -113.975, 7], ['Strathmore', 51.04, -113.4, 7], ['High River', 50.58, -113.87, 7],
  ['Canmore', 51.09, -115.35, 7], ['Banff', 51.178, -115.57, 6], ['Lake Louise', 51.43, -116.18, 10], ['Red Deer', 52.27, -113.81, 12],
  ['Lethbridge', 49.69, -112.84, 12], ['Medicine Hat', 50.04, -110.68, 12], ['Grande Prairie', 55.17, -118.8, 15], ['Fort McMurray', 56.73, -111.38, 15],
  ['St. Albert', 53.63, -113.62, 5], ['Sherwood Park', 53.52, -113.3, 7], ['Spruce Grove', 53.545, -113.91, 6], ['Stony Plain', 53.53, -114.0, 5],
  ['Leduc', 53.26, -113.55, 7], ['Fort Saskatchewan', 53.71, -113.21, 7], ['Beaumont', 53.36, -113.41, 4], ['Camrose', 53.02, -112.83, 10],
  ['Brooks', 50.56, -111.9, 10], ['Lloydminster', 53.28, -110.0, 10], ['Hinton', 53.4, -117.57, 12], ['Jasper', 52.88, -118.08, 12],
  ['Whitecourt', 54.14, -115.68, 12], ['Edson', 53.58, -116.44, 12], ['Olds', 51.79, -114.1, 8], ['Drumheller', 51.46, -112.71, 10],
  ['Sylvan Lake', 52.31, -114.08, 8], ['Lacombe', 52.47, -113.73, 8], ['Wetaskiwin', 52.97, -113.37, 8], ['Cold Lake', 54.46, -110.18, 12],
  ['Slave Lake', 55.28, -114.77, 12], ['Peace River', 56.23, -117.29, 12], ['High Level', 58.52, -117.14, 15], ['Athabasca', 54.72, -113.29, 12],
  ['Bonnyville', 54.27, -110.74, 10], ['Taber', 49.78, -112.15, 8], ['Pincher Creek', 49.49, -113.95, 10], ['Crowsnest Pass', 49.63, -114.48, 12],
  ['Fort Macleod', 49.72, -113.41, 8], ['Cardston', 49.2, -113.3, 10], ['Coutts', 49.0, -111.96, 8], ['Waterton', 49.05, -113.91, 10],
  ['Nanton', 50.35, -113.77, 8], ['Claresholm', 50.03, -113.58, 8], ['Valleyview', 55.07, -117.27, 12], ['Fox Creek', 54.4, -116.81, 12],
  ['Hanna', 51.64, -111.93, 10], ['Ponoka', 52.68, -113.58, 8], ['Innisfail', 52.03, -113.95, 8], ['Didsbury', 51.66, -114.13, 6],
  ['Vegreville', 53.49, -112.05, 8], ['Vermilion', 53.35, -110.85, 8], ['Rocky Mountain House', 52.37, -114.92, 10], ['Westlock', 54.15, -113.86, 8],
  ['Barrhead', 54.12, -114.4, 8], ['St. Paul', 53.99, -111.29, 8],
] as const)
const GTA = ([
  ['Toronto', 43.70, -79.40, 20], ['Mississauga', 43.59, -79.64, 12], ['Brampton', 43.73, -79.76, 10], ['Vaughan', 43.84, -79.51, 9],
  ['Markham', 43.88, -79.26, 9], ['Richmond Hill', 43.88, -79.44, 6], ['Oakville', 43.45, -79.69, 9], ['Burlington', 43.33, -79.80, 8],
  ['Hamilton', 43.24, -79.86, 14], ['Milton', 43.52, -79.88, 8], ['Oshawa', 43.90, -78.86, 8], ['Whitby', 43.88, -78.94, 6],
  ['Ajax', 43.85, -79.03, 5], ['Pickering', 43.84, -79.09, 6], ['Newmarket', 44.05, -79.46, 6], ['Aurora', 44.0, -79.45, 4],
  ['Clarington', 43.92, -78.69, 10], ['Caledon', 43.86, -79.86, 12], ['Halton Hills', 43.63, -79.95, 8], ['Whitchurch-Stouffville', 43.97, -79.25, 6],
  ['King', 43.93, -79.53, 8], ['East Gwillimbury', 44.1, -79.44, 6], ['Georgina', 44.29, -79.43, 10], ['Grimsby', 43.19, -79.56, 8],
] as const)
const ONTARIO = ([
  ['Ottawa', 45.38, -75.70, 22], ['Kingston', 44.25, -76.50, 10], ['London', 42.98, -81.25, 12], ['Kitchener', 43.43, -80.48, 8],
  ['Waterloo', 43.47, -80.53, 5], ['Cambridge', 43.38, -80.31, 7], ['Guelph', 43.55, -80.25, 8], ['Barrie', 44.39, -79.69, 9],
  ['Niagara Falls', 43.09, -79.08, 8], ['St. Catharines', 43.16, -79.24, 8], ['Windsor', 42.30, -83.0, 12], ['Sudbury', 46.49, -80.99, 15],
  ['Sault Ste. Marie', 46.52, -84.33, 12], ['Thunder Bay', 48.40, -89.25, 15], ['North Bay', 46.31, -79.46, 10], ['Peterborough', 44.30, -78.32, 10],
  ['Belleville', 44.16, -77.38, 9], ['Cornwall', 45.02, -74.73, 9], ['Orillia', 44.61, -79.42, 7], ['Huntsville', 45.33, -79.22, 8],
  ['Woodstock', 43.13, -80.75, 7], ['Brantford', 43.14, -80.26, 8], ['Sarnia', 42.97, -82.40, 9], ['Kenora', 49.77, -94.49, 10],
  ['Timmins', 48.48, -81.33, 12], ['Collingwood', 44.50, -80.22, 7], ['Owen Sound', 44.57, -80.94, 7], ['Parry Sound', 45.35, -80.04, 8],
  ['Bracebridge', 45.04, -79.31, 7], ['Pembroke', 45.82, -77.11, 8], ['Brockville', 44.59, -75.68, 7], ['Chatham', 42.40, -82.19, 9],
] as const)
const BC = ([
  ['Vancouver', 49.26, -123.12, 9], ['Surrey', 49.12, -122.80, 12], ['Burnaby', 49.25, -122.98, 6], ['Richmond', 49.17, -123.13, 7],
  ['Coquitlam', 49.28, -122.79, 7], ['North Vancouver', 49.32, -123.07, 6], ['Langley', 49.10, -122.62, 9], ['Abbotsford', 49.05, -122.30, 10],
  ['Chilliwack', 49.16, -121.95, 10], ['Hope', 49.38, -121.44, 10], ['Squamish', 49.70, -123.15, 10], ['Whistler', 50.12, -122.95, 10],
  ['Victoria', 48.45, -123.37, 12], ['Nanaimo', 49.17, -123.94, 12], ['Kelowna', 49.89, -119.49, 14], ['Vernon', 50.27, -119.27, 10],
  ['Penticton', 49.49, -119.59, 10], ['Kamloops', 50.67, -120.33, 14], ['Merritt', 50.11, -120.79, 10], ['Salmon Arm', 50.70, -119.28, 10],
  ['Revelstoke', 51.0, -118.20, 12], ['Golden', 51.30, -116.97, 12], ['Cranbrook', 49.51, -115.77, 12], ['Nelson', 49.49, -117.29, 12],
  ['Castlegar', 49.32, -117.66, 10], ['Prince George', 53.92, -122.75, 15], ['Quesnel', 52.98, -122.49, 10], ['Williams Lake', 52.14, -122.14, 10],
  ['Fort St. John', 56.25, -120.85, 12], ['Dawson Creek', 55.76, -120.24, 10], ['Terrace', 54.52, -128.60, 12], ['Prince Rupert', 54.31, -130.32, 10],
  ['Smithers', 54.78, -127.17, 10], ['Fernie', 49.50, -115.06, 10], ['Sparwood', 49.73, -114.88, 8], ['Courtenay', 49.69, -124.99, 10],
] as const)
const SK = ([
  ['Saskatoon', 52.13, -106.67, 18], ['Regina', 50.45, -104.62, 18], ['Prince Albert', 53.20, -105.75, 12], ['Moose Jaw', 50.39, -105.55, 12],
  ['Swift Current', 50.29, -107.80, 12], ['Yorkton', 51.21, -102.46, 12], ['North Battleford', 52.76, -108.29, 12], ['Estevan', 49.14, -102.99, 12],
  ['Weyburn', 49.66, -103.85, 12], ['Kindersley', 51.47, -109.16, 12], ['Humboldt', 52.20, -105.12, 12], ['Meadow Lake', 54.13, -108.43, 12],
] as const)
const MB = ([
  ['Winnipeg', 49.88, -97.14, 25], ['Brandon', 49.85, -99.95, 15], ['Steinbach', 49.53, -96.68, 12], ['Portage la Prairie', 49.97, -98.29, 12],
  ['Selkirk', 50.14, -96.88, 10], ['Thompson', 55.74, -97.86, 15], ['Dauphin', 51.15, -100.05, 12], ['The Pas', 53.83, -101.25, 12],
  ['Morden', 49.19, -98.10, 12], ['Virden', 49.85, -100.93, 12],
] as const)
const ATLANTIC = ([
  ['Halifax', 44.65, -63.58, 18], ['Truro', 45.36, -63.28, 12], ['Sydney', 46.14, -60.19, 15], ['New Glasgow', 45.59, -62.65, 12],
  ['Antigonish', 45.62, -61.99, 12], ['Amherst', 45.83, -64.21, 12], ['Kentville', 45.08, -64.50, 12], ['Yarmouth', 43.84, -66.12, 12],
  ['Moncton', 46.09, -64.78, 14], ['Saint John', 45.27, -66.06, 14], ['Fredericton', 45.96, -66.64, 14], ['Edmundston', 47.37, -68.33, 12],
  ['Bathurst', 47.62, -65.65, 12], ['Miramichi', 47.03, -65.50, 12], ['Woodstock (NB)', 46.15, -67.60, 12], ['Sackville', 45.90, -64.37, 8],
  ['Charlottetown', 46.24, -63.13, 14], ['Summerside', 46.40, -63.79, 12], ['Borden-Carleton', 46.25, -63.70, 8],
  ["St. John's", 47.56, -52.71, 18], ['Corner Brook', 48.95, -57.95, 15], ['Gander', 48.95, -54.61, 15], ['Grand Falls-Windsor', 48.94, -55.66, 15],
  ['Clarenville', 48.16, -53.97, 15], ['Deer Lake', 49.17, -57.43, 15], ['Port aux Basques', 47.57, -59.14, 15],
] as const)
const YUKON = ([
  ['Whitehorse', 60.72, -135.06, 25], ['Dawson City', 64.06, -139.43, 20], ['Watson Lake', 60.06, -128.71, 20], ['Haines Junction', 60.75, -137.51, 20],
  ['Carmacks', 62.09, -136.29, 20], ['Teslin', 60.17, -132.72, 20],
] as const)
// The Atlantic provinces load together (four small 511 sites) but each city shows its own province.
const NS = ['Halifax', 'Truro', 'Sydney', 'New Glasgow', 'Antigonish', 'Amherst', 'Kentville', 'Yarmouth']
const PE = ['Charlottetown', 'Summerside', 'Borden-Carleton']
const NL = ["St. John's", 'Corner Brook', 'Gander', 'Grand Falls-Windsor', 'Clarenville', 'Deer Lake', 'Port aux Basques']
export const regionName = (c: { name: string; prov: Province }) =>
  c.prov !== 'atl' ? PROVINCES.find((p) => p.key === c.prov)!.label
    : NS.includes(c.name) ? 'Nova Scotia' : PE.includes(c.name) ? 'Prince Edward Island' : NL.includes(c.name) ? 'Newfoundland and Labrador' : 'New Brunswick'
const make = (prov: Province) => ([name, lat, lon, km]: readonly [string, number, number, number]): City =>
  ({ key: name.toLowerCase().replace(/[^a-z]+/g, '-'), name, lat, lon, km, prov })
export const CITIES: City[] = [
  ...ALBERTA.map(make('ab')), ...GTA.map(make('on')), ...ONTARIO.map(make('on')), ...BC.map(make('bc')),
  ...SK.map(make('sk')), ...MB.map(make('mb')), ...ATLANTIC.map(make('atl')), ...YUKON.map(make('yt')),
]

const dist = (c: City, p: { lat: number; lon: number }) =>
  Math.hypot((p.lat - c.lat) * 111.2, (p.lon - c.lon) * 111.2 * Math.cos((c.lat * Math.PI) / 180))

/**
 * The city a camera belongs to: the nearest one (relative to its size) whose radius it falls in. A camera's source
 * settles the Toronto line, which a circle can't: City of Toronto cameras are Toronto's, York Region's never are.
 */
export function cityOf(p: { lat: number; lon: number; id?: string }): City | null {
  if (p.id?.[0] === 't') return CITIES.find((c) => c.key === 'toronto')!
  let best: City | null = null, bd = Infinity
  for (const c of CITIES) {
    if (p.id?.[0] === 'y' && c.key === 'toronto') continue
    const d = dist(c, p) / c.km
    if (d <= 1 && d < bd) { bd = d; best = c }
  }
  return best
}

/** Each city with its camera count. */
export function citiesWithCameras(cams: Camera[]) {
  const n = new Map<string, number>()
  for (const cam of cams) { const c = cityOf(cam); if (c) n.set(c.key, (n.get(c.key) ?? 0) + 1) }
  return CITIES.filter((c) => n.has(c.key)).map((c) => ({ ...c, cams: n.get(c.key)! })).sort((a, b) => a.name.localeCompare(b.name))
}

/** How close to zoom for a city: the big two show the whole city, towns a closer view. */
export const cityZoom = (c: City) => (c.km >= 20 ? 11 : c.km >= 10 ? 12 : 13)
