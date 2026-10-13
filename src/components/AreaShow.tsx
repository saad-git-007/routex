import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { QUADRANTS, areaOf, spread, type Area } from '../lib/areas'
import { citiesWithCameras, cityOf, cityZoom } from '../lib/cities'
import { sourceLabel } from '../lib/layers'
import { roadAt } from '../lib/conditions'
import { useFrames, usePreload, useWatch } from '../lib/frames'
import { cameraWindow } from '../lib/cameraWindow'
import type { CamList } from '../lib/lists'
import type { Camera, RoadCondition } from '../lib/types'
import { Freshness, RoadNote, Shot } from './CameraCard'
import { extent } from '../lib/geo'
import { Icon } from './Icon'
import { AddressSearch } from './AddressSearch'
import { PickMap } from './PickMap'
import { useWtaRoads } from '../lib/wta'
import { Segmented } from './Segmented'

const DWELL = 5000
const NONE: Camera[] = []

type Edit = { id: string | null; name: string; ids: string[] }
const areaLabel = (c: Camera) => cityOf(c)?.name ?? sourceLabel(c)
type CityRow = ReturnType<typeof citiesWithCameras>[number]

// Any city in the chosen province that has cameras.
function CitySelect({ cities, value, onPick, label }: { cities: CityRow[]; value: string; onPick: (key: string) => void; label: string }) {
  return (
    <label className="area-city">
      <Icon name="pin" size={15} />
      <select value={value} onChange={(e) => onPick(e.target.value)} aria-label={label}>
        {cities.map((c) => <option key={c.key} value={c.key}>{c.name} · {c.cams} {c.cams === 1 ? 'camera' : 'cameras'}</option>)}
      </select>
    </label>
  )
}

