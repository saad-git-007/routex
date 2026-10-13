import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const compile = async (file) => {
  const result = await build({ entryPoints: [file], bundle: true, platform: 'node', format: 'esm', write: false })
  return `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`
}
const { cameraWindow } = await import(await compile('src/lib/cameraWindow.ts'))

test('preloads only three cameras ahead, including near the end of a route', () => {
  const cams = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}` }))
  assert.deepEqual(cameraWindow(cams, [2, 1, 2]), { visible: ['c1', 'c2'], preload: ['c3', 'c4', 'c5'] })
  assert.deepEqual(cameraWindow(cams, [38]), { visible: ['c38'], preload: ['c39'] })
  assert.deepEqual(cameraWindow(cams, [39]), { visible: ['c39'], preload: [] })
  assert.deepEqual(cameraWindow(cams, []), { visible: [], preload: [] })
})

test('frame requests warm ahead once, refresh only watched cameras and pause in hidden tabs', async () => {
  const original = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch, clearTimeout: globalThis.clearTimeout, now: Date.now }
  let now = 1000, nextTimer = 0
  const timers = new Map(), listeners = new Map(), calls = []
  globalThis.window = { setTimeout: (fn, ms) => { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id } }
  globalThis.clearTimeout = (id) => timers.delete(id)
  globalThis.document = { visibilityState: 'visible', addEventListener: (name, fn) => listeners.set(name, fn) }
  Date.now = () => now
  globalThis.fetch = async (url) => {
    const ids = new URL(url, 'https://test.local').searchParams.get('ids').split(',').map((pair) => pair.split(':')[0])
    calls.push(ids)
    return new Response(JSON.stringify({ frames: ids.map((id) => ({ id, error: 0 })) }))
  }
  const advance = async (ms) => {
    const end = now + ms
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at; timers.delete(next[0]); await next[1].fn()
      for (let i = 0; i < 12; i++) await Promise.resolve()
    }
    now = end
  }
  try {
    const { watch, preload, PERIOD } = await import(await compile('src/lib/frames.ts'))
    let stopWatch = watch(['c0']), stopPreload = preload(['c1', 'c2', 'c3'])
    await advance(300)
    assert.deepEqual(calls, [['c0', 'c1', 'c2', 'c3']])
    calls.length = 0
    await advance(PERIOD)
    assert.deepEqual(calls, [['c0']], 'the next three must not refresh on each minute tick')
    stopWatch(); stopPreload()
    stopWatch = watch(['c10']); stopPreload = preload(['c11', 'c12', 'c13'])
    calls.length = 0
    await advance(300)
    assert.deepEqual(calls, [['c10', 'c11', 'c12', 'c13']], 'jumping fetches the new window promptly')
    calls.length = 0
    globalThis.document.visibilityState = 'hidden'
    await advance(PERIOD)
    assert.deepEqual(calls, [], 'hidden tabs do not refresh')
    globalThis.document.visibilityState = 'visible'
    listeners.get('visibilitychange')()
    await advance(300)
    assert(calls.flat().includes('c10'), 'returning to the tab refreshes the visible camera')
    assert(!calls.flat().includes('c0'), 'previous windows stay unwatched')
    stopWatch(); stopPreload(); calls.length = 0
    await advance(PERIOD * 2)
    assert.deepEqual(calls, [], 'closing the view stops polling')
    const stopReturn = watch(['c0'])
    await advance(300)
    assert.deepEqual(calls, [['c0']], 'an old cached camera refreshes promptly when revisited')
    stopReturn()
  } finally {
    globalThis.window = original.window; globalThis.document = original.document; globalThis.fetch = original.fetch
    globalThis.clearTimeout = original.clearTimeout; Date.now = original.now
  }
})
