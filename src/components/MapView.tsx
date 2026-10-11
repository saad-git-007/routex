import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { reverse } from '../lib/api'
import { sliceTo, pointAt } from '../lib/geo'
import type { Camera, Community, OnRoute, Place, RoadCondition, RoadEvent, Route } from '../lib/types'
import { GRADE_COLOR, roadGrade } from '../lib/conditions'
import type { Fix } from '../lib/useLocation'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const CALGARY: L.LatLngTuple = [51.045, -114.07]
export type Basemap = 'sat' | 'streets'

// Each basemap: a coarse copy underneath (so loading tiles show blurred map, not a blank), the base, and overlays.
function basemapLayers(b: Basemap) {
  const common = { updateWhenZooming: false, keepBuffer: 4, maxZoom: 19 }
  if (b === 'streets') {
    const url = `${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`
    return [
      L.tileLayer(url, { maxNativeZoom: 10, keepBuffer: 8, zIndex: 0, className: 'tiles-under' }),
      L.tileLayer(url, { ...common, zIndex: 1, className: 'tiles-streets', attribution: 'Map © Esri, HERE, Garmin, OpenStreetMap contributors' }),
    ]
  }
  const url = `${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`
  return [
    L.tileLayer(url, { maxNativeZoom: 10, keepBuffer: 8, zIndex: 0, className: 'tiles-under' }),
    L.tileLayer(url, { ...common, zIndex: 1, className: 'tiles-imagery', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }),
    L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { ...common, zIndex: 2, className: 'tiles-roads' }),
    L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { ...common, zIndex: 3 }),
  ]
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
  /** Buttons stacked in the same column as the zoom buttons, above them. */
  controls?: ReactNode
}

const EVENT_GLYPH: Record<RoadEvent['kind'], string> = { incident: '!', closure: '⨯', construction: '▲' }

