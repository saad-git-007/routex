import { useLayoutEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './Icon'

const STEPS: { target: string; title: string; intro: string; icons: [IconName, string][] }[] = [
  {
    target: '.planner-home', title: 'Plan your trip',
    intro: 'Set home, add stops and optimize their order.',
    icons: [['home', 'Starting point'], ['star', 'Save a place']],
  },
  {
    target: '.map-stack', title: 'Explore the map',
    intro: 'Tap a camera for its live view. Drag or zoom to explore.',
    icons: [['locate', 'Show my location'], ['full', 'Full-screen map']],
  },
  {
    target: '.layers-toggle', title: 'Map layers',
    intro: 'Choose satellite or streets, cameras and road information.',
    icons: [['layers', 'Map filters'], ['alert', 'Incidents, closures & construction']],
  },
  {
    target: '.btn-city', title: 'Switch cities',
    intro: 'Search for another city to explore.',
    icons: [['pin', 'Choose a city']],
  },
  {
    target: '.btn-areas', title: 'Explore Areas',
    intro: 'Browse city cameras or create a camera list. No route needed.',
    icons: [['cctv', 'Areas & camera lists']],
  },
  {
    target: '.btn-leave', title: 'Preview your drive',
    intro: 'Plan a route with cameras to unlock a preview in driving order.',
    icons: [['play', 'Play route cameras'], ['cloud', 'Weather in the trip panel']],
  },
]

type Box = { x: number; y: number; width: number; height: number }
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, Math.max(min, max)))

// Native modal focus handling, with a spotlight that never changes the app’s stacking order.
export function AppTour({ onFinish }: { onFinish: () => void }) {
  const [step, setStep] = useState(0)
  const [spot, setSpot] = useState<Box | null>(null)
  const [position, setPosition] = useState({ left: 12, top: 80 })
  const dialog = useRef<HTMLDialogElement>(null)
  const card = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const current = STEPS[step]

  useLayoutEffect(() => {
    const el = dialog.current!
    const panel = document.querySelector('.panel')
    const initialScroll = { x: window.scrollX, y: window.scrollY, panel: panel?.scrollTop ?? 0 }
    const root = document.documentElement
    const overflow = root.style.overflow
    root.style.overflow = 'hidden'
    el.showModal()
    return () => {
      el.close()
      root.style.overflow = overflow
      window.scrollTo({ left: initialScroll.x, top: initialScroll.y, behavior: 'instant' })
      if (panel) panel.scrollTop = initialScroll.panel
      document.querySelector<HTMLButtonElement>('.btn-city')?.focus({ preventScroll: true })
    }
  }, [])

  useLayoutEffect(() => {
    const target = document.querySelector<HTMLElement>(current.target)
    const place = () => {
      const w = window.innerWidth, h = window.innerHeight
      const cardWidth = card.current?.offsetWidth ?? Math.min(360, w - 24)
      const cardHeight = card.current?.offsetHeight ?? 280
      const r = target?.getBoundingClientRect()
      if (!r || !r.width || !r.height) {
        setSpot(null)
        setPosition({ left: (w - cardWidth) / 2, top: Math.max(12, (h - cardHeight) / 2) })
        return
      }
      const x = clamp(r.left - 6, 4, w - 4)
      const y = clamp(r.top - 6, 4, h - 4)
      const width = Math.max(0, Math.min(r.right + 6, w - 4) - x)
      const height = Math.max(0, Math.min(r.bottom + 6, h - 4) - y)
      setSpot({ x, y, width, height })
      const alignedX = clamp(x + width / 2 - cardWidth / 2, 12, w - cardWidth - 12)
      const alignedY = clamp(y, 12, h - cardHeight - 12)
      // Prefer beside the control on desktop, below/above it on phones.
      const beside = w > 900 || (w > h && w > 600)
      let left = alignedX, top: number
      if (beside && x - cardWidth - 16 >= 12) { left = x - cardWidth - 16; top = alignedY }
      else if (beside && x + width + 16 + cardWidth <= w - 12) { left = x + width + 16; top = alignedY }
      else if (y + height + 16 + cardHeight <= h - 12) top = y + height + 16
      else if (y - cardHeight - 16 >= 12) top = y - cardHeight - 16
      else top = h - cardHeight - 12
      setPosition({ left, top: Math.max(12, top) })
    }
    // Keep the planner below the sticky mobile map; don’t scroll a header control under it.
    const prepare = () => {
      if (target?.closest('.planner')) {
        const panel = document.querySelector<HTMLElement>('.panel')
        const map = document.querySelector<HTMLElement>('.map-col')
        if (panel && getComputedStyle(panel).overflowY === 'auto') panel.scrollTop = 0
        else if (target && map) {
          const visibleTop = map.getBoundingClientRect().bottom + 14
          window.scrollBy({ top: target.getBoundingClientRect().top - visibleTop, behavior: 'instant' })
        }
      }
      place()
    }
    prepare()
    heading.current?.focus({ preventScroll: true })
    const observer = new ResizeObserver(prepare)
    if (target) observer.observe(target)
    if (card.current) observer.observe(card.current)
    window.addEventListener('resize', prepare)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', prepare)
      window.removeEventListener('scroll', place, true)
    }
  }, [current])

  return (
    <dialog ref={dialog} className="tour-dialog" aria-labelledby="tour-title" aria-describedby="tour-intro"
      onCancel={(e) => { e.preventDefault(); onFinish() }}>
      <svg className="tour-shade" aria-hidden="true">
        <defs><mask id="tour-hole"><rect width="100%" height="100%" fill="white" />
          {spot && <rect {...spot} rx="12" fill="black" />}
        </mask></defs>
        <rect width="100%" height="100%" fill="rgba(2, 4, 10, .78)" mask="url(#tour-hole)" />
        {spot && <rect {...spot} rx="12" fill="none" stroke="var(--accent)" strokeWidth="2" />}
      </svg>
      <section ref={card} className="tour-card" style={position}>
        <div className="tour-top"><span className="eyebrow">A quick look around</span>
          <button className="btn-ghost" onClick={onFinish}>Skip tour</button></div>
        <div key={step} className="tour-content">
          <h2 ref={heading} id="tour-title" tabIndex={-1}>{current.title}</h2>
          <p id="tour-intro">{current.intro}</p>
          <ul className="tour-icons">{current.icons.map(([icon, text]) => (
            <li key={icon}><span className="tour-icon"><Icon name={icon} size={20} /></span><span>{text}</span></li>
          ))}</ul>
        </div>
        <div className="tour-footer">
          <span className="tour-count" aria-label={`Step ${step + 1} of ${STEPS.length}`}>{step + 1} / {STEPS.length}</span>
          <div className="tour-actions">
            {step > 0 && <button className="btn-ghost" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn-accent" onClick={() => step === STEPS.length - 1 ? onFinish() : setStep(step + 1)}>
              {step === STEPS.length - 1 ? 'Get started' : 'Next'}<Icon name={step === STEPS.length - 1 ? 'check' : 'chevron'} size={16} />
            </button>
          </div>
        </div>
      </section>
    </dialog>
  )
}
