import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ripple } from '../lib/ripple'

// Segmented control with a pill that glides behind the active option.
export function Segmented<T extends string>({ value, options, onChange, label, className }: {
  value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string; className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  const [glide, setGlide] = useState(false)
  useLayoutEffect(() => {
    const measure = () => {
      const el = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]')
      setPill(el ? { x: el.offsetLeft, w: el.offsetWidth } : null)
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [value, options.length])
  useLayoutEffect(() => { const t = requestAnimationFrame(() => setGlide(true)); return () => cancelAnimationFrame(t) }, [])
  return (
    <div ref={ref} className={`seg ${className ?? ''}`} role="group" aria-label={label}>
      {pill && <span className={`seg-pill ${glide ? 'glide' : ''}`} style={{ translate: `${pill.x}px 0`, width: pill.w }} />}
      {options.map((o) => (
        <button key={o.value} type="button" className="has-rpl" aria-pressed={o.value === value} title={o.title}
          onPointerDown={(e) => { ripple(e); if (e.pointerType === 'mouse' && e.button === 0) onChange(o.value) }} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
