import { useEffect, useState } from 'react'

// Per-browser persistence. Every access is guarded: private windows and blocked storage just mean nothing is remembered.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`ct:${key}`)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`ct:${key}`, JSON.stringify(value))
  } catch { /* storage unavailable */ }
}
export function useStored<T>(key: string, fallback: T) {
  const [v, setV] = useState<T>(() => load(key, fallback))
  useEffect(() => save(key, v), [key, v])
  return [v, setV] as const
}
