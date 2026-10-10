import { useEffect, useRef } from 'react'
import { useFrame } from '../lib/frames'
import type { Camera } from '../lib/types'
import { Freshness } from './CameraCard'
import { Icon } from './Icon'

const MAX = 6

// Full-screen picture with pinch, wheel and double-tap zoom, and drag to pan. Keeps updating with each new frame.
// The transform is written straight to the image so zooming never re-renders React.
export function ZoomView({ cam, onClose }: { cam: Camera | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const img = useRef<HTMLImageElement>(null)
  const t = useRef({ s: 1, x: 0, y: 0 })
  const ptrs = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ d: number; s: number } | null>(null)
  const lastTap = useRef(0)
  const f = useFrame(cam?.id ?? '')

  const apply = (animate = false) => {
    const el = img.current, st = stage.current
    if (!el || !st) return
    const { width: W, height: H } = st.getBoundingClientRect()
    const v = t.current
    v.s = Math.min(MAX, Math.max(1, v.s))
    v.x = Math.min(0, Math.max(W - W * v.s, v.x))
    v.y = Math.min(0, Math.max(H - H * v.s, v.y))
    el.style.transition = animate ? 'transform 220ms cubic-bezier(.16,1,.3,1)' : 'none'
    el.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.s})`
    st.dataset.zoomed = v.s > 1.01 ? 'true' : 'false'
  }
  // Zoom to scale ns keeping the point (px, py) under the finger.
  const zoomAt = (ns: number, px: number, py: number, animate = false) => {
    const v = t.current, k = Math.min(MAX, Math.max(1, ns)) / v.s
    v.x = px - (px - v.x) * k; v.y = py - (py - v.y) * k; v.s *= k
    apply(animate)
  }
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stage.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }
  const centre = () => { const r = stage.current!.getBoundingClientRect(); return [r.width / 2, r.height / 2] as const }

  useEffect(() => {
    if (cam) { t.current = { s: 1, x: 0, y: 0 }; dlg.current?.showModal(); requestAnimationFrame(() => apply()) }
    else dlg.current?.close()
  }, [cam])

  useEffect(() => {
    const st = stage.current
    if (!st) return
    // Wheel needs a non-passive listener to stop the page from scrolling.
    const wheel = (e: WheelEvent) => { e.preventDefault(); const [x, y] = local(e); zoomAt(t.current.s * Math.exp(-e.deltaY * 0.0018), x, y) }
    st.addEventListener('wheel', wheel, { passive: false })
    const ro = new ResizeObserver(() => apply())
    ro.observe(st)
    return () => { st.removeEventListener('wheel', wheel); ro.disconnect() }
  }, [cam])

  const down = (e: React.PointerEvent) => {
    stage.current!.setPointerCapture(e.pointerId)
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (ptrs.current.size === 2) {
      const [a, b] = [...ptrs.current.values()]
      pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), s: t.current.s }
    } else if (e.pointerType !== 'mouse') {
      const now = Date.now()
      if (now - lastTap.current < 280) { const [x, y] = local(e); zoomAt(t.current.s > 1.2 ? 1 : 2.5, x, y, true); lastTap.current = 0 } else lastTap.current = now
    }
  }
  const move = (e: React.PointerEvent) => {
    const prev = ptrs.current.get(e.pointerId)
    if (!prev) return
    const cur = { x: e.clientX, y: e.clientY }
    ptrs.current.set(e.pointerId, cur)
    if (ptrs.current.size === 2 && pinch.current) {
      const [a, b] = [...ptrs.current.values()]
      const [x, y] = local({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      zoomAt(pinch.current.s * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.d), x, y)
    } else if (ptrs.current.size === 1 && t.current.s > 1) {
      t.current.x += cur.x - prev.x; t.current.y += cur.y - prev.y; apply()
    }
  }
  const up = (e: React.PointerEvent) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = null }

  return (
    <dialog ref={dlg} className="zoomview" onClose={onClose} aria-label={cam ? `Zoom: ${cam.name}` : 'Zoom'} onKeyDown={(e) => {
      const [x, y] = centre()
      if (e.key === '+' || e.key === '=') zoomAt(t.current.s * 1.5, x, y, true)
      if (e.key === '-') zoomAt(t.current.s / 1.5, x, y, true)
      if (e.key === '0') zoomAt(1, x, y, true)
    }}>
      {cam && (
        <>
          <div className="zv-head">
            <div className="zv-title"><b>{cam.name}</b><Freshness id={cam.id} /></div>
            <button className="btn-icon" onClick={() => { const [x, y] = centre(); zoomAt(t.current.s / 1.6, x, y, true) }} aria-label="Zoom out"><Icon name="zoomout" /></button>
            <button className="btn-icon" onClick={() => { const [x, y] = centre(); zoomAt(t.current.s * 1.6, x, y, true) }} aria-label="Zoom in"><Icon name="zoomin" /></button>
            <button className="btn-icon" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button>
          </div>
          <div ref={stage} className="zv-stage" data-zoomed="false" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
            onDoubleClick={(e) => { const [x, y] = local(e); zoomAt(t.current.s > 1.2 ? 1 : 2.5, x, y, true) }}>
            {f?.url ? <img ref={img} src={f.url} alt={`Latest picture from ${cam.name}`} draggable={false} /> : <div className="shot-loading" />}
          </div>
          <p className="zv-hint">Pinch, scroll or double-tap to zoom · drag to look around</p>
        </>
      )}
    </dialog>
  )
}
