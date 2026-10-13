import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { CITIES, regionName, type City } from '../lib/cities'
import { Icon } from './Icon'

type Row = City & { cams: number }
const km = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
  Math.hypot((a.lat - b.lat) * 111.2, (a.lon - b.lon) * 111.2 * Math.cos((a.lat * Math.PI) / 180))

// Loaded once per visit: how many cameras each city has (one small, edge-cached call).
let counts: Promise<{ cities: { key: string; cams: number }[]; total: number }> | null = null
const loadCounts = () => (counts ??= fetch('/api/cities').then((r) => r.json() as Promise<{ cities: { key: string; cams: number }[]; total: number }>).catch((e) => { counts = null; throw e }))

// The welcome (and the header's city button): what RouteX does, then one search across every Canadian city with cameras.
function CityPickerView({ open, first, current, onPick, onClose }: {
  open: boolean; first: boolean; current: string | null; onPick: (c: City) => void; onClose: () => void
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [total, setTotal] = useState(0)
  const [locating, setLocating] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) { dlg.current?.close(); return }
    setQ(''); setNote(''); dlg.current?.showModal()
    loadCounts().then((j) => {
      const n = new Map(j.cities.map((c) => [c.key, c.cams]))
      setRows(CITIES.filter((c) => n.has(c.key)).map((c) => ({ ...c, cams: n.get(c.key)! })))
      setTotal(j.total)
    }).catch(() => setRows([]))
  }, [open])

  const shown = useMemo(() => {
    if (!rows) return []
    const t = q.trim().toLowerCase()
    if (!t) return [...rows].sort((a, b) => b.cams - a.cams).slice(0, 8)
    const starts = rows.filter((c) => c.name.toLowerCase().startsWith(t))
    const has = rows.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(t))
    return [...starts, ...has].slice(0, 12)
  }, [rows, q])

  const nearMe = () => {
    if (!rows?.length || !('geolocation' in navigator)) return
    setLocating(true); setNote('')
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false)
        const me = { lat: p.coords.latitude, lon: p.coords.longitude }
        const best = [...rows].sort((a, b) => km(me, a) - km(me, b))[0]
        if (best && km(me, best) < 150) onPick(best)
        else setNote('No cameras within 150 km of you yet. Search for a city instead.')
      },
      () => { setLocating(false); setNote("Couldn't get your location. Search for a city instead.") },
      { timeout: 10000, maximumAge: 600000 },
    )
  }

  return (
    <dialog ref={dlg} className="city-dlg" onClose={onClose} aria-labelledby="city-q">
      {open && (
        <div className="city-card">
          {!first && <button type="button" className="btn-icon btn-xs city-close" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" size={16} /></button>}
          {first && (
            <div className="city-intro">
              <p className="city-welcome">Welcome to RouteX</p>
              <ul className="city-feats">
                <li><Icon name="camera" size={16} /><span><strong>Preview your drive:</strong> See live traffic cameras along your route, in the order you’ll pass them.</span></li>
                <li><Icon name="alert" size={16} /><span><strong>Check conditions ahead:</strong> View incidents, closures, road conditions and weather along your trip.</span></li>
                <li><Icon name="route" size={16} /><span><strong>Route planning:</strong> Add multiple stops and optimize their order to reduce driving distance.</span></li>
              </ul>
            </div>
          )}
          <h2 id="city-q">What city would you like to view?</h2>
          <label className="city-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search any city in Canada" aria-label="Search cities" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); onPick(shown[0]) } }} />
          </label>
          <ul className="city-list" aria-label={q ? 'Matching cities' : 'Cities with the most cameras'}>
            {!rows && <li className="city-empty">Loading cameras…</li>}
            {rows && !q && <li className="city-hint">Most cameras</li>}
            {rows && q && !shown.length && <li className="city-empty">No cameras near “{q}” yet.</li>}
            {shown.map((c) => (
              <li key={c.key}>
                <button type="button" aria-current={c.key === current} onClick={() => onPick(c)}>
                  <span className="city-name">{c.name}<small>{regionName(c)}</small></span>
                  <span className="city-n tnum">{c.cams} {c.cams === 1 ? 'camera' : 'cameras'}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="city-foot">
            <button type="button" className="btn-ghost btn-sm" onClick={nearMe} disabled={!rows?.length || locating}><Icon name="locate" size={15} /> {locating ? 'Finding you…' : 'Use my location'}</button>
            {total > 0 && <span className="tnum">{total.toLocaleString()} live cameras</span>}
          </div>
          {note && <p className="city-note" role="status">{note}</p>}
        </div>
      )}
    </dialog>
  )
}

export const CityPicker = memo(CityPickerView)
