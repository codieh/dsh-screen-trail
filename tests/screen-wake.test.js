import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost } from './harness.js'

test('screen sleep leaves recording intent, queued data and current analysis intact', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.advance(300000)
  const id = h.state().observations[0].id
  h.source.lifecycle('waiting')
  assert.equal(h.state().running, true); assert.equal(h.state().analysisEnabled, true)
  assert.equal(h.state().captureSource, 'waiting'); assert.equal(h.state().lastError, null)
  assert.equal(h.state().analyzing, true); assert.equal(h.state().observations[0].id, id)
  h.release(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().captureSource, 'waiting')
})

test('identical pixels after screen wake are a new observation rather than idle time across sleep', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  const original = { ...h.state().observations[0] }
  h.source.lifecycle('waiting'); await h.advance(300000)
  assert.equal(h.state().observations[0].lastSeenAt, original.lastSeenAt)
  h.source.lifecycle('ready'); await h.frame(0)
  assert.equal(h.state().observations.length, 2)
  assert.equal(h.state().observations[0].imageId, original.imageId)
  assert.notEqual(h.state().observations[0].id, original.id)
  assert.equal(h.state().observations[1].lastSeenAt, original.lastSeenAt)
})