// Full screen, like Before I leave: five cameras spread across a city (or one part of Calgary), one per screen,
// or a list of cameras the viewer picked on a map and saved in this browser.
function AreaShowView({ open, paused, onClose, cameras, roads: abRoads, prov, cityKey, area, setArea, lists, setLists, listId, setListId, onZoom }: {
  open: boolean; paused: boolean; onClose: () => void; cameras: Camera[]; roads: RoadCondition[]; prov: string
  cityKey: string | null; area: Area; setArea: (a: Area) => void
  lists: CamList[]; setLists: (f: (l: CamList[]) => CamList[]) => void; listId: string | null; setListId: (id: string | null) => void
  onZoom: (c: Camera) => void
}) {
  const dlg = useRef<HTMLDialogElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [cycle, setCycle] = useState(0)
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

  const { frames } = useFrames()
  const byId = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras])
  // Lists made in another province stay saved but are only offered where their cameras are.
  const shownLists = lists.filter((l) => l.ids.some((id) => byId.has(id)))
  const list = shownLists.find((l) => l.id === listId)
  const cities = useMemo(() => citiesWithCameras(cameras), [cameras])
  const [viewKey, setViewKey] = useState(cityKey ?? 'calgary')
  const view = cities.find((c) => c.key === viewKey) ?? cities.find((c) => c.key === cityKey) ?? cities[0]
  const isCgy = view?.key === 'calgary'
  const inArea = useMemo(() => cameras.filter((c) => cityOf(c)?.key === view?.key && (!isCgy || areaOf(c) === area)), [cameras, view, isCgy, area])
  // Cameras whose picture failed are left out, so a dead feed gets replaced by its neighbour.
  const offline = inArea.filter((c) => frames.get(c.id)?.error).map((c) => c.id).join(',')
  const listCams = useMemo(() => (list ? list.ids.map((id) => byId.get(id)).filter((c): c is Camera => !!c) : []), [list, byId])
  const areaCams = useMemo(() => spread(inArea.filter((c) => !offline.split(',').includes(c.id))), [inArea, offline])
  const cams = list ? listCams : areaCams
  // Outside Alberta, road conditions load from the 511 map tiles around the cameras on show.
  const near = useWtaRoads(prov, open ? cams : NONE, null).near
  const roads = prov === 'ab' ? abRoads : near
  const title = isCgy ? QUADRANTS.find((a) => a.key === area)!.label : view?.name ?? 'Areas'

  // Building or editing a list: a map of every camera, tap to add or remove.
  const [edit, setEdit] = useState<Edit | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [jump, setJump] = useState<{ city: string; quad: Area | '' }>({ city: '', quad: '' })
  const [pin, setPin] = useState<{ lat: number; lon: number; label: string } | null>(null)
  const [pickView, setPickView] = useState<{ center: [number, number]; zoom: number; n: number } | null>(null)
  const startEdit = (l?: CamList) => {
    setEdit(l ? { id: l.id, name: l.name, ids: [...l.ids] } : { id: null, name: '', ids: [] }); setFocus(null); setPin(null); setPlaying(false)
    if (view) jumpCity(view.key)
  }
  const toggle = (id: string) => {
    setEdit((e) => e && { ...e, ids: e.ids.includes(id) ? e.ids.filter((x) => x !== id) : [...e.ids, id] })
    setFocus(id)
  }
  const saveEdit = () => {
    if (!edit?.ids.length) return
    const id = edit.id ?? crypto.randomUUID()
    const name = edit.name.trim() || `My cameras ${lists.length + 1}`
    setLists((ls) => (edit.id ? ls.map((l) => (l.id === id ? { id, name, ids: edit.ids } : l)) : [...ls, { id, name, ids: edit.ids }]))
    setListId(id); setEdit(null)
  }
  const removeList = (l: CamList) => {
    if (!confirm(`Delete the list "${l.name}"?`)) return
    setLists((ls) => ls.filter((x) => x.id !== l.id)); setListId(null)
  }
  const focused = focus ? byId.get(focus) : undefined
  function jumpCity(key: string) {
    const c = cities.find((x) => x.key === key)
    if (c) { setJump({ city: key, quad: '' }); setPickView({ center: [c.lat, c.lon], zoom: cityZoom(c) + 0.5, n: Date.now() }) }
  }
  const jumpQuad = (a: Area) => { const x = QUADRANTS.find((y) => y.key === a)!; setJump({ city: 'calgary', quad: a }); setPickView({ center: x.center, zoom: x.zoom + 0.5, n: Date.now() }) }

  const cameraSet = cameraWindow(cams, open && !paused && !edit ? [i] : [])
  useWatch(open && !paused && edit ? (focus ? [focus] : []) : cameraSet.visible)
  usePreload(cameraSet.preload)
  const loaded = new Set([...cameraSet.visible, ...cameraSet.preload])

  const restart = () => { setI(0); setPlaying(!reduced()); scroller.current?.scrollTo({ top: 0 }) }
  useEffect(() => {
    if (open) { setViewKey(cityKey ?? 'calgary'); dlg.current?.showModal(); requestAnimationFrame(() => scroller.current?.focus({ preventScroll: true })); restart() }
    else { dlg.current?.close(); setEdit(null) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (open && !edit) restart() }, [area, listId, edit, viewKey]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const root = scroller.current
    if (!root || !open || edit) return
    const io = new IntersectionObserver((es) => {
      const e = es.find((x) => x.isIntersecting)
      if (e) { setI(+(e.target as HTMLElement).dataset.i!); setCycle((c) => c + 1); setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches) }
    }, { root, threshold: 0.6 })
    root.querySelectorAll('[data-i]').forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [open, cams, edit])

  const go = (n: number) => {
    const t = Math.max(0, Math.min(cams.length - 1, n))
    scroller.current?.querySelector(`[data-i="${t}"]`)?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' })
    setI(t); setCycle((c) => c + 1); setPlaying(!matchMedia('(prefers-reduced-motion: reduce)').matches)
  }
  useEffect(() => {
    if (!open || edit || !playing || !cams.length) return
    const t = setTimeout(() => (i >= cams.length - 1 ? setPlaying(false) : go(i + 1)), DWELL)
    return () => clearTimeout(t)
  }, [open, edit, playing, i, cycle, cams.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // Mini map: every camera in the area, the five picks numbered.
  const pool = list ? listCams : inArea
  const mini = useMemo(() => {
    if (!pool.length) return null
    const lats = pool.map((c) => c.lat), lons = pool.map((c) => c.lon)
    const [la0, la1] = extent(lats), [lo0, lo1] = extent(lons)
    const k = Math.cos((((la0 + la1) / 2) * Math.PI) / 180)
    const w = (lo1 - lo0) * k || 1e-3, h = la1 - la0 || 1e-3
    const s = 88 / Math.max(w, h)
    const xy = (c: Camera) => [6 + (c.lon - lo0) * k * s, 6 + (la1 - c.lat) * s] as const
    return { W: w * s + 12, H: h * s + 12, xy }
  }, [pool])

  return (
    <dialog ref={dlg} className={`bil areashow ${edit ? 'is-editing' : ''}`} onClose={onClose} onKeyDown={(e) => {
      if (edit) return
      if (['ArrowDown', 'PageDown', ' '].includes(e.key)) { e.preventDefault(); go(i + 1) }
      if (['ArrowUp', 'PageUp'].includes(e.key)) { e.preventDefault(); go(i - 1) }
    }}>
      {open && (
        <button className="btn-icon bil-x" aria-label="Close" title="Close"
          onClick={() => { if (edit?.ids.length && !confirm('Close without saving this list?')) return; dlg.current?.close() }}><Icon name="x" /></button>
      )}
      {open && edit && (
        <>
          <aside className="bil-rail">
            <div className="bil-head">
              <p className="eyebrow">{edit.id ? 'Edit list' : 'New list'}</p>
              <input className="pick-name" value={edit.name} maxLength={40} placeholder="Name this list"
                onChange={(e) => setEdit({ ...edit, name: e.target.value })} aria-label="List name" />
              <CitySelect cities={cities} value={jump.city || view?.key || ''} onPick={jumpCity} label="Jump to a city" />
              {(jump.city || view?.key) === 'calgary' && <Segmented label="Jump to part of Calgary" className="area-seg" value={jump.quad as Area} options={QUADRANTS.map((a) => ({ value: a.key, label: a.short }))} onChange={jumpQuad} />}
              <div className="pick-address">
                <AddressSearch placeholder="Go to an address" onPick={(p) => { setPin({ lat: p.lat, lon: p.lon, label: p.label }); setPickView({ center: [p.lat, p.lon], zoom: 15, n: Date.now() }) }} />
              </div>
              <p className="pick-hint"><i className="pick-dot" aria-hidden /><span><b>The white dots on the map are cameras you can add.</b> Tap one to add it (it becomes a numbered blue circle); tap it again to take it off. Purple and orange dots are cameras too.</span></p>
            </div>
            <ol className="pick-list" aria-label="Cameras in this list">
              {edit.ids.map((id, j) => {
                const c = byId.get(id)
                return (
                  <li key={id} className={id === focus ? 'is-focus' : ''}>
                    <button className="pick-item" onClick={() => { setFocus(id); if (c) setPickView({ center: [c.lat, c.lon], zoom: 15, n: Date.now() }) }}>
                      <span className="tnum">{j + 1}</span>{c?.name ?? 'Camera no longer available'}
                    </button>
                    <button className="btn-icon btn-xs" onClick={() => toggle(id)} aria-label={`Take ${c?.name ?? 'camera'} off the list`}><Icon name="x" size={14} /></button>
                  </li>
                )
              })}
              {!edit.ids.length && <li className="pick-empty">No cameras yet.</li>}
            </ol>
          </aside>

          <div className="pick-stage">
            <PickMap cameras={cameras} picked={edit.ids} focus={focus} onPick={toggle} view={pickView} pin={pin} />
            {focused && (
              <div className="pick-preview">
                <Shot id={focused.id} alt={`Latest picture from ${focused.name}`} className="pick-shot" load={!paused} />
                <div>
                  <h3>{focused.name}</h3>
                  <p>{areaLabel(focused)} · <Freshness id={focused.id} /></p>
                  <button className={edit.ids.includes(focused.id) ? 'btn-ghost btn-sm' : 'btn-accent btn-sm'} onClick={() => toggle(focused.id)}>
                    {edit.ids.includes(focused.id) ? 'Take off list' : '＋ Add to list'}
                  </button>
                </div>
                <button className="btn-icon btn-xs pick-close" onClick={() => setFocus(null)} aria-label="Close preview"><Icon name="x" size={14} /></button>
              </div>
            )}
          </div>

          <div className="bil-bar pick-bar">
            <span className="pick-count"><b className="tnum">{edit.ids.length}</b> {edit.ids.length === 1 ? 'camera' : 'cameras'}</span>
            <button className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn-accent" onClick={saveEdit} disabled={!edit.ids.length}><Icon name="check" size={16} /> Save list</button>
          </div>
        </>
      )}
      {open && !edit && (
        <>
          <aside className="bil-rail">
            <div className="bil-head">
              <p className="eyebrow">{list ? 'My list' : 'Areas'}</p>
              <h2>{list ? list.name : title}</h2>
              {cities.length > 0 && <CitySelect cities={cities} value={list ? '' : view?.key ?? ''} onPick={(k) => { setViewKey(k); setListId(null) }} label="City" />}
              {!list && isCgy && <Segmented label="Part of Calgary" className="area-seg" value={area} onChange={setArea} options={QUADRANTS.map((a) => ({ value: a.key, label: a.short }))} />}
              <div className="area-lists" role="group" aria-label="My lists">
                {shownLists.map((l) => (
                  <button key={l.id} className="lchip has-rpl" aria-pressed={l.id === listId} onClick={() => setListId(l.id)}>
                    <span>{l.name}</span><span className="lchip-n tnum">{l.ids.length}</span>
                  </button>
                ))}
                <button className="lchip lchip-add has-rpl" onClick={() => startEdit()}><Icon name="plus" size={14} /><span>{shownLists.length ? 'New list' : 'Make your own list of traffic cameras'}</span></button>
              </div>
              {list ? (
                <div className="list-tools">
                  <span className="area-note">{cams.length} {cams.length === 1 ? 'camera' : 'cameras'}, in the order you picked them</span>
                  <button className="btn-ghost btn-sm" onClick={() => startEdit(list)}><Icon name="edit" size={14} /> Edit</button>
                  <button className="btn-ghost btn-sm" onClick={() => removeList(list)}><Icon name="x" size={14} /> Delete</button>
                </div>
              ) : (
                <p className="area-note">{cams.length} of {inArea.length} cameras, picked to spread across {isCgy ? 'this part of Calgary' : view?.name}</p>
              )}
            </div>
            {mini && (
              <svg className="bil-mini" viewBox={`0 0 ${mini.W} ${mini.H}`} aria-hidden>
                {!list && inArea.map((c) => { const [x, y] = mini.xy(c); return <circle key={c.id} cx={x} cy={y} r={0.9} className="area-other" /> })}
                {cams.map((c, j) => {
                  const [x, y] = mini.xy(c)
                  return <circle key={c.id} cx={x} cy={y} r={j === i ? 3 : 2.2} className={j === i ? 'on' : ''} onClick={() => { go(j) }} />
                })}
              </svg>
            )}
            <ol className="bil-dots" aria-label="Cameras">
              {cams.map((c, j) => (
                <li key={c.id}><button aria-current={j === i} onClick={() => { go(j) }} title={c.name}><span className="tnum">{j + 1}</span>{c.name}</button></li>
              ))}
            </ol>
          </aside>

          <div className="bil-stage" ref={scroller} tabIndex={-1}>
            {cams.map((c, j) => (
              <section key={c.id} className="bil-slide" data-i={j} aria-label={c.name}>
                <div className="bil-near" />
                <button className="bil-zoom" onClick={() => { setPlaying(false); onZoom(c) }} aria-label={`Zoom into ${c.name}`} title="Tap to zoom"><Shot id={c.id} alt={`Latest picture from ${c.name}`} className="bil-shot" load={loaded.has(c.id)} refresh={j === i} /></button>
                <div className="bil-cap">
                  <span className="bil-n tnum">{j + 1}<small>/{cams.length}</small></span>
                  <div>
                    <h3>{c.name}</h3>
                    <p>{areaLabel(c)} · <Freshness id={c.id} /></p>
                    <RoadNote road={roadAt(c, roads)} className="bil-road" />
                  </div>
                </div>
              </section>
            ))}
            {!cams.length && <div className="quiet"><Icon name="camera" size={20} /><p>{list ? 'None of the cameras in this list are available right now.' : 'No cameras in this area right now.'}</p></div>}
          </div>

          <div className="bil-bar">
            <button className="btn-icon bil-step" onClick={() => go(i - 1)} aria-label="Previous camera" disabled={i === 0}><Icon name="up" /></button>
            <button className="btn-icon bil-step" onClick={() => go(i + 1)} aria-label="Next camera" disabled={i >= cams.length - 1}><Icon name="down" /></button>
            <span className="bil-swipe" aria-hidden><Icon name="swipe" size={18} /> Swipe up or down</span>
            <span className="bil-progress" aria-hidden>{playing && <i key={`${listId ?? area}-${i}-${cycle}`} style={{ animationDuration: `${DWELL}ms` }} />}</span>
          </div>
        </>
      )}
    </dialog>
  )
}

export const AreaShow = memo(AreaShowView)
