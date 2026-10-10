import { useEffect, useRef, useState } from 'react'
import { history } from '../lib/frames'
import type { Camera } from '../lib/types'
import { Icon } from './Icon'

const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })

// Every picture this browser has kept for a camera (up to 6 h), played as a flip-book.
export function Timelapse({ cam, onClose }: { cam: Camera | null; onClose: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [frames, setFrames] = useState<{ lm: number; url: string }[]>([])
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!cam) return
    dlg.current?.showModal()
    let urls: string[] = []
    void history(cam.id).then((h) => {
      const f = h.map((x) => ({ lm: x.lm, url: URL.createObjectURL(x.blob) }))
      urls = f.map((x) => x.url)
      setFrames(f); setI(Math.max(0, f.length - 1)); setPlaying(f.length > 2)
      if (f.length > 2) setI(0)
    })
    return () => { urls.forEach(URL.revokeObjectURL); setFrames([]); setPlaying(false) }
  }, [cam])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const t = setInterval(() => setI((x) => {
      if (x >= frames.length - 1) { setPlaying(false); return x }
      return x + 1
    }), 260)
    return () => clearInterval(t)
  }, [playing, frames.length])

  const f = frames[i]
  return (
    <dialog ref={dlg} className="sheet tl" onClose={onClose} onClick={(e) => e.target === dlg.current && dlg.current?.close()}>
      {cam && (
        <div className="tl-inner">
          <header className="sheet-head">
            <div>
              <p className="eyebrow">Time-lapse</p>
              <h2>{cam.name}</h2>
            </div>
            <button className="btn-icon" onClick={() => dlg.current?.close()} aria-label="Close"><Icon name="x" /></button>
          </header>
          <div className="tl-stage">
            {f ? <img src={f.url} alt={`${cam.name} at ${fmt(f.lm)}`} /> : <div className="shot-loading" />}
            {f && <span className="tl-time tnum">{fmt(f.lm)}</span>}
          </div>
          <div className="tl-controls">
            <button className="btn-accent btn-round" onClick={() => { if (i >= frames.length - 1) setI(0); setPlaying(!playing) }} disabled={frames.length < 2} aria-label={playing ? 'Pause' : 'Play'}>
              <Icon name={playing ? 'pause' : 'play'} size={16} fill />
            </button>
            <input type="range" min={0} max={Math.max(0, frames.length - 1)} value={i} onChange={(e) => { setPlaying(false); setI(+e.target.value) }} disabled={frames.length < 2}
              style={{ '--p': `${frames.length > 1 ? (i / (frames.length - 1)) * 100 : 100}%` } as React.CSSProperties} aria-label="Frame" />
            <span className="mono tnum">{frames.length ? `${i + 1} / ${frames.length}` : '0'}</span>
          </div>
          {frames.length < 2 && <p className="hint">Collecting · a new frame every minute while this page is open</p>}
        </div>
      )}
    </dialog>
  )
}
