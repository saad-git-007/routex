import { MotionConfig } from 'motion/react'
import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

// Safari ignores user-scalable=no, so stop its page-zoom gestures here. Pinches on the map and on a full-screen
// picture are handled by their own touch code and keep working.
for (const g of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(g, (e) => e.preventDefault(), { passive: false })
document.addEventListener('touchmove', (e) => { if ((e as TouchEvent & { scale?: number }).scale !== undefined && (e as TouchEvent & { scale: number }).scale !== 1 && !(e.target as Element).closest?.('.leaflet-container, .zv-stage')) e.preventDefault() }, { passive: false })

// If something breaks while drawing, say so and offer a reload instead of leaving a blank page.
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="crash" role="alert">
        <h1>Something went wrong</h1>
        <p>RouteX hit an unexpected problem. Your trip and lists are saved in this browser.</p>
        <button className="btn-accent" onClick={() => location.reload()}>Reload</button>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(<StrictMode><Boundary><MotionConfig reducedMotion="user"><App /></MotionConfig></Boundary></StrictMode>)
