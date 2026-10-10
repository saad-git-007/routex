import { useEffect, useId, useRef, useState } from 'react'
import { findPlace, reverse, suggest, type Suggestion } from '../lib/api'
import type { Place } from '../lib/types'
import { Icon } from './Icon'

// One combobox for addresses and places (Esri World Geocoder). Only the typed text leaves the browser.
export function AddressSearch({ placeholder, onPick, locate, autoFocus, big }: {
  placeholder: string; onPick: (p: Place) => void; locate?: boolean; autoFocus?: boolean; big?: boolean
}) {
  const [text, setText] = useState('')
  const [items, setItems] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const id = useId()

  useEffect(() => {
    if (text.trim().length < 3) { setItems([]); return }
    const n = ++seq.current
    const ctl = new AbortController()
    const t = setTimeout(() => {
      suggest(text.trim(), ctl.signal).then((s) => { if (n === seq.current) { setItems(s); setActive(s.length ? 0 : -1) } }).catch(() => {})
    }, 220)
    return () => { clearTimeout(t); ctl.abort() }
  }, [text])

  async function choose(s: Suggestion) {
    setBusy(true)
    try {
      const p = await findPlace(s)
      if (p) { onPick(p); setText(''); setItems([]); setOpen(false) }
    } finally { setBusy(false) }
  }

  function here() {
    if (!navigator.geolocation) return
    setBusy(true)
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords
      const label = await reverse(lat, lon).catch(() => 'My location')
      onPick({ id: crypto.randomUUID(), label, lat, lon })
      setBusy(false)
    }, () => setBusy(false), { enableHighAccuracy: true, timeout: 10000 })
  }

  const highlight = (s: string) => {
    const i = s.toLowerCase().indexOf(text.trim().toLowerCase())
    if (i < 0 || !text.trim()) return s
    return <>{s.slice(0, i)}<mark>{s.slice(i, i + text.trim().length)}</mark>{s.slice(i + text.trim().length)}</>
  }

  return (
    <div className={`search ${big ? 'search-big' : ''}`}>
      <span className="search-icon">{busy ? <span className="spinner" /> : <Icon name="search" size={17} />}</span>
      <input
        value={text}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={open && items.length > 0}
        aria-controls={`${id}-list`}
        aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        aria-autocomplete="list"
        onChange={(e) => { setText(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
          else if (e.key === 'Enter' && items[active]) { e.preventDefault(); void choose(items[active]) }
          else if (e.key === 'Escape') setOpen(false)
        }}
      />
      {locate && (
        <button type="button" className="btn-icon search-locate" onClick={here} title="Use my location" aria-label="Use my location">
          <Icon name="locate" size={17} />
        </button>
      )}
      {open && items.length > 0 && (
        <ul className="search-list" id={`${id}-list`} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {items.map((s, i) => {
            const [head, ...tail] = s.text.split(', ')
            return (
              <li key={s.magicKey} id={`${id}-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => void choose(s)}>
                <Icon name="pin" size={15} />
                <span><b>{highlight(head)}</b><small>{tail.join(', ')}</small></span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
