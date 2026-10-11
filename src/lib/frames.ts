import { useEffect, useSyncExternalStore } from 'react'
import { isDirect } from './live'

// Camera pictures. One batched call a minute for every camera on screen; only pictures newer than what we hold
// come back. The latest picture of each camera is kept in IndexedDB, so cards never start empty after a reload.

export const PERIOD = 60_000
const BATCH = 40
const KEEP = 1, KEEP_MS = 6 * 3600e3

export type Frame = { url: string; lm: number; checked: number; error?: boolean }
type Snapshot = { frames: Map<string, Frame>; nextAt: number; busy: boolean; lastAt: number }

let snap: Snapshot = { frames: new Map(), nextAt: Date.now() + PERIOD, busy: false, lastAt: 0 }
const listeners = new Set<() => void>()
const watched = new Map<string, number>() // id → watcher count
let timer: number | undefined, kick: number | undefined

const emit = (patch: Partial<Snapshot>) => {
  snap = { ...snap, ...patch }
  listeners.forEach((l) => l())
}

// ── IndexedDB ──
let dbp: Promise<IDBDatabase | null> | null = null
function db() {
  dbp ??= new Promise((res) => {
    try {
      const r = indexedDB.open('ct-frames', 1)
      r.onupgradeneeded = () => r.result.createObjectStore('frames')
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
    } catch {
      res(null)
    }
  })
  return dbp
}
const range = (id: string) => IDBKeyRange.bound(`${id}|`, `${id}|~`)

async function store(id: string, lm: number, blob: Blob) {
  const d = await db()
  if (!d) return
  try {
    const tx = d.transaction('frames', 'readwrite'), os = tx.objectStore('frames')
    os.put(blob, `${id}|${lm}`)
    const keys = await new Promise<IDBValidKey[]>((res) => { const q = os.getAllKeys(range(id)); q.onsuccess = () => res(q.result); q.onerror = () => res([]) })
    const cutoff = Date.now() - KEEP_MS
    keys.forEach((k, i) => { if (i < keys.length - KEEP || +String(k).split('|')[1] < cutoff) os.delete(k) })
  } catch { /* quota or private mode */ }
}

async function history(id: string): Promise<{ lm: number; blob: Blob }[]> {
  const d = await db()
  if (!d) return []
  return new Promise((res) => {
    try {
      const os = d.transaction('frames').objectStore('frames')
      const out: { lm: number; blob: Blob }[] = []
      const c = os.openCursor(range(id))
      c.onsuccess = () => {
        const cur = c.result
        if (!cur) return res(out)
        out.push({ lm: +String(cur.key).split('|')[1], blob: cur.value as Blob })
        cur.continue()
      }
      c.onerror = () => res(out)
    } catch {
      res([])
    }
  })
}

async function latestStored(id: string) {
  const h = await history(id)
  return h[h.length - 1]
}

// ── Polling ──
function decode(b64: string) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: 'image/jpeg' })
}

async function poll(ids: string[]) {
  if (!ids.length) return
  emit({ busy: true })
  const frames = new Map(snap.frames)
  for (let i = 0; i < ids.length; i += BATCH) {
    const part = ids.slice(i, i + BATCH)
    const q = part.map((id) => { const f = frames.get(id); return f && !f.error ? `${id}:${f.lm}` : id }).join(',')
    try {
      const r = await fetch(`/api/frames?ids=${q}`)
      const j = (await r.json()) as { frames: { id: string; lm?: number; data?: string; error?: number }[] }
      const now = Date.now()
      for (const f of j.frames) {
        const prev = frames.get(f.id)
        if (f.data && f.lm) {
          const blob = decode(f.data)
          if (prev) setTimeout(() => URL.revokeObjectURL(prev.url), 5000)
          frames.set(f.id, { url: URL.createObjectURL(blob), lm: f.lm, checked: now })
          void store(f.id, f.lm, blob)
        } else if (prev) frames.set(f.id, { ...prev, checked: now, error: f.error != null && !prev.url })
        else if (f.error != null) frames.set(f.id, { url: '', lm: 0, checked: now, error: true })
      }
    } catch { /* offline: keep what we have */ }
  }
  emit({ frames, busy: false, lastAt: Date.now() })
}

function tick() {
  clearTimeout(timer)
  if (document.visibilityState === 'visible') void poll([...watched.keys()])
  const nextAt = Date.now() + PERIOD
  emit({ nextAt })
  timer = window.setTimeout(tick, PERIOD)
}

/** Fetch newly watched cameras right away (debounced), without moving the minute rhythm for the rest. */
function fetchNew() {
  clearTimeout(kick)
  kick = window.setTimeout(async () => {
    const fresh = [...watched.keys()].filter((id) => !snap.frames.has(id))
    // Paint the last stored picture first, so cards never start empty after a reload.
    const frames = new Map(snap.frames)
    for (const id of fresh) {
      const s = await latestStored(id)
      if (s && !frames.has(id)) frames.set(id, { url: URL.createObjectURL(s.blob), lm: s.lm, checked: 0 })
    }
    if (fresh.length) emit({ frames })
    await poll(fresh)
  }, 250)
}

document.addEventListener('visibilitychange', () => {
  // Back on the tab after a while: refresh now rather than showing old pictures until the next tick.
  if (document.visibilityState === 'visible' && Date.now() - snap.lastAt > PERIOD) tick()
})

export function watch(all: string[]) {
  const ids = all.filter((id) => !isDirect(id)) // Edmonton video and Banff pictures don't go through the picture proxy
  ids.forEach((id) => watched.set(id, (watched.get(id) ?? 0) + 1))
  if (!timer) timer = window.setTimeout(tick, PERIOD)
  fetchNew()
  return () => ids.forEach((id) => {
    const n = (watched.get(id) ?? 1) - 1
    if (n <= 0) watched.delete(id)
    else watched.set(id, n)
  })
}

export const refreshNow = () => tick()

const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l))
export const useFrames = () => useSyncExternalStore(subscribe, () => snap)
export function useFrame(id: string | undefined) {
  const s = useFrames()
  return id ? s.frames.get(id) : undefined
}
export function useWatch(ids: string[]) {
  const key = ids.join(',')
  useEffect(() => (key ? watch(key.split(',')) : undefined), [key])
}
