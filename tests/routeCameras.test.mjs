import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'

const compiled = await build({ entryPoints: ['src/lib/routeCameras.ts'], bundle: true, format: 'esm', write: false })
const { selectRouteCameras } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const camerasAt = (positions) => positions.map((along, i) => ({ id: `camera-${i}`, along, leg: i % 3 }))

test('keeps every camera for routes at or below the cap', () => {
  for (const count of [0, 1, 39, 40]) {
    const cameras = camerasAt(Array.from({ length: count }, (_, i) => i * 1000))
    assert.equal(selectRouteCameras(cameras), cameras)
  }
})

test('selects exactly 40 unique cameras in driving order, including both ends', () => {
  for (const count of [41, 201, 1000]) {
    const cameras = camerasAt(Array.from({ length: count }, (_, i) => i * 1000))
    const before = [...cameras]
    const selected = selectRouteCameras(cameras)
    assert.equal(selected.length, 40)
    assert.equal(new Set(selected.map((c) => c.id)).size, 40)
    assert.equal(selected[0], cameras[0])
    assert.equal(selected.at(-1), cameras.at(-1))
    assert.deepEqual(selected, [...selected].sort((a, b) => a.along - b.along))
    assert.deepEqual(cameras, before)
    assert(selected.every((c) => cameras.includes(c)))
  }
})

test('spreads selection by distance instead of letting a dense city dominate', () => {
  const city = Array.from({ length: 200 }, (_, i) => i * 10)
  const highway = Array.from({ length: 39 }, (_, i) => (i + 1) * 100000)
  const selected = selectRouteCameras(camerasAt([...city, ...highway]))
  assert.equal(selected.filter((c) => c.along < 100000).length, 1)
  assert.deepEqual(selected.slice(1).map((c) => c.along), highway)
})

test('covers evenly spaced cameras without large unnecessary gaps', () => {
  const selected = selectRouteCameras(camerasAt(Array.from({ length: 201 }, (_, i) => i * 1000)))
  const gaps = selected.slice(1).map((c, i) => c.along - selected[i].along)
  assert(Math.max(...gaps) <= 8000)
})

test('handles cameras at the same distance without duplicates or stalling', () => {
  const selected = selectRouteCameras(camerasAt(Array(100).fill(0)))
  assert.equal(selected.length, 40)
  assert.equal(new Set(selected.map((c) => c.id)).size, 40)
})
