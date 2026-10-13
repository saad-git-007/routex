import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { cameraWindow } from '../lib/cameraWindow'
import { usePreload, useWatch } from '../lib/frames'
import type { Camera, OnRoute, RoadCondition, Route } from '../lib/types'
import { CameraCard } from './CameraCard'

// Route cameras in driving order. Scrolling the list "drives" the map: the card crossing the middle of the
// screen becomes active, its marker pings and the route lights up to it.
function CameraListView({ cams, route, roads, active, setActive, scrollTo, onZoom, enabled }: {
  cams: OnRoute<Camera>[]; route: Route; roads: Map<string, RoadCondition | null>; active: string | null; setActive: (id: string) => void
  scrollTo: { id: string; n: number } | null; onZoom: (c: Camera) => void; enabled: boolean
}) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const quietUntil = useRef(0)
  const [visible, setVisible] = useState<number[]>([])
  const cameraSet = cameraWindow(cams, enabled ? visible : [])
  useWatch(cameraSet.visible)
  usePreload(cameraSet.preload)
  const loaded = new Set([...cameraSet.visible, ...cameraSet.preload])

  useEffect(() => {
    if (!enabled) { setVisible([]); return }
    let observer: IntersectionObserver
    const observe = () => {
      observer?.disconnect()
      const panel = document.querySelector<HTMLElement>('.panel')
      const root = panel && getComputedStyle(panel).overflowY === 'auto' ? panel : null
      const map = document.querySelector<HTMLElement>('.map-col')
      const top = !root && map && getComputedStyle(map).position === 'sticky' ? map.getBoundingClientRect().bottom : 0
      const shown = new Set<number>()
      setVisible([])
      observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const index = cams.findIndex((c) => c.id === (entry.target as HTMLElement).dataset.cam)
          if (entry.isIntersecting) shown.add(index)
          else shown.delete(index)
        }
        setVisible([...shown].sort((a, b) => a - b))
      }, { root, rootMargin: `-${Math.max(0, top)}px 0px 0px 0px`, threshold: 0 })
      nodes.current.forEach((node) => observer.observe(node))
    }
    observe()
    window.addEventListener('resize', observe)
    return () => { observer.disconnect(); window.removeEventListener('resize', observe) }
  }, [cams, enabled])

  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      if (Date.now() < quietUntil.current) return
      const hit = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
      const id = (hit?.target as HTMLElement | undefined)?.dataset.cam
      if (id) setActive(id)
    // Phones: the sticky map covers the top ~45% of the screen, so watch the middle of what's left below it.
    }, { rootMargin: matchMedia('(max-width: 900px)').matches ? '-66% 0px -22% 0px' : '-42% 0px -42% 0px', threshold: [0, 0.01] })
    nodes.current.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [cams, setActive])

  useEffect(() => {
    if (!scrollTo) return
    const n = nodes.current.get(scrollTo.id)
    if (!n) return
    quietUntil.current = Date.now() + 900
    n.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'center' })
  }, [scrollTo])

  const register = useCallback((id: string, el: HTMLElement | null) => { if (el) nodes.current.set(id, el); else nodes.current.delete(id) }, [])
  const select = useCallback((id: string) => { quietUntil.current = Date.now() + 900; setActive(id) }, [setActive])
  const legLabel = (leg: number) => {
    const l = route.legs[leg]
    if (!l) return ''
    const name = (p: { id: string; label: string }) => (p.id === route.order[0].id ? 'Home' : p.label.split(',')[0])
    return `${name(l.from)} → ${name(l.to)}`
  }

  return (
    <ol className="cam-list">
      {cams.map((c, i) => (
        <li key={c.id}>
          <CameraCard cam={c} index={i} active={c.id === active} load={loaded.has(c.id)} refresh={cameraSet.visible.includes(c.id)} legLabel={legLabel(c.leg)} road={roads.get(c.id)} cardRef={register} onSelect={select} onZoom={onZoom} />
        </li>
      ))}
    </ol>
  )
}

export const CameraList = memo(CameraListView)
