import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchCameras, fetchCommunities, setSearchNear, fetchEvents, fetchRoads, fetchWeather, planRoute } from './lib/api'
import { LEVEL_TEXT, roadAt, roadGrade, routeLevel } from './lib/conditions'
import { useFrames, useWatch } from './lib/frames'
import { km, kmIn, mins, onRoute, overlaps, pointAt } from './lib/geo'
import { DEFAULT_LAYERS, sourceLabel, type LayerKey } from './lib/layers'
import { ripple } from './lib/ripple'
import { useLiveLocation } from './lib/useLocation'
import type { CamList } from './lib/lists'
import { useStored } from './lib/store'
import { useWtaRoads, type View } from './lib/wta'
import { useBump } from './lib/useSeen'
import { AnimatePresence } from 'motion/react'
import type { Camera, Community, OnRoute, OptimizeBy, Place, RoadEvent, Route, TripShape, Weather } from './lib/types'
import { AlertsPanel } from './components/AlertsPanel'
import { AreaShow } from './components/AreaShow'
import { QUADRANTS, type Area } from './lib/areas'
import { BeforeILeave } from './components/BeforeILeave'
import { NO_REPORT, STALE_MS } from './components/CameraCard'
import { CamSheet } from './components/CamSheet'
import { MapLayers } from './components/MapLayers'
import { SavedRoutes, TripActions } from './components/TripActions'
import { ZoomView } from './components/ZoomView'
import { readTripLink, type SavedRoute } from './lib/trip'
import { CameraList } from './components/CameraList'
import { Icon } from './components/Icon'
import { MapView, type Basemap } from './components/MapView'
import { CityPicker } from './components/CityPicker'
import { CITIES, PROVINCES, cityZoom, type City, type Province } from './lib/cities'
import { Planner } from './components/Planner'
import { Segmented } from './components/Segmented'
import { Timelapse } from './components/Timelapse'
import { WeatherPanel } from './components/WeatherPanel'
import { DotPattern } from './components/magic/DotPattern'
import { NumberTicker } from './components/magic/NumberTicker'

type Tab = 'cameras' | 'alerts' | 'weather'

