import { useEffect, useMemo, useRef, useState } from 'react'
import { citiesWithCameras, type City } from '../lib/cities'
import type { Camera } from '../lib/types'
import { Icon } from './Icon'

// First visit (or the header's city button): which city to look at. A searchable list and a plain drop-down,
// both of only the Alberta places that have cameras.
export function CityPicker({ open, first, cameras, current, onPick, onClose }: {
  open: boolean; first: boolean; cameras: Camera[]; current: string | null; onPick: (c: City) => void; onClose: () => void
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string>(current ?? '')
  const cities = useMemo(() => citiesWithCameras(cameras), [cameras])
  const shown = cities.filter((c) => c.name.toLowerCase().includes(q.trim().toLowerCase()))
  const chosen = cities.find((c) => c.key === sel)

  useEffect(() => {
    if (open) { setQ(''); setSel(current ?? ''); dlg.current?.showModal() } else dlg.current?.close()
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <dialog ref={dlg} className="city-dlg" onClose={onClose} aria-labelledby="city-q">
      {open && (
        <form method="dialog" className="city-card" onSubmit={(e) => { e.preventDefault(); if (chosen) onPick(chosen) }}>
          {first && <p className="eyebrow">Welcome to RouteX</p>}
          <h2 id="city-q">What city would you like to view?</h2>
          <label className="city-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search Alberta cities and towns" aria-label="Search cities" autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter' && shown.length === 1) { e.preventDefault(); onPick(shown[0]) } }} />
          </label>
          <ul className="city-list" role="listbox" aria-label="Cities with cameras">
            {!cameras.length && <li className="city-empty">Loading cameras…</li>}
            {cameras.length > 0 && !shown.length && <li className="city-empty">No cameras near “{q}”.</li>}
            {shown.map((c) => (
              <li key={c.key}>
                <button type="button" role="option" aria-selected={c.key === sel} onClick={() => setSel(c.key)} onDoubleClick={() => onPick(c)}>
                  <span>{c.name}</span><span className="city-n tnum">{c.cams} {c.cams === 1 ? 'camera' : 'cameras'}</span>
                </button>
              </li>
            ))}
          </ul>
          <label className="city-select">
            <span>Or choose from the list</span>
            <select value={sel} onChange={(e) => setSel(e.target.value)} disabled={!cities.length}>
              <option value="" disabled>Select a city…</option>
              {cities.map((c) => <option key={c.key} value={c.key}>{c.name} ({c.cams})</option>)}
            </select>
          </label>
          <div className="city-actions">
            {!first && <button type="button" className="btn-ghost" onClick={() => dlg.current?.close()}>Cancel</button>}
            <button type="submit" className="btn-accent" disabled={!chosen}>{chosen ? `View ${chosen.name}` : 'Pick a city'}<Icon name="chevron" size={16} /></button>
          </div>
        </form>
      )}
    </dialog>
  )
}
