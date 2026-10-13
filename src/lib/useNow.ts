import { useEffect, useState } from 'react'
export function useNow(every = 5000, visibleOnly = false) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const update = () => { if (!visibleOnly || document.visibilityState === 'visible') setNow(Date.now()) }
    const t = setInterval(update, every)
    if (visibleOnly) document.addEventListener('visibilitychange', update)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', update) }
  }, [every, visibleOnly])
  return now
}
