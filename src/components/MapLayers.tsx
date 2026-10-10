import { useState } from 'react'
import { LAYERS, type LayerKey } from '../lib/layers'
import { ripple } from '../lib/ripple'
import { useBump } from '../lib/useSeen'
import { RoadLegend } from './AlertsPanel'
import { Icon } from './Icon'

// The map legend doubles as the filter: each swatch is a switch for that layer.
export function MapLayers({ vis, setVis, counts, hasTrip, grades }: {
  vis: Record<LayerKey, boolean>; setVis: (k: LayerKey, on: boolean) => void; counts: Partial<Record<LayerKey, number>>; hasTrip: boolean; grades: string[]
}) {
  const [open, setOpen] = useState(() => !matchMedia('(max-width: 900px)').matches)
  const shown = LAYERS.filter((l) => hasTrip || !l.tripOnly)
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
          {(['Cameras', 'On the road'] as const).map((g) => (
            <div key={g} className="layers-group" role="group" aria-label={g}>
              <span className="eyebrow-sm">{g}</span>
              {shown.filter((l) => l.group === g).map((l) => (
                <button key={l.key} className="lchip has-rpl" aria-pressed={vis[l.key]} onPointerDown={ripple} onClick={() => setVis(l.key, !vis[l.key])}>
                  <i className={`sw sw-${l.key}`} aria-hidden />
                  <span>{l.label}</span>
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
