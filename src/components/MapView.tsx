import maplibregl, { type GeoJSONSource, type LngLatLike, type StyleSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { reverse } from '../lib/api'
import { sliceTo, pointAt } from '../lib/geo'
import type { Camera, Community, OnRoute, Place, RoadCondition, RoadEvent, Route } from '../lib/types'
import { GRADE_COLOR, roadGrade } from '../lib/conditions'
import type { Fix } from '../lib/useLocation'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const LIBERTY = 'https://tiles.openfreemap.org/styles/liberty'
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf'
const CALGARY = { lat: 51.045, lon: -114.07 }
export type Basemap = 'sat' | 'streets'

// The app speaks Leaflet zoom levels (256 px tiles); MapLibre's 512 px tiles sit one level lower.
const toGL = (z: number) => z - 1
const fromGL = (z: number) => z + 1

// Satellite: Esri imagery with its road and place-name overlays. Streets: OpenFreeMap Liberty, whose building-3d
// layer stands the buildings up once the map is tilted.
const SAT: StyleSpecification = {
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

type Props = {
  cameras: Camera[]; routeCams: OnRoute<Camera>[]; route: Route | null; events: RoadEvent[]; routeEventIds: Set<string>; routeRoads: RoadCondition[]
  allRoads: RoadCondition[]
  basemap: Basemap; communities: Community[]; me: Fix | null
  onView?: (v: { w: number; s: number; e: number; n: number; zoom: number }) => void
  home: Place | null; start: { lat: number; lon: number; zoom: number } | null; activeCam: string | null; focusAlong: number | null
  onCam: (id: string) => void; onEvent: (id: string) => void
  onAddStop: (p: Place) => void; onSetHome: (p: Place) => void
  flyTo: { lat: number; lon: number; zoom?: number; n: number } | null
  /** Live trip: how far along the route the live location is (the part behind it is drawn as driven), and whether the map follows it. */
  driven?: number | null; follow?: boolean; onUnfollow?: () => void
  /** Buttons stacked in the same column as the zoom buttons, above them. */
  controls?: ReactNode
}

const EVENT_GLYPH: Record<RoadEvent['kind'], string> = { incident: '!', closure: '⨯', construction: '▲' }

type FC = GeoJSON.FeatureCollection
const EMPTY: FC = { type: 'FeatureCollection', features: [] }
const ll = (p: [number, number]): [number, number] => [p[1], p[0]] // [lat, lon] → [lon, lat]
const lineFC = (pts: [number, number][], props = {}): FC => ({ type: 'FeatureCollection', features: pts.length > 1 ? [{ type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: pts.map(ll) } }] : [] })
// A circle of r metres as a polygon (the accuracy ring).
const circle = (lat: number, lon: number, r: number): FC => {
  const dLat = r / 111320, dLon = r / (111320 * Math.cos((lat * Math.PI) / 180))
  const ring = Array.from({ length: 49 }, (_, i) => { const a = (i / 48) * 2 * Math.PI; return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)] })
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } }] }
}

// Every overlay is a GeoJSON source the app owns. Switching basemap replaces the style, so they are re-added on each
// style load from the last data given.
const SOURCES = ['rx-comm', 'rx-comm-labels', 'rx-allroads', 'rx-roads', 'rx-cams', 'rx-route', 'rx-progress', 'rx-driven', 'rx-acc'] as const
type SourceId = typeof SOURCES[number]

