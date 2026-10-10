import { useEffect, useRef } from 'react'
import { useMotionValue, useSpring } from 'motion/react'

// Magic UI number-ticker: rolls from the previous value to the new one; text is always the real number.
export function NumberTicker({ value, decimals = 0, className }: { value: number; decimals?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const mv = useMotionValue(value)
  const spring = useSpring(mv, { damping: 40, stiffness: 140 })
  useEffect(() => {
    mv.set(value)
    // Springs can be cut short when frames are throttled (background tabs); always land on the real number.
    const t = setTimeout(() => { if (ref.current) ref.current.textContent = value.toFixed(decimals) }, 1800)
    return () => clearTimeout(t)
  }, [mv, value, decimals])
  useEffect(
    () => spring.on('change', (v) => {
      if (ref.current) ref.current.textContent = v.toFixed(decimals)
    }),
    [spring, decimals],
  )
  return <span ref={ref} className={`tnum ${className ?? ''}`}>{value.toFixed(decimals)}</span>
}
