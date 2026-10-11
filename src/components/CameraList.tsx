import { useEffect, useRef } from 'react'
import type { Camera, OnRoute, RoadCondition, Route } from '../lib/types'
import { CameraCard } from './CameraCard'

// Route cameras in driving order. Scrolling the list "drives" the map: the card crossing the middle of the
// screen becomes active, its marker pings and the route lights up to it.
export function CameraList({ cams, route, roads, active, setActive, scrollTo, onZoom }: {
  cams: OnRoute<Camera>[]; route: Route; roads: Map<string, RoadCondition | null>; active: string | null; setActive: (id: string) => void
  scrollTo: { id: string; n: number } | null; onZoom: (c: Camera) => void
}) {
  const nodes = useRef(new Map<string, HTMLElement>())
  const quietUntil = useRef(0)

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
          <CameraCard
            cam={c} index={i} active={c.id === active} legLabel={legLabel(c.leg)} road={roads.get(c.id)}
            cardRef={(el) => { if (el) nodes.current.set(c.id, el); else nodes.current.delete(c.id) }}
            onSelect={() => { quietUntil.current = Date.now() + 900; setActive(c.id) }}
            onZoom={() => onZoom(c)}
          />
        </li>
      ))}
    </ol>
  )
}
