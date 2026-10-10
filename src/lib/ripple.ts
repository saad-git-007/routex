// Press ripple from the touch point. Technique ported from Magic UI ripple-button (MIT © Magic UI, magicuidesign/magicui).
// Adds a short-lived span straight to the DOM, so pressing never re-renders React.
export function ripple(e: React.PointerEvent<HTMLElement>) {
  if (e.button !== 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) return
  const el = e.currentTarget, r = el.getBoundingClientRect(), s = Math.max(r.width, r.height)
  const sp = document.createElement('span')
  sp.className = 'rpl'
  sp.style.cssText = `width:${s}px;height:${s}px;left:${e.clientX - r.left - s / 2}px;top:${e.clientY - r.top - s / 2}px`
  el.appendChild(sp)
  sp.addEventListener('animationend', () => sp.remove(), { once: true })
}
