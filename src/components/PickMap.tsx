import L from 'leaflet'
import { useEffect, useRef } from 'react'
import type { Camera } from '../lib/types'

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services'

// A map of every camera for building a list: tap a camera to add it (numbered) or take it off again.
export function PickMap({ cameras, picked, focus, onPick, view }: {
  cameras: Camera[]; picked: string[]; focus: string | null; onPick: (id: string) => void
  view: { center: [number, number]; zoom: number; n: number } | null
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map>()
  const layer = useRef<L.LayerGroup>()
  const cb = useRef(onPick)
  cb.current = onPick

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false, zoomSnap: 0.25, minZoom: 5, attributionControl: true }).setView([51.045, -114.07], 11)
    L.control.zoom({ position: 'topright' }).addTo(m)
    m.attributionControl.setPrefix(false)
    L.tileLayer(`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19, className: 'tiles-imagery', attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(m)
    L.tileLayer(`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`, { maxZoom: 19 }).addTo(m)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    const ro = new ResizeObserver(() => m.invalidateSize())
    ro.observe(el.current!)
    return () => { ro.disconnect(); m.remove() }
  }, [])

  useEffect(() => {
    const g = layer.current!
    g.clearLayers()
    const order = new Map(picked.map((id, i) => [id, i + 1]))
    for (const c of cameras) {
      const n = order.get(c.id)
      const cls = `mk-pick ${n ? 'is-picked' : ''} ${c.src === 'ab' ? 'is-ab' : c.src === 'town' ? 'is-town' : ''} ${c.id === focus ? 'is-focus' : ''}`
      L.marker([c.lat, c.lon], {
        icon: L.divIcon({ className: cls, html: n ? `<span>${n}</span>` : '<i></i>', iconSize: n ? [26, 26] : [22, 22] }),
        zIndexOffset: n ? 500 : 0, keyboard: false,
      })
        .bindTooltip(c.name, { className: 'tip', direction: 'top', offset: [0, -12] })
        .on('click', () => cb.current(c.id))
        .addTo(g)
    }
  }, [cameras, picked, focus])

  useEffect(() => {
    if (view && map.current) map.current.flyTo(view.center, view.zoom, { duration: 0.6 })
  }, [view])

  return <div ref={el} className="pick-map" aria-label="Map of cameras: tap one to add or remove it" />
}
