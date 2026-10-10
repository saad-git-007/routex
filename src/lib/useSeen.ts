import { useEffect, useRef, useState } from 'react'

// Ids that arrived after the first render: a new incident gets a one-off cue, nothing pulses on re-render.
export function useNewIds(ids: string[]) {
  const seen = useRef<Set<string> | null>(null)
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const key = ids.join(',')
  useEffect(() => {
    if (!seen.current) { seen.current = new Set(ids); return }
    const add = ids.filter((id) => !seen.current!.has(id))
    add.forEach((id) => seen.current!.add(id))
    if (add.length) setFresh(new Set(add))
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return fresh
}

// A counter that goes up each time the value changes after mount, to key a one-shot "bump".
export function useBump(v: unknown) {
  const prev = useRef(v)
  const [n, setN] = useState(0)
  useEffect(() => { if (prev.current !== v) { prev.current = v; setN((x) => x + 1) } }, [v])
  return n
}
