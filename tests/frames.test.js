import assert from 'node:assert/strict'
import test from 'node:test'
import { frameDifference, SimpleSelector } from '../dist/frames.js'

function image(width = 32, height = 16) { return { width, height, pixels: new Uint8Array(width * height), rgb: new Uint8Array(width * height * 3) } }
test('the first frame has no comparison baseline', () => { assert.equal(frameDifference(image(), null), 1) })
test('identical frames have no visual difference', () => { assert.equal(frameDifference(image(), image()), 0) })
test('local contrast is retained even when most of the screen is unchanged', () => {
  const a = image(256, 144); const b = image(256, 144)
  for (let y = 0; y < 3; y += 1) for (let x = 0; x < 12; x += 1) b.pixels[y * 256 + x] = 255
  assert.ok(frameDifference(a, b) > 0.003)
})
test('RGB changes are detected even with identical grayscale samples', () => {
  const a = image(); const b = image(); b.rgb.fill(100)
  assert.equal(frameDifference(a, b), 1)
})
test('a display-size change creates a new comparison boundary', () => { assert.equal(frameDifference(image(), image(16, 32)), 1) })
test('single-pixel noise does not force a new observation', () => {
  const selector = new SimpleSelector(); const a = image(); const b = image(); b.pixels[0] = 255
  selector.consider(a, 'A', 'window'); assert.equal(selector.consider(b, 'B', 'window').kind, 'extend')
})
test('accumulated changes compare to the retained frame rather than the previous tiny change', () => {
  const selector = new SimpleSelector(); selector.consider(image(), 'start', 'window')
  let decision
  for (let count = 1; count <= 8; count += 1) { const next = image(); next.pixels.fill(255, 0, count); decision = selector.consider(next, `value-${count}`, 'window') }
  assert.equal(decision.kind, 'keep')
})
test('visual A to B to A remains three distinct occurrences', () => {
  const selector = new SimpleSelector(); const a = image(); const b = image(); b.pixels.fill(255)
  for (const [value, id] of [[a, 'A'], [b, 'B'], [a, 'A']]) assert.equal(selector.consider(value, id, 'window').kind, 'keep')
})
