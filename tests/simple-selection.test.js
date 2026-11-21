import assert from 'node:assert/strict'
import test from 'node:test'
import { SimpleSelector, representatives } from '../frames.js'
import { makeFrame } from './harness.js'

test('simple selector filters duplicate images but preserves context boundaries and manual evidence', () => {
  const selector = new SimpleSelector(); const frame = makeFrame(0, {}, 0)
  assert.equal(selector.consider(frame.thumbnail, frame.imageId, 'A').reason, 'first')
  assert.equal(selector.consider(frame.thumbnail, frame.imageId, 'A').kind, 'extend')
  assert.equal(selector.consider(frame.thumbnail, frame.imageId, 'B').reason, 'context')
  assert.equal(selector.consider(frame.thumbnail, frame.imageId, 'A').reason, 'context')
  assert.equal(selector.consider(frame.thumbnail, frame.imageId, 'A', true).reason, 'manual')
})
test('representatives keep first and last, prioritise context, and never reorder the input', () => {
  const items = Array.from({ length: 10 }, (_, index) => ({ id: `frame-${index}`, at: index, score: index, reason: index === 2 ? 'context' : 'change' }))
  const selected = representatives(items)
  assert.equal(selected.length, 6); assert.equal(selected[0], items[0]); assert.equal(selected.at(-1), items.at(-1))
  assert.ok(selected.includes(items[2])); assert.deepEqual(items.map((item) => item.at), Array.from({ length: 10 }, (_, i) => i))
  assert.deepEqual(representatives(items.slice(0, 4)), items.slice(0, 4))
})
