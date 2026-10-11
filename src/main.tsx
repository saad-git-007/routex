import { MotionConfig } from 'motion/react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Safari ignores user-scalable=no, so stop its page-zoom gestures here. Pinches on the map and on a full-screen
// picture are handled by their own touch code and keep working.
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault(), { passive: false })
document.addEventListener('touchmove', (e) => { if ((e as TouchEvent & { scale?: number }).scale !== undefined && (e as TouchEvent & { scale: number }).scale !== 1 && !(e.target as Element).closest?.('.leaflet-container, .zv-stage')) e.preventDefault() }, { passive: false })

createRoot(document.getElementById('root')!).render(<StrictMode><MotionConfig reducedMotion="user"><App /></MotionConfig></StrictMode>)