function addOverlays(m: maplibregl.Map, data: Record<SourceId, FC>, basemap: Basemap) {
  for (const id of SOURCES) if (!m.getSource(id)) m.addSource(id, { type: 'geojson', data: data[id] })
  const streets = basemap === 'streets'
  const round = { 'line-join': 'round', 'line-cap': 'round' } as const
  const layers: maplibregl.AddLayerObject[] = [
    { id: 'rx-comm', type: 'line', source: 'rx-comm', paint: { 'line-color': streets ? '#5b4bd6' : '#ffffff', 'line-opacity': streets ? 0.55 : 0.6, 'line-width': 1.2, 'line-dasharray': [4, 3] } },
    { id: 'rx-allroads', type: 'line', source: 'rx-allroads', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'w'], 'line-opacity': 0.9 } },
    { id: 'rx-roads', type: 'line', source: 'rx-roads', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 20, 'line-opacity': 0.75 } },
    { id: 'rx-cams', type: 'circle', source: 'rx-cams', paint: { 'circle-radius': 4, 'circle-color': ['get', 'color'], 'circle-opacity': 0.9, 'circle-stroke-width': 1.5, 'circle-stroke-color': 'rgba(0,0,0,.7)' } },
    // Community names: neighbourhoods from city zoom, industrial areas and parks closer in. Names that would overlap
    // a more important one are dropped by MapLibre's label placement.
    { id: 'rx-comm-labels', type: 'symbol', source: 'rx-comm-labels', filter: ['any', ['==', ['get', 'kind'], 'home'], ['>=', ['zoom'], toGL(11.5)]], minzoom: toGL(10.5),
      layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Bold'], 'text-transform': 'uppercase', 'text-letter-spacing': 0.07, 'symbol-sort-key': ['get', 'rank'], 'text-padding': 4,
        'text-size': ['step', ['zoom'], 8.5, toGL(11.5), 10, toGL(13), 12] },
      paint: streets
        ? { 'text-color': ['case', ['==', ['get', 'kind'], 'home'], '#3f31b8', '#6a6290'], 'text-halo-color': '#fff', 'text-halo-width': 1.5 }
        : { 'text-color': ['case', ['==', ['get', 'kind'], 'home'], '#fff', 'rgba(255,255,255,.78)'], 'text-halo-color': 'rgba(0,0,0,.85)', 'text-halo-width': 1.5, 'text-halo-blur': 1 } },
    { id: 'rx-route-glow', type: 'line', source: 'rx-route', layout: round, paint: { 'line-color': '#4cc9f0', 'line-opacity': 0.2, 'line-width': 18 } },
    { id: 'rx-route-case', type: 'line', source: 'rx-route', layout: round, paint: { 'line-color': '#000', 'line-opacity': 0.6, 'line-width': 9 } },
    { id: 'rx-route', type: 'line', source: 'rx-route', layout: round, paint: { 'line-color': '#5fd4f5', 'line-width': 5 } },
    { id: 'rx-progress-glow', type: 'line', source: 'rx-progress', layout: round, paint: { 'line-color': '#e3f8ff', 'line-opacity': 0.22, 'line-width': 14 } },
    { id: 'rx-progress', type: 'line', source: 'rx-progress', layout: round, paint: { 'line-color': '#e3f8ff', 'line-width': 4 } },
    { id: 'rx-driven', type: 'line', source: 'rx-driven', layout: round, paint: { 'line-color': '#5b6577', 'line-opacity': 0.95, 'line-width': 7 } },
    { id: 'rx-acc', type: 'fill', source: 'rx-acc', paint: { 'fill-color': '#3b9bff', 'fill-opacity': 0.12, 'fill-outline-color': 'rgba(59,155,255,.5)' } },
  ]
  for (const l of layers) if (!m.getLayer(l.id)) m.addLayer(l)
}

// A DOM marker like Leaflet's divIcon: a sized element with a class and inner HTML.
function marker(cls: string, html: string, size: number, z = 0) {
  const el = document.createElement('div')
  el.className = cls
  el.innerHTML = html
  Object.assign(el.style, { width: `${size}px`, height: `${size}px`, zIndex: String(z) })
  return el
}

