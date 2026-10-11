import { useState } from 'react'
import { LAYERS, NO_ROADS, layerLabel, type LayerKey } from '../lib/layers'
import { ripple } from '../lib/ripple'
import { useBump } from '../lib/useSeen'
import { RoadLegend } from './AlertsPanel'
import { Icon } from './Icon'
import type { Basemap } from './MapView'
import { Segmented } from './Segmented'
import type { Province } from '../lib/cities'

// The map legend doubles as the filter: each swatch is a switch for that layer.
export function MapLayers({ vis, setVis, counts, hasTrip, grades, prov, basemap, setBasemap, names, setNames, namesCount, nearCalgary }: {
  vis: Record<LayerKey, boolean>; setVis: (k: LayerKey, on: boolean) => void; counts: Partial<Record<LayerKey, number>>; hasTrip: boolean; grades: string[]; prov: Province
  basemap: Basemap; setBasemap: (b: Basemap) => void; names: boolean; setNames: (on: boolean) => void; namesCount?: number; nearCalgary: boolean
}) {
  const [open, setOpen] = useState(() => !matchMedia('(max-width: 900px)').matches)
  // Only what this city has: camera sources with no cameras here and road conditions where there's no feed drop out.
  const shown = LAYERS.filter((l) => (hasTrip || !l.tripOnly) && (prov === 'ab' || !l.albertaOnly)
    && !(l.group === 'Cameras' && l.key !== 'others' && !counts[l.key])
    && !((l.key === 'roads' || l.key === 'allRoads') && NO_ROADS.has(prov)))
  const off = shown.filter((l) => !vis[l.key])
  const bump = useBump(off.length)
  return (
    <div className={`layers ${open ? 'is-open' : ''}`}>
      <button className="layers-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="layers" size={16} /> <span>Layers</span>
        {off.length > 0 && <span key={bump} className="count warn bump">{off.length} off</span>}
        <Icon name={open ? 'up' : 'down'} size={14} />
      </button>
      {open && (
        <div className="layers-body">
          <div className="layers-group" role="group" aria-label="Map">
            <span className="eyebrow-sm">Map</span>
            <Segmented label="Basemap" className="seg-xs basemap-seg" value={basemap} onChange={setBasemap}
              options={[{ value: 'sat', label: 'Satellite' }, { value: 'streets', label: 'Streets' }]} />
            {nearCalgary && (
              <button className="lchip has-rpl" aria-pressed={names} onPointerDown={ripple} onClick={() => setNames(!names)}>
                <i className="sw sw-names" aria-hidden />
                <span>Calgary community names</span>
                {names && namesCount != null && <span className="lchip-n tnum">{namesCount}</span>}
              </button>
            )}
          </div>
          {(['Cameras', 'On the road'] as const).map((g) => (
            <div key={g} className="layers-group" role="group" aria-label={g}>
              <span className="eyebrow-sm">{g}</span>
              {shown.filter((l) => l.group === g).map((l) => (
                <button key={l.key} className="lchip has-rpl" aria-pressed={vis[l.key]} onPointerDown={ripple} onClick={() => setVis(l.key, !vis[l.key])}>
                  <i className={`sw sw-${l.key}`} aria-hidden />
                  <span>{layerLabel(l.key, prov)}</span>
                  {counts[l.key] != null && <span className="lchip-n tnum">{counts[l.key]}</span>}
                </button>
              ))}
              {g === 'On the road' && ((hasTrip && vis.roads) || vis.allRoads) && <RoadLegend present={grades} />}
            </div>
          ))}
          {off.length > 0 && <button className="btn-ghost btn-sm layers-reset" onClick={() => off.forEach((l) => setVis(l.key, true))}>Show all</button>}
        </div>
      )}
    </div>
  )
}
