import maplibregl, { type GeoJSONSource } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useEffect, useRef } from 'react'
import type { Camera } from '../lib/types'
import { SAT, toGL } from '../lib/mapStyle'

const color = (c: Camera) => (c.src === 'ab' ? '#ab9dff' : c.src === 'town' ? '#ffb86b' : '#e6eef8')

// A map of every camera for building a list: tap a camera to add it (numbered) or take it off again.
// Unpicked cameras are one circle layer (over a thousand in Ontario or BC); only picked ones are numbered DOM markers.
export function PickMap({ cameras, picked, focus, onPick, view, pin }: {
  cameras: Camera[]; picked: string[]; focus: string | null; onPick: (id: string) => void
  view: { center: [number, number]; zoom: number; n: number } | null
  pin?: { lat: number; lon: number; label: string } | null
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map>()
  const tip = useRef<maplibregl.Popup>()
  const numbered = useRef<maplibregl.Marker[]>([])
  const cb = useRef(onPick)
  cb.current = onPick
  // Latest data, applied whenever the style is ready.
  const state = useRef({ cameras, picked, focus })
  state.current = { cameras, picked, focus }

  const sync = () => {
    const m = map.current
    const src = m?.getSource('pick') as GeoJSONSource | undefined
    if (!m || !src) return
    const { cameras, picked, focus } = state.current
    const on = new Set(picked)
    src.setData({ type: 'FeatureCollection', features: cameras.filter((c) => !on.has(c.id)).map((c) => ({ type: 'Feature', properties: { id: c.id, name: c.name, color: color(c), focus: c.id === focus ? 1 : 0 }, geometry: { type: 'Point', coordinates: [c.lon, c.lat] } })) })
  }

  useEffect(() => {
    const m = new maplibregl.Map({ container: el.current!, style: SAT, attributionControl: false, center: [-114.07, 51.045], zoom: toGL(11), minZoom: toGL(5), pitch: 55, maxPitch: 85, fadeDuration: 0 })
    m.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-left')
    tip.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip-pop', offset: [0, -10], maxWidth: '260px' })
    m.on('style.load', () => {
      m.addSource('pick', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      m.addLayer({ id: 'pick', type: 'circle', source: 'pick', paint: {
        'circle-radius': ['case', ['==', ['get', 'focus'], 1], 9, 6], 'circle-color': ['get', 'color'],
        'circle-stroke-width': ['case', ['==', ['get', 'focus'], 1], 3, 1.5], 'circle-stroke-color': ['case', ['==', ['get', 'focus'], 1], '#fff', 'rgba(0,0,0,.7)'],
      } })
      sync()
    })
    // A generous tap target around each dot, so cameras are easy to hit with a finger.
    const hit = (pt: maplibregl.Point) => m.getLayer('pick') ? m.queryRenderedFeatures([[pt.x - 8, pt.y - 8], [pt.x + 8, pt.y + 8]], { layers: ['pick'] })[0] : undefined
    m.on('click', (e) => { const f = hit(e.point); if (f) cb.current(f.properties.id) })
    m.on('mousemove', (e) => {
      const f = hit(e.point)
      m.getCanvas().style.cursor = f ? 'pointer' : ''
      if (f) tip.current!.setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number]).setText(f.properties.name).addTo(m)
      else tip.current!.remove()
    })
    m.on('mouseout', () => tip.current!.remove())
    map.current = m
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); m.remove() }
  }, [])

  useEffect(() => {
    sync()
    // Picked cameras: numbered in list order, focused one highlighted.
    numbered.current.forEach((mk) => mk.remove())
    const byId = new Map(cameras.map((c) => [c.id, c]))
    numbered.current = picked.flatMap((id, i) => {
      const c = byId.get(id)
      if (!c) return []
      const node = document.createElement('div')
      node.className = `mk-pick is-picked ${id === focus ? 'is-focus' : ''}`
      node.innerHTML = `<span>${i + 1}</span>`
      node.style.zIndex = id === focus ? '2' : '1'
      node.title = c.name
      node.addEventListener('click', (e) => { e.stopPropagation(); cb.current(id) })
      return [new maplibregl.Marker({ element: node }).setLngLat([c.lon, c.lat]).addTo(map.current!)]
    })
  }, [cameras, picked, focus]) // eslint-disable-line react-hooks/exhaustive-deps

  // The searched address, so the cameras around it are easy to see.
  useEffect(() => {
    if (!pin || !map.current) return
    const node = document.createElement('div')
    node.className = 'mk-home'
    node.innerHTML = '<span>⌖</span>'
    Object.assign(node.style, { width: '30px', height: '30px', pointerEvents: 'none' })
    const mk = new maplibregl.Marker({ element: node }).setLngLat([pin.lon, pin.lat]).addTo(map.current)
    const label = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'tip-pop', offset: [0, -16] }).setLngLat([pin.lon, pin.lat]).setText(pin.label).addTo(map.current)
    return () => { mk.remove(); label.remove() }
  }, [pin])

  useEffect(() => {
    if (view && map.current) map.current.flyTo({ center: [view.center[1], view.center[0]], zoom: toGL(view.zoom), duration: 600 })
  }, [view])

  return <div ref={el} className="pick-map" aria-label="Map of cameras: tap one to add or remove it" />
}