function usePoll<T>(fn: () => Promise<T>, every: number, deps: unknown[] = []) {
  const [v, setV] = useState<T | null>(null)
  useEffect(() => {
    let live = true
    const run = () => { if (document.visibilityState === 'visible') fn().then((x) => live && setV(x)).catch(() => {}) }
    run()
    const t = setInterval(run, every)
    const vis = () => document.visibilityState === 'visible' && run()
    document.addEventListener('visibilitychange', vis)
    return () => { live = false; clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return v
}

// Cameras and events count as on the route within this distance of it.
const CAM_RADIUS = 250

export default function App() {
  const [home, setHome] = useStored<Place | null>('home', null)
  const [stops, setStops] = useStored<Place[]>('stops', [])
  const [saved, setSaved] = useStored<Place[]>('saved', [])
  const [shape, setShape] = useStored<TripShape>('shape', 'round')
    const [tab, setTab] = useStored<Tab>('tab', 'cameras')
  const [storedArea, setArea] = useStored<Area>('area', 'ne')
  // Older versions stored Alberta regions here; anything that isn't a part of Calgary falls back to Northeast.
  const area: Area = QUADRANTS.some((q) => q.key === storedArea) ? storedArea : 'ne'
  const [camLists, setCamLists] = useStored<CamList[]>('camLists', [])
  const [listId, setListId] = useStored<string | null>('camList', null)
  // Stops are always ordered for the shortest total distance.
  const by: OptimizeBy = 'distance'
  const [layerPrefs, setLayerPrefs] = useStored<Partial<Record<LayerKey, boolean>>>('layers', {})
  const vis = { ...DEFAULT_LAYERS, ...layerPrefs }
  const setVis = (k: LayerKey, on: boolean) => setLayerPrefs((v) => ({ ...v, [k]: on }))
  const [basemap, setBasemap] = useStored<Basemap>('basemap', 'sat')
  const [names, setNames] = useStored('communities', false)
  const [communities, setCommunities] = useState<Community[] | null>(null)
  const [locOn, setLocOn] = useStored('liveLocation', false)
  const { fix, error: locError } = useLiveLocation(locOn)
  const [locMsg, setLocMsg] = useState('')
  // Community boundaries are only fetched the first time the names are switched on.
  useEffect(() => {
    if (names && !communities) fetchCommunities().then(setCommunities).catch(() => setNames(false))
  }, [names]) // eslint-disable-line react-hooks/exhaustive-deps

  const [cameras, setCameras] = useState<Camera[]>([])
  const [route, setRoute] = useState<Route | null>(null)
  const [routing, setRouting] = useState(false)
  const [routeError, setRouteError] = useState('')
  const [active, setActive] = useState<string | null>(null)
  const [scrollTo, setScrollTo] = useState<{ id: string; n: number } | null>(null)
  const [flyTo, setFlyTo] = useState<{ lat: number; lon: number; zoom?: number; n: number } | null>(null)
  const [sheet, setSheet] = useState<string | null>(null)
  const [zoom, setZoom] = useState<Camera | null>(null)
  const [savedRoutes, setSavedRoutes] = useStored<SavedRoute[]>('routes', [])
  const [full, setFull] = useState(false)
  const mapCol = useRef<HTMLDivElement>(null)
  const [lapse, setLapse] = useState<Camera | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [areasOpen, setAreasOpen] = useState(false)
  // The city to look at. Unset means a first visit, which opens the city question.
  const [cityKey, setCityKey] = useStored<string | null>('city', null)
  const [cityOpen, setCityOpen] = useState(cityKey == null)
  const city = CITIES.find((c) => c.key === cityKey)
  const prov: Province = city?.prov ?? 'ab'
  NO_REPORT.text = prov === 'ab' ? 'City street · no 511 road report' : 'No road condition report here'
  if (home) setSearchNear(home.lat, home.lon, prov)
  else if (city) setSearchNear(city.lat, city.lon, prov)
  const pickCity = (c: City) => {
    setCityKey(c.key); setCityOpen(false)
    setFlyTo({ lat: c.lat, lon: c.lon, zoom: cityZoom(c), n: Date.now() })
  }
  const [selEvent, setSelEvent] = useState<string | null>(null)

  // Each province's cameras load on their own; switching province swaps the whole set.
  useEffect(() => { setCameras([]); fetchCameras(prov).then(setCameras).catch(() => {}) }, [prov])
  // A shared trip link (#trip=…) loads that trip, then the hash is cleared.
  useEffect(() => {
    const t = readTripLink()
    if (!t) return
    setHome(t.home); setStops(() => t.stops); setShape(t.shape)
    history.replaceState(null, '', location.pathname + location.search)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const loadRoute = (r: SavedRoute) => {
    setHome(r.home); setStops(() => r.stops.map((p) => ({ ...p, id: crypto.randomUUID() }))); setShape(r.shape)
  }
  const evData = usePoll(() => fetchEvents(prov), 120_000, [prov])
  const roadData = usePoll(() => fetchRoads(prov), 600_000, [prov])
  const abRoads = roadData?.roads ?? []
  const events = evData?.events ?? []
  const alerts = evData?.alerts ?? []
  const [alertOpen, setAlertOpen] = useState(false)

  // ── route: re-plan when home, stops or shape change ──
  const stopKey = stops.map((s) => s.id).join(',')
  useEffect(() => {
    if (!home || !stops.length) { setRoute(null); return }
    const ctl = new AbortController()
    setRouting(true); setRouteError('')
    const t = setTimeout(() => {
      planRoute(home, stops, shape, by, ctl.signal)
        .then((r) => { setRoute(r); setActive(null) })
        .catch((e) => { if (!ctl.signal.aborted) setRouteError(e.message === 'No route' ? 'No drivable route between these places' : 'Routing is busy, trying again shortly') })
        .finally(() => !ctl.signal.aborted && setRouting(false))
    }, 250)
    return () => { clearTimeout(t); ctl.abort() }
  }, [home?.id, home?.lat, stopKey, shape, by]) // eslint-disable-line react-hooks/exhaustive-deps

  // Retry a failed route once after a few seconds (the public OSRM server rate-limits bursts).
  useEffect(() => {
    if (!routeError || !home || !stops.length) return
    const t = setTimeout(() => planRoute(home, stops, shape, by).then((r) => { setRoute(r); setRouteError('') }).catch(() => {}), 4000)
    return () => clearTimeout(t)
  }, [routeError]) // eslint-disable-line react-hooks/exhaustive-deps

  const routeCamsAll = useMemo(() => (route ? onRoute(route, cameras, CAM_RADIUS) : []), [route, cameras])
  // Outside Alberta, road conditions come from the 511 map tiles around the route, its cameras and the open camera.
  const [mapView, setMapView] = useState<View | null>(null)
  const wtaPoints = useMemo(() => {
    if (prov === 'ab') return []
    const pts: { lat: number; lon: number }[] = []
    if (route) for (let i = 0; i < route.coords.length; i += Math.max(1, Math.floor(route.coords.length / 80))) pts.push({ lat: route.coords[i][0], lon: route.coords[i][1] })
    pts.push(...routeCamsAll)
    const open = sheet ? cameras.find((c) => c.id === sheet) : undefined
    if (open) pts.push(open)
    return pts
  }, [prov, route, routeCamsAll, sheet, cameras])
  const wta = useWtaRoads(prov, wtaPoints, vis.allRoads ? mapView : null)
  const roads = prov === 'ab' ? abRoads : wta.near
  const allRoads = prov === 'ab' ? abRoads : wta.overlay
  const routeEventsAll = useMemo(() => (route ? onRoute(route, events, CAM_RADIUS) : []), [route, events])
  const routeEventIds = useMemo(() => new Set(routeEventsAll.map((e) => e.id)), [routeEventsAll])
  // What's shown follows the layer switches.
  const routeCams = useMemo(() => routeCamsAll.filter((c) => vis[c.src]), [routeCamsAll, vis.city, vis.ab, vis.town]) // eslint-disable-line react-hooks/exhaustive-deps
  const routeEvents = routeEventsAll.filter((e) => vis[e.kind])
  const mapEvents = useMemo(() => events.filter((e) => vis[e.kind]), [events, vis.incident, vis.closure, vis.construction]) // eslint-disable-line react-hooks/exhaustive-deps
  const mapCameras = useMemo(() => (route && !vis.others ? [] : cameras.filter((c) => vis[c.src])), [cameras, route, vis.others, vis.city, vis.ab, vis.town]) // eslint-disable-line react-hooks/exhaustive-deps
  // Keyed 511 data has each segment's shape: match by location. Otherwise fall back to the highway numbers the route uses.
  const routeRoads = useMemo(() => (route ? roads.filter((r) => (r.line?.length ? overlaps(route, r.line) : route.highways.some((h) => h.toUpperCase() === r.hwy.toUpperCase()))) : []), [route, roads])
  const routeStations = useMemo(() => {
    if (!route) return []
    return (roadData?.stations ?? []).map((s) => ({ ...s, ...onRoute(route, [s], 3000)[0] })).filter((s) => s.along != null).sort((a, b) => a.along - b.along)
  }, [route, roadData])

  // The 511 report for the road each route camera shows (null on city streets).
  const camRoads = useMemo(() => new Map(routeCamsAll.map((c) => [c.id, roadAt(c, roads)])), [routeCamsAll, roads])

  useWatch(routeCams.map((c) => c.id))
  useWatch(sheet ? [sheet] : [])

  // ── weather at home, each stop and every ~15 km between ──
  const wxPoints = useMemo(() => {
    if (!route) return []
    const pts: { lat: number; lon: number; label: string; along: number }[] = []
    const ends = route.order.slice(0, route.order.length - (shape === 'round' ? 1 : 0))
    ends.forEach((p, i) => pts.push({ lat: p.lat, lon: p.lon, label: i === 0 ? 'Home' : p.label.split(',')[0], along: route.legStart[i] ?? 0 }))
    const gap = Math.max(15000, route.distance / 8)
    for (let a = gap; a < route.distance - gap / 2; a += gap) {
      if (pts.some((p) => Math.abs(p.along - a) < gap / 2)) continue
      const [lat, lon] = pointAt(route, a)
      pts.push({ lat, lon, label: 'On the way', along: a })
    }
    return pts.sort((a, b) => a.along - b.along).slice(0, 10)
  }, [route, shape])
  const weather = usePoll<Weather[]>(() => fetchWeather(wxPoints), 900_000, [wxPoints]) ?? []

  const { frames } = useFrames()
  const staleCams = routeCamsAll.filter((c) => { const f = frames.get(c.id); return f?.lm && Date.now() - f.lm > STALE_MS }).length
  const { level, reasons } = routeLevel(routeEventsAll, routeRoads, weather, staleCams, routeStations, alerts.length)
  const focusAlong = routeCams.find((c) => c.id === active)?.along ?? null

  // A route camera tapped on the map scrolls its card into view; in full screen (or off the route) it opens the swipe-up panel.
  const onCam = useCallback((id: string) => {
    const c = routeCams.find((x) => x.id === id)
    if (c) setActive(id)
    if (c && !full) { setTab('cameras'); setScrollTo({ id, n: Date.now() }); setSheet(null) }
    else setSheet(id)
  }, [routeCams, full, setTab])

  // Full screen: the real thing where the browser allows it, a fixed overlay everywhere (iPhone Safari can't full-screen a div).
  // Live location: centre on the first fix after switching on; a blocked permission switches it back off.
  const centred = useRef(false)
  useEffect(() => {
    if (!locOn) { centred.current = false; return }
    if (fix && !centred.current) { centred.current = true; setFlyTo({ lat: fix.lat, lon: fix.lon, zoom: 15, n: Date.now() }) }
  }, [fix, locOn])
  useEffect(() => {
    if (!locError) return
    setLocMsg(locError.text)
    if (locError.code === 1) setLocOn(false)
    const t = setTimeout(() => setLocMsg(''), 6000)
    return () => clearTimeout(t)
  }, [locError]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggleFull = () => {
    if (!full) { setFull(true); mapCol.current?.requestFullscreen?.().catch(() => {}) }
    else { setFull(false); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}) }
  }
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setFull(false) }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('is-map-full', full)
    if (!full) return
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('dialog[open]')) { if (sheet) setSheet(null); else setFull(false) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [full, sheet])

  const sheetCam = sheet ? cameras.find((c) => c.id === sheet) ?? null : null
  const sheetIdx = sheet ? routeCams.findIndex((c) => c.id === sheet) : -1
  const stepSheet = (d: number) => { const c = routeCams[sheetIdx + d]; if (c) { setSheet(c.id); setActive(c.id) } }
  const layerCounts: Partial<Record<LayerKey, number>> = route
    ? {
        city: routeCamsAll.filter((c) => c.src === 'city').length, ab: routeCamsAll.filter((c) => c.src === 'ab').length, town: routeCamsAll.filter((c) => c.src === 'town').length, others: cameras.length - routeCamsAll.length,
        incident: routeEventsAll.filter((e) => e.kind === 'incident').length, closure: routeEventsAll.filter((e) => e.kind === 'closure').length,
        construction: routeEventsAll.filter((e) => e.kind === 'construction').length, roads: routeRoads.length, allRoads: allRoads.length,
      }
    : {
        city: cameras.filter((c) => c.src === 'city').length, ab: cameras.filter((c) => c.src === 'ab').length, town: cameras.filter((c) => c.src === 'town').length,
        incident: events.filter((e) => e.kind === 'incident').length, closure: events.filter((e) => e.kind === 'closure').length, construction: events.filter((e) => e.kind === 'construction').length, allRoads: allRoads.length,
      }
  const shownRoads = vis.roads ? routeRoads : []

  const showEvent = (e: RoadEvent) => { setSelEvent(e.id); setFlyTo({ lat: e.lat, lon: e.lon, zoom: 16, n: Date.now() }) }
  const onEvent = (id: string) => { const e = events.find((x) => x.id === id); if (e) { setTab('alerts'); showEvent(e) } }

  const alertCount = routeEvents.length + shownRoads.filter((r) => !/bare (dry|wet)/i.test(r.condition)).length
  const hasTrip = !!route && !!home
  const alertBump = useBump(alertCount)

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="/" aria-label="RouteX">
          <svg viewBox="0 0 32 32" className="brand-mark" aria-hidden>
            <defs><linearGradient id="bm" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#4cc9f0" /><stop offset=".5" stopColor="#6aa6f8" /><stop offset="1" stopColor="#8b7cf6" /></linearGradient></defs>
            <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#bm)" />
            <path d="M9.5 9.5 22.5 22.5" fill="none" stroke="#031420" strokeWidth="2.6" strokeLinecap="round" opacity=".55" /><path d="M10.6 21.4C15 17 17 15 21.4 10.6" fill="none" stroke="#031420" strokeWidth="2.6" strokeLinecap="round" /><circle cx="9.2" cy="22.8" r="2.4" fill="#e3f8ff" stroke="#031420" strokeWidth="1.8" /><circle cx="22.8" cy="9.2" r="3" fill="#031420" />
          </svg>
          <span>Route<em>X</em></span>
        </a>
        {hasTrip && (
          <div className="top-stats" aria-live="polite">
            <span><b className="tnum">{mins(route.duration)}</b></span>
            <span className="dot-sep" />
            <span className="tnum">{km(route.distance)}</span>
            <span className={`level level-${level}`} title={reasons.join(' · ')}><i />{LEVEL_TEXT[level]}</span>
          </div>
        )}
        <div className="top-actions">
          <button className="btn-city has-rpl" onPointerDown={ripple} onClick={() => setCityOpen(true)} aria-label={`City: ${city?.name ?? 'choose one'}. Change city`} title="Change city">
            <Icon name="pin" size={16} /><span>{city?.name ?? 'City'}</span>
          </button>
          <button className="btn-areas has-rpl" onPointerDown={ripple} onClick={() => setAreasOpen(true)} aria-label="Areas: five cameras spread across a part of the city" title="Areas">
            <Icon name="camera" size={16} /><span>Areas</span>
          </button>
          <button className="btn-accent btn-leave has-rpl" onPointerDown={ripple} disabled={!routeCams.length} onClick={() => setLeaving(true)} aria-label="Before I leave: every camera on the route, full screen">
            <Icon name="play" size={14} fill /> <span>Before I leave</span>
          </button>
        </div>
      </header>

      <main className="layout">
        <div className={`map-col ${full ? 'is-full' : ''}`} ref={mapCol}>
          <MapView
            cameras={mapCameras} routeCams={routeCams} route={route} events={mapEvents} routeEventIds={routeEventIds} routeRoads={shownRoads} allRoads={vis.allRoads ? allRoads : []} onView={setMapView}
            basemap={basemap} communities={names ? communities ?? [] : []} me={fix}
            home={home} start={city ? { lat: city.lat, lon: city.lon, zoom: cityZoom(city) } : null} activeCam={active} focusAlong={focusAlong}
            onCam={onCam} onEvent={onEvent}
            onAddStop={(p) => setStops((s) => [...s, p])} onSetHome={setHome} flyTo={flyTo}
          />
          <MapLayers vis={vis} setVis={setVis} counts={layerCounts} hasTrip={hasTrip} prov={prov} grades={[...shownRoads, ...(vis.allRoads ? allRoads : [])].map(roadGrade)}
            basemap={basemap} setBasemap={setBasemap} names={names} setNames={setNames} namesCount={communities?.length} />
          <div className="map-tools">
            {full && hasTrip && (
              <span className="full-stats"><b className="tnum">{mins(route.duration)}</b> · <span className="tnum">{km(route.distance)}</span><span className={`level level-${level}`}><i />{LEVEL_TEXT[level]}</span></span>
            )}
            {locMsg && !fix && <span className="loc-msg" role="status">{locMsg}</span>}
            <button className={`map-btn loc-btn ${locOn && !fix ? 'is-seeking' : ''}`} onClick={() => { setLocMsg(''); setLocOn(!locOn) }} aria-pressed={locOn}
              aria-label={locOn ? 'Hide my location' : 'Show my location'} title={locOn ? (fix ? `Hide my location (±${Math.round(fix.acc)} m)` : 'Finding you…') : 'Show my location'}>
              <Icon name="locate" size={18} />
            </button>
            <button className="map-btn" onClick={toggleFull} aria-pressed={full} aria-label={full ? 'Exit full screen' : 'Full-screen map'} title={full ? 'Exit full screen (Esc)' : 'Full-screen map'}>
              <Icon name={full ? 'unfull' : 'full'} size={18} />
            </button>
          </div>
          <AnimatePresence>{sheetCam && (
            <CamSheet
              key="sheet"
              cam={sheetCam}
              road={camRoads.get(sheetCam.id) ?? roadAt(sheetCam, roads)}
              index={sheetIdx >= 0 ? sheetIdx : null}
              total={routeCams.length}
              meta={sheetIdx >= 0 ? `${kmIn(routeCams[sheetIdx].along)} on your route${sheetCam.src === 'city' ? '' : ' · ' + sourceLabel(sheetCam)}` : `${sourceLabel(sheetCam)} · not on your route`}
              onPrev={sheetIdx > 0 ? () => stepSheet(-1) : undefined}
              onNext={sheetIdx >= 0 && sheetIdx < routeCams.length - 1 ? () => stepSheet(1) : undefined}
              onClose={() => setSheet(null)}
              onTimelapse={() => setLapse(sheetCam)}
              onZoom={() => setZoom(sheetCam)}
            />
          )}</AnimatePresence>
        </div>

        <aside className="panel">
          <Planner
            home={home} setHome={setHome} stops={stops} setStops={setStops} saved={saved} setSaved={setSaved}
            shape={shape} setShape={setShape} route={route} routing={routing} error={routeError}
            onFocus={(p) => setFlyTo({ lat: p.lat, lon: p.lon, zoom: 16, n: Date.now() })}
          />

          <SavedRoutes routes={savedRoutes} setRoutes={setSavedRoutes} onLoad={loadRoute} />

          {alerts.length > 0 && (
            <section className={`alert-banner ${alerts.some((a) => a.high) ? 'high' : ''}`}>
              <button className="alert-head" onClick={() => setAlertOpen(!alertOpen)} aria-expanded={alertOpen}>
                <Icon name="alert" size={16} />
                <span>{alerts[0].title}{alerts.length > 1 ? ` · +${alerts.length - 1}` : ''}</span>
                <Icon name={alertOpen ? 'up' : 'down'} size={15} />
              </button>
              {alertOpen && alerts.map((a) => <p key={a.id}><b>{a.title}</b> {a.notes}{a.end ? ` Until ${a.end}.` : ''}</p>)}
            </section>
          )}

          {!hasTrip ? (
            <section className="empty card">
              <DotPattern className="empty-dots" />
              <h1>See the road <em>before you drive it</em></h1>
              <p>Set home and where you're going to get every traffic camera on the way, plus incidents, closures, highway conditions and weather.</p>
              <ol className="steps">
                <li><b>1</b>Set home</li>
                <li><b>2</b>Add destinations</li>
                <li><b>3</b>Scroll the cameras</li>
              </ol>
              <p className="empty-foot mono"><NumberTicker value={cameras.length} /> cameras live across {PROVINCES.find((p) => p.key === prov)!.label}</p>
            </section>
          ) : (
            <>
              <div className="stats card">
                <div className="stat"><strong><NumberTicker value={Math.round(route.duration / 60)} /></strong><span>min</span></div>
                <div className="stat"><strong><NumberTicker value={route.distance / 1000} decimals={1} /></strong><span>km</span></div>
                <div className="stat"><strong><NumberTicker value={routeCams.length} /></strong><span>cameras</span></div>
                <div className={`stat ${alertCount ? 'is-alert' : ''}`}><strong><NumberTicker value={alertCount} /></strong><span>alerts</span></div>
              </div>

              <TripActions route={route} home={home} stops={stops} shape={shape} by={by} routes={savedRoutes} setRoutes={setSavedRoutes} />

              <div className="tabs-sticky">
                <Segmented
                  label="View" className="tabs" value={tab} onChange={setTab}
                  options={[
                    { value: 'cameras', label: <><Icon name="camera" size={15} /> Cameras <span className="count">{routeCams.length}</span></> },
                    { value: 'alerts', label: <><Icon name="alert" size={15} /> Alerts <span key={alertBump} className={`count ${alertCount ? 'warn' : ''} ${alertBump ? 'bump' : ''}`}>{alertCount}</span></> },
                    { value: 'weather', label: <><Icon name="cloud" size={15} /> Weather</> },
                  ]}
                />
              </div>

              {tab === 'cameras' && (routeCams.length ? (
                <CameraList cams={routeCams} route={route} roads={camRoads} active={active} setActive={setActive} scrollTo={scrollTo} onTimelapse={setLapse} onZoom={setZoom} />
              ) : (
                <div className="quiet"><Icon name="camera" size={20} /><p>{routeCamsAll.length ? 'Camera layers are switched off. Turn them back on in Layers on the map.' : `No cameras within ${CAM_RADIUS} m of this route.`}</p></div>
              ))}
              {tab === 'alerts' && <AlertsPanel events={routeEvents} roads={shownRoads} highways={route.highways} route={route} onShowRoad={(r) => { const m = r.line?.[Math.floor((r.line.length - 1) / 2)]; if (m) setFlyTo({ lat: m[0], lon: m[1], zoom: 12, n: Date.now() }) }} onShow={showEvent} selected={selEvent} />}
              {tab === 'weather' && <WeatherPanel weather={weather} stations={routeStations} />}
            </>
          )}
          <footer className="foot">Cameras: City of Calgary &amp; 511 Alberta · Routing: OSRM · Weather: Open-Meteo</footer>
        </aside>
      </main>

      <Timelapse cam={lapse} onClose={() => setLapse(null)} />
      <ZoomView cam={zoom} onClose={() => setZoom(null)} />
      <CityPicker open={cityOpen} first={cityKey == null} current={cityKey} onPick={pickCity}
        onClose={() => { setCityOpen(false); if (cityKey == null) setCityKey('calgary') }} />
      <AreaShow open={areasOpen} onClose={() => setAreasOpen(false)} cameras={cameras} roads={roads} prov={prov} cityKey={cityKey} area={area} setArea={setArea}
        lists={camLists} setLists={setCamLists} listId={listId} setListId={setListId} onZoom={setZoom} />
      {route && <BeforeILeave open={leaving} onClose={() => setLeaving(false)} route={route} cams={routeCams} events={routeEvents as OnRoute<RoadEvent>[]} camRoads={camRoads} weather={weather} level={level} reasons={reasons} onZoom={setZoom} />}
    </div>
  )
}
