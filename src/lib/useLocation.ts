import { useEffect, useState } from 'react'

// Live position from the browser: GPS on phones, Wi-Fi/cell positioning on iPads, network location on computers.
// The browser picks the best source; we only ask for high accuracy.
export type Fix = { lat: number; lon: number; acc: number; heading: number | null; speed: number | null; t: number }

const MESSAGE: Record<number, string> = {
  1: 'Location is blocked for this site. Allow it in your browser settings.',
  2: "Can't find your location right now.",
  3: 'Still looking for your location…',
}

export function useLiveLocation(on: boolean) {
  const [fix, setFix] = useState<Fix | null>(null)
  const [error, setError] = useState<{ code: number; text: string } | null>(null)
  useEffect(() => {
    if (!on) { setFix(null); setError(null); return }
    if (!('geolocation' in navigator)) { setError({ code: 2, text: "This browser can't share its location." }); return }
    const id = navigator.geolocation.watchPosition(
      (p) => {
        setError(null)
        setFix({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, heading: p.coords.heading, speed: p.coords.speed, t: p.timestamp })
      },
      (e) => setError({ code: e.code, text: MESSAGE[e.code] ?? e.message }),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [on])
  return { fix, error }
}
