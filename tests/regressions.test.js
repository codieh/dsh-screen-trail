import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, makeFrame } from './harness.js'

test('one JPEG can be used by observations from different pages', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  const original = h.state().observations[0]
  await h.frame(0, { context: { ...original.context, title: 'B', url: 'https://test/B' } })
  assert.equal(h.state().observations.length, 2); assert.equal(h.state().imageCount, 1)
  await h.advance(299500)
  assert.equal(h.requests[0].messages[0].content.filter((item) => item.type === 'image').length, 1)
})

test('capacity holds capture only, then automatically resumes after analysis', async (t) => {
  const h = await createHost({ hold: true, config: { retention: 6, analysisWindowSec: 30 } }); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  for (let i = 1; i < h.state().pendingCapacity; i += 1) await h.frame(i % 2 ? 255 : 0, { elapsed: 1 })
  assert.equal(h.state().running, true); assert.equal(h.state().capturePaused, true); assert.equal(h.state().analysisEnabled, true)
  await h.advance(30000 - (h.state().pendingCapacity - 1)); assert.equal(h.state().analyzing, true)
  h.release(); await h.settle()
  assert.equal(h.state().capturePaused, false); assert.equal(h.state().captureSource, 'ready')
  assert.equal(h.state().lastError, null)
})

test('retired capture timing is migrated explicitly to the simplified defaults', async (t) => {
  const h = await createHost({ config: { sampleIntervalSec: 2, eventsEnabled: true, analysisIntervalSec: 10 } }); t.after(h.dispose)
  assert.equal(h.state().captureFps, 2); assert.equal(h.state().analysisWindowSec, 300)
  assert.ok(h.logs.some((line) => line.includes('config.migrated')))
})

test('partial and repeated image references no longer reject an entire batch', async (t) => {
  for (const [reply, count] of [
    [{ activities: [] }, 0],
    [{ activities: [{ task: 0, images: [1, 1, 99], goal: '修改项目代码', activity: '修改', summary: '修改代码' }] }, 1],
    [{ activities: [{ task: 99, images: [1], goal: '修改项目代码', activity: '修改', summary: '修改代码' }] }, 0],
  ]) {
    const h = await createHost({ reply }); t.after(h.dispose)
    await h.trail.manualCapture(); await h.settle()
    assert.equal(h.state().records.length, count); assert.equal(h.state().observations.length, count)
    if (count) assert.equal(h.state().observations[0].analysisStatus, 'complete')
    assert.equal(h.state().lastError, null)
  }
})

test('manual pause cancels timers and subsequent native frames cannot enter the queue', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle(); h.trail.pause()
  const count = h.state().observations.length
  await h.trail.enqueue(makeFrame(255, { title: 'Later' }, 1700000030000)); await h.advance(90000)
  assert.equal(h.state().observations.length, count); assert.equal(h.requests.length, 0)
})

test('delete during analysis cannot recreate a deleted activity from a late update', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const id = h.state().records[0].id
  let release
  h.ctx.llm.resolveModelInfo = () => new Promise((resolve) => { release = resolve })
  h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  await h.trail.remove(id); release({ inputModalities: ['image'] }); await h.settle()
  assert.ok(!h.state().records.some((item) => item.id === id))
})

test('image cleanup cannot race a newly arriving native frame and delete its JPEG', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  const original = h.trail.io.readdir
  let release; let blocked = true
  const gate = new Promise((resolve) => { release = resolve })
  h.trail.io.readdir = async (directory) => {
    if (directory === h.trail.shots && blocked) { blocked = false; await gate }
    return original(directory)
  }
  const cleanup = h.trail.collectImages(); await h.settle()
  await h.frame(255); release(); await cleanup; await h.settle()
  const latest = h.state().observations[0]
  assert.equal(h.state().observations.length, 2)
  assert.ok((await h.trail.image(latest.id)).includes(Buffer.from('jpeg 255')))
})
