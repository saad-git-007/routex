import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useEffect, useRef } from 'react'
import { reverse } from '../lib/api'
import { sliceTo, pointAt } from '../lib/geo'
import type { Camera, OnRoute, Place, RoadCondition, RoadEvent, Route } from '../lib/types'
import { GRADE_COLOR, roadGrade } from '../lib/conditions'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'
const CALGARY: L.LatLngTuple = [51.045, -114.07]

type Props = {
  cameras: Camera[]; routeCams: OnRoute<Camera>[]; route: Route | null; events: RoadEvent[]; routeEventIds: Set<string>; routeRoads: RoadCondition[]
  allRoads: RoadCondition[]
  home: Place | null; activeCam: string | null; focusAlong: number | null
  onCam: (id: string) => void; onEvent: (id: string) => void
  onAddStop: (p: Place) => void; onSetHome: (p: Place) => void
  flyTo: { lat: number; lon: number; zoom?: number; n: number } | null
}

const EVENT_GLYPH: Record<RoadEvent['kind'], string> = { incident: '!', closure: '⨯', construction: '▲' }

export function MapView(p: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map>()
  const layers = useRef<Record<string, L.LayerGroup>>({})
  const camMarkers = useRef(new Map<string, L.Marker>())
  const progress = useRef<{ line: L.Polyline; glow: L.Polyline; car: L.Marker } | null>(null)
  const cb = useRef(p)
  cb.current = p

  // ── init ──
  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, preferCanvas: true, attributionControl: true, zoomSnap: 0.25, minZoom: 8 }).setView(CALGARY, 11)
    L.control.zoom({ position: 'bottomright' }).addTo(m)
    const common = { updateWhenZooming: false, keepBuffer: 4 }
    // A coarse copy underneath so tiles that are still loading show blurred imagery, not a blank map.
    L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxNativeZoom: 10, keepBuffer: 8, zIndex: 0, className: 'tiles-under' }).addTo(m)
    L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { ...common, maxZoom: 19, zIndex: 1, className: 'tiles-imagery', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(m)
    L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { ...common, maxZoom: 19, zIndex: 2, className: 'tiles-roads' }).addTo(m)
    L.tileLayer(`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`, { ...common, maxZoom: 19, zIndex: 3 }).addTo(m)
    m.attributionControl.setPrefix(false)
    m.createPane('route').style.zIndex = '410'
    m.createPane('cams').style.zIndex = '420'
    for (const k of ['allRoads', 'all', 'roads', 'route', 'progress', 'events', 'places', 'routeCams']) layers.current[k] = L.layerGroup().addTo(m)

    m.on('click', async (e) => {
      const { lat, lng } = e.latlng
      const div = document.createElement('div')
      div.className = 'pop-add'
      div.innerHTML = `<span class="mono">Here</span><b>…</b><button class="btn-accent btn-sm"></button>`
      const btn = div.querySelector('button')!
      const hasHome = !!cb.current.home
      btn.textContent = hasHome ? '＋ Add stop' : 'Set as home'
      const pop = L.popup({ className: 'pop', closeButton: false, offset: [0, -4] }).setLatLng(e.latlng).setContent(div).openOn(m)
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

  // ── every camera, quiet ──
  useEffect(() => {
    const g = layers.current.all
    g.clearLayers()
    const renderer = L.canvas({ padding: 0.3 })
    for (const c of p.cameras) {
      L.circleMarker([c.lat, c.lon], { renderer, radius: 4, weight: 1.5, color: 'rgba(0,0,0,.7)', fillColor: c.src === 'ab' ? '#ab9dff' : '#e6eef8', fillOpacity: 0.9 })
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
    if (!p.route) return
    const ll = p.route.coords
    // Lines draw on canvas (no CSS filters), so the glow is a wide, faint cyan stroke underneath.
    L.polyline(ll, { pane: 'route', color: '#4cc9f0', opacity: 0.2, weight: 18, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(g)
    L.polyline(ll, { pane: 'route', color: '#000', opacity: 0.6, weight: 9, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(g)
    L.polyline(ll, { pane: 'route', color: '#5fd4f5', opacity: 1, weight: 5, lineJoin: 'round', lineCap: 'round', interactive: false }).addTo(g)
    const stops = p.route.order.slice(1).filter((s) => s.id !== p.home?.id)
    stops.forEach((s, i) => L.marker([s.lat, s.lon], { icon: L.divIcon({ className: 'mk-stop', html: `<span>${i + 1}</span>`, iconSize: [30, 30] }), zIndexOffset: 800 }).bindTooltip(s.label, { className: 'tip', direction: 'top', offset: [0, -14] }).addTo(pl))
    m.flyToBounds(L.latLngBounds(ll), { padding: [40, 40], duration: 0.8 })
  }, [p.route, p.home])

  // ── 511 highway conditions along the route: a coloured halo under the route line ──
  useEffect(() => {
    const g = layers.current.roads
    g.clearLayers()
    for (const r of p.routeRoads) {
      if (!r.line?.length) continue
      L.polyline(r.line, { pane: 'route', color: GRADE_COLOR[roadGrade(r)], weight: 20, opacity: 0.75, lineCap: 'butt', lineJoin: 'round' })
        .bindTooltip(`${r.hwy} · ${r.condition}${r.extra.length ? ' · ' + r.extra.join(', ') : ''}`, { className: 'tip', sticky: true })
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
        .bindTooltip(`${r.hwy} · ${r.segment}<br><b>${[r.condition, ...r.extra].join(' · ')}</b>`, { className: 'tip', sticky: true })
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

  useEffect(() => {
    if (p.flyTo && map.current) map.current.flyTo([p.flyTo.lat, p.flyTo.lon], p.flyTo.zoom ?? Math.max(map.current.getZoom(), 15), { duration: 0.8 })
  }, [p.flyTo])

  return <div ref={el} className="map" aria-label="Map" />
}