export function MapView(p: Props) {
  // Within 300 km of the chosen city (or no city chosen): the map may follow home and the trip there.
  const nearStart = (q: { lat: number; lon: number } | null | undefined) =>
    !!q && (!p.start || Math.hypot(q.lat - p.start.lat, (q.lon - p.start.lon) * Math.cos((q.lat * Math.PI) / 180)) * 111 < 300)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map>()
  const [stackEl, setStackEl] = useState<HTMLElement | null>(null)
  const data = useRef(Object.fromEntries(SOURCES.map((s) => [s, EMPTY])) as Record<SourceId, FC>)
  const markers = useRef<Record<string, maplibregl.Marker[]>>({})
  const camMarkers = useRef(new Map<string, maplibregl.Marker>())
  const car = useRef<maplibregl.Marker | null>(null)
  const me = useRef<maplibregl.Marker | null>(null)
  const tip = useRef<maplibregl.Popup>()
  const basemap = useRef(p.basemap)
  const cb = useRef(p)
  cb.current = p

  const setData = (id: SourceId, fc: FC) => {
    data.current[id] = fc
    ;(map.current?.getSource(id) as GeoJSONSource | undefined)?.setData(fc)
  }
  const clearMarkers = (k: string) => { markers.current[k]?.forEach((mk) => mk.remove()); markers.current[k] = [] }
  // Hover label for a marker, sharing the one tooltip popup.
  const withTip = (mk: maplibregl.Marker, text: string, dy: number) => {
    const node = mk.getElement()
    node.addEventListener('mouseenter', () => tip.current?.setOffset([0, -dy]).setLngLat(mk.getLngLat()).setText(text).addTo(map.current!))
    node.addEventListener('mouseleave', () => tip.current?.remove())
    return mk
  }
  const place = (k: string, at: [number, number], node: HTMLElement, label?: string, dy = 14) => {
    const mk = new maplibregl.Marker({ element: node }).setLngLat(ll(at)).addTo(map.current!)
    if (label) withTip(mk, label, dy)
    ;(markers.current[k] ??= []).push(mk)
    return mk
  }

  // ── init ──
  useEffect(() => {
    const at = nearStart(p.home) ? p.home! : p.start ?? CALGARY
    const m = new maplibregl.Map({
      container: el.current!, style: p.basemap === 'streets' ? LIBERTY : SAT, attributionControl: false,
      center: [at.lon, at.lat], zoom: toGL(nearStart(p.home) ? 12 : p.start?.zoom ?? 11), minZoom: toGL(5),
      pitch: 55, maxPitch: 85, fadeDuration: 0,
    })
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'bottom-right')
    // The app's own buttons sit in the same corner, above the zoom and compass buttons.
    const stack = document.createElement('div')
    stack.className = 'maplibregl-ctrl map-stack'
    m.addControl({ onAdd: () => stack, onRemove: () => stack.remove() }, 'bottom-right')
    setStackEl(stack)
    tip.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip-pop', maxWidth: '280px' })
    m.on('style.load', () => addOverlays(m, data.current, basemap.current))
    m.on('error', (e) => console.warn('map:', e.error?.message))

    // Tell the app what's on screen (it loads road conditions for the visible map outside Alberta).
    const view = () => { const b = m.getBounds(); cb.current.onView?.({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth(), zoom: fromGL(m.getZoom()) }) }
    m.on('moveend', view); setTimeout(view)
    // Dragging the map stops it following the live location.
    m.on('dragstart', () => cb.current.follow && cb.current.onUnfollow?.())

    // Quiet cameras and highway segments: hover for a label, tap a camera to open it.
    const hoverable = ['rx-cams', 'rx-roads', 'rx-allroads']
    m.on('mousemove', (e) => {
      const f = m.getLayer('rx-cams') ? m.queryRenderedFeatures(e.point, { layers: hoverable.filter((l) => m.getLayer(l)) })[0] : undefined
      m.getCanvas().style.cursor = f?.layer.id === 'rx-cams' ? 'pointer' : ''
      if (!f) { tip.current!.remove(); return }
      const cam = f.layer.id === 'rx-cams'
      tip.current!.setOffset(cam ? [0, -6] : [0, -10]).setLngLat(cam ? (f.geometry as GeoJSON.Point).coordinates as [number, number] : e.lngLat).setHTML(f.properties.tip).addTo(m)
    })
    m.on('mouseout', () => tip.current!.remove())

    m.on('click', async (e) => {
      if ((e.originalEvent.target as Element).closest('.maplibregl-marker')) return
      const cam = m.getLayer('rx-cams') && m.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]], { layers: ['rx-cams'] })[0]
      if (cam) { cb.current.onCam(cam.properties.id); return }
      const { lat, lng } = e.lngLat
      const div = document.createElement('div')
      div.className = 'pop-add'
      div.innerHTML = `<button class="btn-icon btn-xs pop-x" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button><span class="mono">Here</span><b>…</b><button class="btn-accent btn-sm pop-go"></button>`
      const btn = div.querySelector<HTMLButtonElement>('.pop-go')!
      const hasHome = !!cb.current.home
      btn.textContent = hasHome ? '＋ Add stop' : 'Set as home'
      const pop = new maplibregl.Popup({ className: 'pop', closeButton: false, offset: 8, maxWidth: '300px' }).setLngLat(e.lngLat).setDOMContent(div).addTo(m)
      div.querySelector<HTMLButtonElement>('.pop-x')!.onclick = () => pop.remove()
      const label = await reverse(lat, lng).catch(() => 'Dropped pin')
      div.querySelector('b')!.textContent = label
      btn.onclick = () => {
        const place = { id: crypto.randomUUID(), label, lat, lon: lng }
        if (hasHome) cb.current.onAddStop(place)
        else cb.current.onSetHome(place)
        pop.remove()
      }
    })
    map.current = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); m.remove() }
  }, [])

  // ── basemap: satellite or streets ──
  useEffect(() => {
    el.current!.dataset.basemap = p.basemap
    if (basemap.current === p.basemap) return
    basemap.current = p.basemap
    map.current!.setStyle(p.basemap === 'streets' ? LIBERTY : SAT, { diff: false })
  }, [p.basemap])

  // ── Calgary communities: boundaries and names ──
  useEffect(() => {
    setData('rx-comm', { type: 'FeatureCollection', features: p.communities.map((c) => ({ type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: c.rings.map((r) => r.map(ll)) } })) })
    // Neighbourhoods are placed before industrial areas and parks, then shorter names first so more of them fit.
    setData('rx-comm-labels', { type: 'FeatureCollection', features: p.communities.map((c) => ({ type: 'Feature', properties: { name: c.name, kind: c.kind, rank: (c.kind === 'home' ? 0 : 1000) + c.name.length }, geometry: { type: 'Point', coordinates: ll(c.label) } })) })
  }, [p.communities])

  // ── every camera, quiet ──
  useEffect(() => {
    const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => `&#${ch.charCodeAt(0)};`)
    setData('rx-cams', { type: 'FeatureCollection', features: p.cameras.map((c) => ({ type: 'Feature', properties: { id: c.id, tip: esc(c.name), color: c.src === 'ab' ? '#ab9dff' : c.src === 'town' ? '#ffb86b' : '#e6eef8' }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })) })
  }, [p.cameras])

  // ── route line, home and stops ──
  useEffect(() => {
    const m = map.current!
    clearMarkers('places')
    if (p.home) place('places', [p.home.lat, p.home.lon], marker('mk-home', '<span>⌂</span>', 34, 9), p.home.label, 16)
    // No trip yet: keep the map on home. A home or trip in another part of Canada than the chosen city stays put.
    if (!p.route) {
      setData('rx-route', EMPTY)
      if (p.home && nearStart(p.home)) m.flyTo({ center: [p.home.lon, p.home.lat], zoom: Math.max(m.getZoom(), toGL(12)), duration: 800 })
      return
    }
    setData('rx-route', lineFC(p.route.coords))
    const stops = p.route.order.slice(1).filter((s) => s.id !== p.home?.id)
    stops.forEach((s, i) => place('places', [s.lat, s.lon], marker('mk-stop', `<span>D${i + 1}</span>`, 30, 8), s.label))
    const b = new maplibregl.LngLatBounds()
    for (const c of p.route.coords) b.extend([c[1], c[0]])
    const c = b.getCenter()
    if (nearStart({ lat: c.lat, lon: c.lng })) m.fitBounds(b, { padding: 40, duration: 800 })
  }, [p.route, p.home]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 511 highway conditions along the route: a coloured halo under the route line ──
  useEffect(() => {
    setData('rx-roads', { type: 'FeatureCollection', features: p.routeRoads.filter((r) => r.line?.length).map((r) => ({ type: 'Feature', properties: { color: GRADE_COLOR[roadGrade(r)], tip: [r.hwy, r.condition, ...r.extra].filter(Boolean).join(' · ') }, geometry: { type: 'LineString', coordinates: r.line!.map(ll) } })) })
  }, [p.routeRoads])

  // ── every 511 highway segment (optional layer) ──
  useEffect(() => {
    setData('rx-allroads', { type: 'FeatureCollection', features: p.allRoads.filter((r) => r.line?.length).map((r) => {
      const grade = roadGrade(r)
      return { type: 'Feature', properties: { color: GRADE_COLOR[grade], w: grade === 'dry' ? 4 : 5, tip: `${[r.hwy, r.segment].filter(Boolean).join(' · ')}${r.hwy || r.segment ? '<br>' : ''}<b>${[r.condition, ...r.extra].join(' · ')}</b>` }, geometry: { type: 'LineString', coordinates: r.line!.map(ll) } }
    }) })
  }, [p.allRoads])

  // ── numbered cameras on the route ──
  useEffect(() => {
    clearMarkers('routeCams'); camMarkers.current.clear()
    p.routeCams.forEach((c, i) => {
      const node = marker('mk-cam', `<span>${i + 1}</span>`, 26, 10)
      node.addEventListener('click', (e) => { e.stopPropagation(); cb.current.onCam(c.id) })
      camMarkers.current.set(c.id, place('routeCams', [c.lat, c.lon], node, c.name))
    })
  }, [p.routeCams]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── incidents, closures, construction ──
  useEffect(() => {
    clearMarkers('events')
    for (const e of p.events) {
      const on = p.routeEventIds.has(e.id)
      // Off-route construction is everywhere in summer; keep the map readable.
      if (!on && e.kind === 'construction') continue
      const node = marker(`mk-ev mk-${e.kind} ${on ? 'on' : 'off'}`, `<span>${EVENT_GLYPH[e.kind]}</span>`, on ? 26 : 18, on ? 7 : 2)
      node.addEventListener('click', (ev) => { ev.stopPropagation(); cb.current.onEvent(e.id) })
      place('events', [e.lat, e.lon], node, e.title, 12)
    }
  }, [p.events, p.routeEventIds]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── the active camera: ring + ping, and keep it in view ──
  useEffect(() => {
    camMarkers.current.forEach((mk, id) => {
      const node = mk.getElement(), on = id === p.activeCam
      node.classList.toggle('active', on)
      node.style.zIndex = on ? '11' : '10'
      if (on) { node.classList.remove('ping'); void node.offsetWidth; node.classList.add('ping') }
    })
    const mk = p.activeCam ? camMarkers.current.get(p.activeCam) : undefined
    const m = map.current
    if (mk && m && !inView(m, mk.getLngLat(), 0.22)) m.easeTo({ center: mk.getLngLat(), duration: 600 })
  }, [p.activeCam, p.routeCams])

  // ── "driven so far" line to the camera you're looking at ──
  useEffect(() => {
    if (!p.route || p.focusAlong == null) { setData('rx-progress', EMPTY); car.current?.remove(); car.current = null; return }
    setData('rx-progress', lineFC(sliceTo(p.route, p.focusAlong)))
    const at = ll(pointAt(p.route, p.focusAlong))
    if (!car.current) car.current = new maplibregl.Marker({ element: marker('mk-car', '<i></i>', 16, 6) }).setLngLat(at).addTo(map.current!)
    else car.current.setLngLat(at)
  }, [p.route, p.focusAlong])

  // ── live trip: the part of the route already driven, greyed out ──
  useEffect(() => {
    setData('rx-driven', !p.route || p.driven == null || p.driven < 20 ? EMPTY : lineFC(sliceTo(p.route, p.driven)))
  }, [p.route, p.driven])

  // ── live location: dot, accuracy circle, and a heading cone while moving ──
  useEffect(() => {
    const m = map.current!
    if (!p.me) { me.current?.remove(); me.current = null; setData('rx-acc', EMPTY); return }
    const at: LngLatLike = [p.me.lon, p.me.lat]
    const moving = p.me.heading != null && !Number.isNaN(p.me.heading) && (p.me.speed ?? 0) > 1
    // The dot turns with the map so the heading cone keeps pointing the way you drive, but stays upright when tilted.
    if (!me.current) me.current = new maplibregl.Marker({ element: marker('mk-me', '<b></b><i></i><span></span>', 22, 12), rotationAlignment: 'map', pitchAlignment: 'viewport' }).setLngLat(at).addTo(m)
    me.current.setLngLat(at)
    setData('rx-acc', circle(p.me.lat, p.me.lon, p.me.acc))
    // Following: re-centre only when the dot nears the edge of the view.
    if (p.follow && !inView(m, at, 0.25)) {
      // A short hop glides; a long one (the phone was asleep, or a fix jumped) moves straight there.
      const pt = m.project(at), c = m.getContainer()
      const far = Math.hypot(pt.x - c.clientWidth / 2, pt.y - c.clientHeight / 2) > Math.min(c.clientWidth, c.clientHeight) * 0.75
      if (far) m.jumpTo({ center: at }); else m.easeTo({ center: at, duration: 300 })
    }
    const node = me.current.getElement()
    node.classList.toggle('is-moving', moving)
    node.style.setProperty('--heading', `${moving ? p.me.heading : 0}deg`)
  }, [p.me]) // eslint-disable-line react-hooks/exhaustive-deps

  // Starting to follow: bring the map to the live location, close enough to see the street.
  useEffect(() => {
    const m = map.current
    if (p.follow && p.me && m) m.easeTo({ center: [p.me.lon, p.me.lat], zoom: Math.max(m.getZoom(), toGL(15)) })
  }, [p.follow]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current
    if (p.flyTo && m) m.flyTo({ center: [p.flyTo.lon, p.flyTo.lat], zoom: p.flyTo.zoom != null ? toGL(p.flyTo.zoom) : Math.max(m.getZoom(), toGL(15)), duration: 800 })
  }, [p.flyTo])

  return <><div ref={el} className="map" aria-label="Map" />{stackEl && p.controls && createPortal(p.controls, stackEl)}</>
}

// Whether a point is on screen, at least `inset` (a share of the width and height) away from the edges.
function inView(m: maplibregl.Map, at: LngLatLike, inset: number) {
  const pt = m.project(at), c = m.getContainer(), w = c.clientWidth, h = c.clientHeight
  return pt.x > w * inset && pt.x < w * (1 - inset) && pt.y > h * inset && pt.y < h * (1 - inset)
}
