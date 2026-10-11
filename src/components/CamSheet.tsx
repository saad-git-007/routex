import { motion, useDragControls } from 'motion/react'
import { useRef, useState } from 'react'
import type { Camera, RoadCondition } from '../lib/types'
import { Freshness, RoadNote, Shot } from './CameraCard'
import { Icon } from './Icon'
import { isDirect } from '../lib/live'

// A swipe-up panel for one camera: the picture shows at once; drag up for a bigger view, down to close.
// Drag thresholds after vaul (MIT, Emil Kowalski) and beUI bottom-sheet (MIT, Saurabh Chauhan).
export function CamSheet({ cam, index, total, meta, road, onPrev, onNext, onClose, onTimelapse, onZoom }: {
  cam: Camera; index: number | null; total: number; meta: string; road: RoadCondition | null
  onPrev?: () => void; onNext?: () => void; onClose: () => void; onTimelapse: () => void; onZoom: () => void
}) {
  const [big, setBig] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useDragControls()
  const grab = (e: React.PointerEvent) => drag.start(e)
  return (
    <motion.div
      className={`camsheet ${big ? 'is-big' : ''}`}
      role="dialog"
      aria-label={cam.name}
      ref={ref}
      initial={{ y: 28 }}
      animate={{ y: 0 }}
      exit={{ y: '100%', transition: { duration: 0.22, ease: [0.77, 0, 0.175, 1] } }}
      transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
      drag="y"
      dragListener={false}
      dragControls={drag}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.04, bottom: 0.4 }}
      dragSnapToOrigin
      dragTransition={{ bounceStiffness: 600, bounceDamping: 40 }}
      onDragEnd={(_, { offset: { y }, velocity: { y: v } }) => {
        const h = ref.current?.offsetHeight ?? 320
        if (v < -400 || y < -60) setBig(true)
        else if (v > 400 || y > h * 0.25) { if (big && v < 800 && y < h * 0.4) setBig(false); else onClose() }
      }}
    >
      <button className="camsheet-grip" onPointerDown={grab} onClick={() => setBig(!big)} aria-label={big ? 'Smaller picture' : 'Bigger picture'}><i /></button>
      <div className="camsheet-head" onPointerDown={grab}>
        {index != null && <span className="cam-index tnum">{index + 1}</span>}
        <div className="camsheet-title">
          <b>{cam.name}</b>
          <span>{meta}</span>
        </div>
        {!isDirect(cam.id) && <button className="btn-icon btn-xs" onClick={onTimelapse} aria-label="Time-lapse" title="Time-lapse"><Icon name="film" size={16} /></button>}
        <button className="btn-icon btn-xs" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
      </div>
      <div className="camsheet-pic" role="button" tabIndex={0} aria-label="Zoom into the picture" title="Tap to zoom" onClick={onZoom} onKeyDown={(e) => e.key === 'Enter' && onZoom()}>
        <Shot id={cam.id} alt={`Latest picture from ${cam.name}`} className="camsheet-shot" />
        <Freshness id={cam.id} />
      </div>
      <RoadNote road={road} className="camsheet-road" />
      {index != null && (
        <div className="camsheet-nav">
          <button className="btn-sm" onClick={onPrev} disabled={!onPrev} aria-label="Previous camera on the route"><Icon name="left" size={15} /> Prev</button>
          <span className="mono tnum">{index + 1} of {total} on route</span>
          <button className="btn-sm" onClick={onNext} disabled={!onNext} aria-label="Next camera on the route">Next <Icon name="chevron" size={15} /></button>
        </div>
      )}
    </motion.div>
  )
}
