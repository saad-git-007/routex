import type { StyleSpecification } from 'maplibre-gl'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
export const LIBERTY = 'https://tiles.openfreemap.org/styles/liberty'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'

// The app speaks Leaflet zoom levels (256 px tiles); MapLibre's 512 px tiles sit one level lower.
export const toGL = (z: number) => z - 1
export const fromGL = (z: number) => z + 1

// Satellite: Esri imagery with its road and place-name overlays. Streets: OpenFreeMap Liberty, whose building-3d
// layer stands the buildings up once the map is tilted.
export const SAT: StyleSpecification = {
  version: 8,
  glyphs: GLYPHS,
  sources: {
    imagery: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
    roads: { type: 'raster', tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
    places: { type: 'raster', tiles: [`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#000' } },
    { id: 'imagery', type: 'raster', source: 'imagery', paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0 } },
    { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-fade-duration': 0 } },
    { id: 'places', type: 'raster', source: 'places', paint: { 'raster-fade-duration': 0 } },
  ],
}