export function MapView(p: Props) {
  // Within 300 km of the chosen city (or no city chosen): the map may follow home and the trip there.
  const nearStart = (q: { lat: number; lon: number } | null | undefined) =>
    !!q && (!p.start || Math.hypot(q.lat - p.start.lat, (q.lon - p.start.lon) * Math.cos((q.lat * Math.PI) / 180)) * 111 < 300)
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map>()
  const [stackEl, setStackEl] = useState<HTMLElement | null>(null)
  const layers = useRef<Record<string, L.LayerGroup>>({})
  const camMarkers = useRef(new Map<string, L.Marker>())
  const progress = useRef<{ line: L.Polyline; glow: L.Polyline; car: L.Marker } | null>(null)
  const me = useRef<{ dot: L.Marker; acc: L.Circle } | null>(null)
  const cb = useRef(p)
  cb.current = p

  // Hide community names that would overlap a bigger community's name. Neighbourhoods come before
  // industrial areas and parks, then shorter names first so more of them fit.
  const declutter = () => {
    const labels = [...(el.current?.querySelectorAll<HTMLElement>('.mk-comm') ?? [])]
    labels.forEach((n) => n.classList.remove('is-hidden'))
    const boxes = labels.map((n) => ({ n, r: n.firstElementChild!.getBoundingClientRect(), home: n.classList.contains('is-home') }))
      .filter((b) => b.r.width > 0)
      .sort((a, b) => Number(b.home) - Number(a.home) || a.r.width - b.r.width)
    const kept: DOMRect[] = []
    for (const b of boxes) {
      const hit = kept.some((k) => b.r.left < k.right + 6 && b.r.right > k.left - 6 && b.r.top < k.bottom + 3 && b.r.bottom > k.top - 3)
      if (hit) b.n.classList.add('is-hidden'); else kept.push(b.r)
    }
  }

  // ── init ──
  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, preferCanvas: true, attributionControl: true, zoomSnap: 0.25, minZoom: 5 }).setView(nearStart(p.home) ? [p.home!.lat, p.home!.lon] : p.start ? [p.start.lat, p.start.lon] : CALGARY, nearStart(p.home) ? 12 : p.start?.zoom ?? 11)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    const Stack = L.Control.extend({ onAdd: () => { const d = L.DomUtil.create('div', 'leaflet-control map-stack'); L.DomEvent.disableClickPropagation(d); return d } })
    const stack = new Stack({ position: 'bottomright' }).addTo(m)
    setStackEl(stack.getContainer()!)
    m.attributionControl.setPrefix(false)
    m.createPane('labels').style.zIndex = '405'
    m.createPane('route').style.zIndex = '410'
    m.createPane('cams').style.zIndex = '420'
    // Community names thin out as you zoom out, so the city view stays readable.
    const zoomClass = () => { const z = m.getZoom(); el.current!.dataset.z = z >= 13 ? 'near' : z >= 11.5 ? 'mid' : z >= 10.5 ? 'far' : 'out' }
    m.on('zoomend', () => { zoomClass(); declutter() }); zoomClass()
    // Tell the app what's on screen (it loads road conditions for the visible map outside Alberta).
    const view = () => { const b = m.getBounds(); cb.current.onView?.({ w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth(), zoom: m.getZoom() }) }
    m.on('moveend', view); setTimeout(view)
    for (const k of ['communities', 'allRoads', 'all', 'roads', 'route', 'progress', 'events', 'places', 'routeCams']) layers.current[k] = L.layerGroup().addTo(m)

    m.on('click', async (e) => {
      const { lat, lng } = e.latlng
      const div = document.createElement('div')
      div.className = 'pop-add'
      div.innerHTML = `<button class="btn-icon btn-xs pop-x" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button><span class="mono">Here</span><b>…</b><button class="btn-accent btn-sm pop-go"></button>`
      const btn = div.querySelector<HTMLButtonElement>('.pop-go')!
      const hasHome = !!cb.current.home
      btn.textContent = hasHome ? '＋ Add stop' : 'Set as home'
      const pop = L.popup({ className: 'pop', closeButton: false, offset: [0, -4] }).setLatLng(e.latlng).setContent(div).openOn(m)
      div.querySelector<HTMLButtonElement>('.pop-x')!.onclick = () => m.closePopup(pop)
      const label = await reverse(lat, lng).catch(() => 'Dropped pin')
      div.querySelector('b')!.textContent = label
      btn.onclick = () => {
        const place = { id: crypto.randomUUID(), label, lat, lon: lng }
        if (hasHome) cb.current.onAddStop(place)
        else cb.current.onSetHome(place)
        m.closePopup(pop)
      }
    })
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); m.remove() }
  }, [])

  // ── basemap: satellite or streets ──
  useEffect(() => {
    const m = map.current!
    const tiles = basemapLayers(p.basemap).map((t) => t.addTo(m))
    el.current!.dataset.basemap = p.basemap
    return () => { tiles.forEach((t) => t.remove()) }
  }, [p.basemap])

  // ── Calgary communities: boundaries and names ──
  useEffect(() => {
    const g = layers.current.communities
    g.clearLayers()
    if (!p.communities.length) return
    const renderer = L.canvas({ padding: 0.3 })
    const color = p.basemap === 'streets' ? '#5b4bd6' : '#ffffff'
    for (const c of p.communities) {
      L.polygon(c.rings, { renderer, color, weight: 1.2, opacity: p.basemap === 'streets' ? 0.55 : 0.6, dashArray: '5 4', fill: false, interactive: false }).addTo(g)
      L.marker(c.label, { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: `mk-comm is-${c.kind}`, html: `<span>${c.name}</span>`, iconSize: [0, 0] }) }).addTo(g)
    }
    declutter()
  }, [p.communities, p.basemap])

  // ── every camera, quiet ──
  useEffect(() => {
    const g = layers.current.all
    g.clearLayers()
    const renderer = L.canvas({ padding: 0.3 })
    for (const c of p.cameras) {
      L.circleMarker([c.lat, c.lon], { renderer, radius: 4, weight: 1.5, color: 'rgba(0,0,0,.7)', fillColor: c.src === 'ab' ? '#ab9dff' : c.src === 'town' ? '#ffb86b' : '#e6eef8', fillOpacity: 0.9 })
        .bindTooltip(c.name, { direction: 'top', className: 'tip', offset: [0, -4] })
        .on('click', (e) => { L.DomEvent.stop(e); cb.current.onCam(c.id) })
        .addTo(g)
    }
  }, [p.cameras])

  // ── route line, home and stops ──
  useEffect(() => {
    const m = map.current!, g = layers.current.route, pl = layers.current.places
    g.clearLayers(); pl.clearLayers()
    if (p.home) L.marker([p.home.lat, p.home.lon], { icon: L.divIcon({ className: 'mk-home', html: '<span>⌂</span>', iconSize: [34, 34] }), zIndexOffset: 900 }).bindTooltip(p.home.label, { className: 'tip', direction: 'top', offset: [0, -16] }).addTo(pl)
    // No trip yet: keep the map on home. A home or trip in another part of Canada than the chosen city stays put.
    if (!p.route) { if (p.home && nearStart(p.home)) m.flyTo([p.home.lat, p.home.lon], Math.max(m.getZoom(), 12), { duration: 0.8 }); return }
    const ll = p.route.coords
    // Lines draw on canvas (no CSS filters), so the glow is a wide, faint cyan stroke underneath.
    L.polyline(ll, { pane: 'route', color: '#4cc9f0', opacity: 0.2, weight: 18, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(g)
    L.polyline(ll, { pane: 'route', color: '#000', opacity: 0.6, weight: 9, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(g)
    L.polyline(ll, { pane: 'route', color: '#5fd4f5', opacity: 1, weight: 5, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(g)
    const stops = p.route.order.slice(1).filter((s) => s.id !== p.home?.id)
    stops.forEach((s, i) => L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'mk-stop', html: `<span>D${i + 1}</span>`, iconSize: [30, 30] }), zIndexOffset: 800 }).bindTooltip(s.label, { className: 'tip', direction: 'top', offset: [0, -14] }).addTo(pl))
    const b = L.latLngBounds(ll)
    if (nearStart({ lat: b.getCenter().lat, lon: b.getCenter().lng })) m.flyToBounds(b, { padding: [40, 40], duration: 0.8 })
  }, [p.route, p.home])

  // ── 511 highway conditions along the route: a coloured halo under the route line ──
  useEffect(() => {
    const g = layers.current.roads
    g.clearLayers()
    for (const r of p.routeRoads) {
      if (!r.line?.length) continue
      L.polyline(r.line, { pane: 'route', color: GRADE_COLOR[roadGrade(r)], weight: 20, opacity: 0.75, lineCap: 'butt', lineJoin: 'round' })
        .bindTooltip([r.hwy, r.condition, ...r.extra].filter(Boolean).join(' · '), { className: 'tip', sticky: true })
        .addTo(g).bringToBack()
    }
  }, [p.routeRoads])

  // ── every 511 highway segment (optional layer) ──
  useEffect(() => {
    const g = layers.current.allRoads
    g.clearLayers()
    const renderer = L.canvas({ padding: 0.3 })
    for (const r of p.allRoads) {
      if (!r.line?.length) continue
      const grade = roadGrade(r)
      L.polyline(r.line, { renderer, color: GRADE_COLOR[grade], weight: grade === 'dry' ? 4 : 5, opacity: 0.9, lineCap: 'round' })
        .bindTooltip(`${[r.hwy, r.segment].filter(Boolean).join(' · ')}${r.hwy || r.segment ? '<br>' : ''}<b>${[r.condition, ...r.extra].join(' · ')}</b>`, { className: 'tip', sticky: true })
        .addTo(g)
    }
  }, [p.allRoads])

  // ── numbered cameras on the route ──
  useEffect(() => {
    const g = layers.current.routeCams
    g.clearLayers(); camMarkers.current.clear()
    p.routeCams.forEach((c, i) => {
      const mk = L.marker([c.lat, c.lon], { pane: 'cams', icon: L.divIcon({ className: 'mk-cam', html: `<span>${i + 1}</span>`, iconSize: [26, 26] }), riseOnHover: true })
        .bindTooltip(c.name, { className: 'tip', direction: 'top', offset: [0, -14] })
        .on('click', () => cb.current.onCam(c.id))
        .addTo(g)
      camMarkers.current.set(c.id, mk)
    })
  }, [p.routeCams])

  // ── incidents, closures, construction ──
  useEffect(() => {
    const g = layers.current.events
    g.clearLayers()
    for (const e of p.events) {
      const on = p.routeEventIds.has(e.id)
      // Off-route construction is everywhere in summer; keep the map readable.
      if (!on && e.kind === 'construction') continue
      L.marker([e.lat, e.lon], {
        icon: L.divIcon({ className: `mk-ev mk-${e.kind} ${on ? 'on' : 'off'}`, html: `<span>${EVENT_GLYPH[e.kind]}</span>`, iconSize: on ? [26, 26] : [18, 18] }),
        zIndexOffset: on ? 700 : 0,
      })
        .bindTooltip(e.title, { className: 'tip', direction: 'top', offset: [0, -12] })
        .on('click', () => cb.current.onEvent(e.id))
        .addTo(g)
    }
  }, [p.events, p.routeEventIds])

  // ── the active camera: ring + ping, and keep it in view ──
  useEffect(() => {
    camMarkers.current.forEach((mk, id) => {
      const node = mk.getElement()
      if (!node) return
      const on = id === p.activeCam
      node.classList.toggle('active', on)
      if (on) {
        mk.setZIndexOffset(1000)
        node.classList.remove('ping'); void node.offsetWidth; node.classList.add('ping')
      } else mk.setZIndexOffset(0)
    })
    const mk = p.activeCam ? camMarkers.current.get(p.activeCam) : undefined
    const m = map.current
    if (mk && m) {
      const b = m.getBounds().pad(-0.22)
      if (!b.contains(mk.getLatLng())) m.panTo(mk.getLatLng(), { animate: true, duration: 0.6, easeLinearity: 0.2 })
    }
  }, [p.activeCam, p.routeCams])

  // ── "driven so far" line to the camera you're looking at ──
  useEffect(() => {
    const g = layers.current.progress
    if (!p.route || p.focusAlong == null) { g.clearLayers(); progress.current = null; return }
    const pts = sliceTo(p.route, p.focusAlong), at = pointAt(p.route, p.focusAlong)
    if (!progress.current) {
      const glow = L.polyline(pts, { pane: 'route', color: '#e3f8ff', weight: 14, opacity: 0.22, lineCap: 'round', interactive: false }).addTo(g)
      const line = L.polyline(pts, { pane: 'route', color: '#e3f8ff', weight: 4, opacity: 1, lineCap: 'round', interactive: false }).addTo(g)
      const car = L.marker(at, { pane: 'route', icon: L.divIcon({ className: 'mk-car', html: '<i></i>', iconSize: [16, 16] }), interactive: false }).addTo(g)
      progress.current = { line, glow, car }
    } else {
      progress.current.line.setLatLngs(pts)
      progress.current.glow.setLatLngs(pts)
      progress.current.car.setLatLng(at)
    }
  }, [p.route, p.focusAlong])

  // ── live location: dot, accuracy circle, and a heading cone while moving ──
  useEffect(() => {
    const m = map.current!
    if (!p.me) { me.current?.dot.remove(); me.current?.acc.remove(); me.current = null; return }
    const at: L.LatLngTuple = [p.me.lat, p.me.lon]
    const moving = p.me.heading != null && !Number.isNaN(p.me.heading) && (p.me.speed ?? 0) > 1
    if (!me.current) {
      const acc = L.circle(at, { radius: p.me.acc, pane: 'route', color: '#3b9bff', weight: 1, opacity: 0.5, fillColor: '#3b9bff', fillOpacity: 0.12, interactive: false }).addTo(m)
      const dot = L.marker(at, { pane: 'cams', interactive: false, keyboard: false, zIndexOffset: 1200, icon: L.divIcon({ className: 'mk-me', html: '<b></b><i></i><span></span>', iconSize: [22, 22] }) }).addTo(m)
      me.current = { dot, acc }
    }
    me.current.acc.setLatLng(at).setRadius(p.me.acc)
    me.current.dot.setLatLng(at)
    const node = me.current.dot.getElement()
    if (node) {
      node.classList.toggle('is-moving', moving)
      node.style.setProperty('--heading', `${moving ? p.me.heading : 0}deg`)
    }
  }, [p.me])

  useEffect(() => {
    if (p.flyTo && map.current) map.current.flyTo([p.flyTo.lat, p.flyTo.lon], p.flyTo.zoom ?? Math.max(map.current.getZoom(), 15), { duration: 0.8 })
  }, [p.flyTo])

  return <><div ref={el} className="map" aria-label="Map" />{stackEl && p.controls && createPortal(p.controls, stackEl)}</>
}
