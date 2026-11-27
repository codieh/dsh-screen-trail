import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost } from './harness.js'

const connectionError = () => Object.assign(new Error('application connection interrupted'), {
  domain: 'com.apple.ScreenCaptureKit.SCStreamErrorDomain', code: -3805,
})

test('native interruption rebuilds capture while preserving the running analysis and user intent', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.start(); await h.advance(300000)
  const controller = h.trail.controller
  h.source.fail(connectionError())
  assert.equal(h.state().running, true); assert.equal(h.state().analysisEnabled, true)
  assert.equal(controller.signal.aborted, false)
  await h.advance(999); assert.equal(h.source.state, 'failed')
  await h.advance(1); assert.equal(h.source.state, 'ready')
  assert.equal(h.trail.captureFailures, 0); assert.equal(h.requests.length, 1)
  h.release(); await h.settle(); assert.equal(h.state().records.length, 1)
})

test('repeated capture failures back off without giving up and permission restoration is detected', async (t) => {
  const h = await createHost({ captureError: 'Screen Recording permission required' }); t.after(h.dispose)
  await assert.rejects(h.trail.start(), /permission/)
  await h.advance(1000); await h.advance(2000); await h.advance(4000)
  assert.equal(h.state().running, true)
  assert.deepEqual(h.logs.map((line) => JSON.parse(line.slice('[screen-trail] '.length)))
    .filter((item) => item.event === 'capture.retry_scheduled').map((item) => item.delayMs), [1000, 2000, 4000, 8000])
  h.setCaptureError(null); await h.advance(8000)
  assert.equal(h.source.state, 'ready'); assert.equal(h.trail.captureFailures, 0)
})

test('pause, clear and disposal cancel pending automatic capture recovery', async () => {
  for (const action of ['pause', 'clear', 'dispose']) {
    const h = await createHost(); await h.trail.start(); await h.settle()
    h.source.fail(connectionError())
    if (action === 'pause') h.trail.pause()
    else await h.trail[action]()
    await h.advance(120000)
    assert.equal(h.trail.running, false); assert.notEqual(h.source.state, 'ready')
    if (action !== 'dispose') await h.dispose()
  }
})

test('native user-stopped sharing is not automatically restarted', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  h.source.fail(Object.assign(new Error('user stopped sharing'), { domain: 'com.apple.ScreenCaptureKit.SCStreamErrorDomain', code: -3817 }))
  await h.advance(120000)
  assert.equal(h.state().running, false); assert.equal(h.trail.captureRetryTimer, null)
})

test('duplicate native errors schedule only one rebuild and recovery clears its own error', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  h.source.fail(connectionError()); h.source.fail(connectionError())
  assert.equal(h.trail.captureFailures, 1)
  await h.advance(1000)
  assert.equal(h.source.state, 'ready'); assert.equal(h.state().lastError, null)
})

test('pausing during recovery persistence cannot restart capture after the write completes', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  let release
  h.trail.writes = new Promise((resolve) => { release = resolve })
  h.source.fail(connectionError()); await h.advance(1000)
  h.trail.pause(); release(); await h.settle()
  assert.equal(h.trail.running, false); assert.notEqual(h.source.state, 'ready')
})

test('temporary storage failure preserves intent and recovers before starting native capture', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const save = h.trail.store.save.bind(h.trail.store); let healthy = false
  h.trail.store.save = (...args) => { if (!healthy) throw new Error('disk unavailable'); return save(...args) }
  await assert.rejects(h.trail.start(), /disk unavailable/)
  assert.equal(h.state().captures, 0); assert.equal(h.trail.running, true)
  healthy = true; await h.advance(1000)
  assert.equal(h.source.state, 'ready'); assert.equal(h.state().lastError, null)
})

test('model transport failure retries the original evidence without another capture or mixing new work', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const stream = h.ctx.llm.stream; let attempts = 0
  h.ctx.llm.stream = async function* (request) {
    if (++attempts === 1) throw Object.assign(new Error('transport failed'), { code: 'TRANSPORT' })
    yield* stream(request)
  }
  await h.trail.start(); await h.advance(300000)
  const ids = [...h.trail.analysisRetry.ids]; const captures = h.state().captures
  await h.frame(255)
  assert.equal(h.state().queueLength, 1); assert.equal(h.source.state, 'ready')
  await h.advance(500)
  assert.equal(attempts, 2); assert.equal(h.state().captures, captures + 1)
  assert.equal(h.state().records.length, 1); assert.equal(h.trail.analysisRetry, null)
  assert.deepEqual(h.state().records[0].evidence.map((item) => item.id), ids)
  assert.equal(h.state().queueLength, 1)
})

test('analysis timeout retries without restarting native capture', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().observations[0].id
  await h.advance(90000); assert.equal(h.state().lastAnalysis.errorCode, 'ANALYSIS_TIMEOUT')
  const captures = h.state().captures; h.release(); await h.advance(1000)
  assert.equal(h.state().records.length, 1); assert.equal(h.state().captures, captures)
  assert.equal(h.state().records[0].evidence[0].id, id)
})

test('continuous analysis failures back off, retain evidence and respect pause', async (t) => {
  const h = await createHost({ reply: '{' }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().observations[0].id
  await h.advance(1000); await h.advance(2000)
  assert.equal(h.requests.length, 3); assert.equal(h.trail.analysisRetry.attempt, 3)
  assert.equal(h.state().observations[0].id, id)
  h.trail.pause(); await h.advance(120000); assert.equal(h.requests.length, 3)
})

test('automatic analysis retry survives restart without storing a startup recording intent', async (t) => {
  const first = await createHost({ reply: '{' })
  await first.trail.manualCapture(); await first.settle(); const ids = first.trail.analysisRetry.ids
  await first.dispose()
  const h = await createHost({ history: first.snapshot(), conversations: first.conversations }); t.after(h.dispose)
  assert.equal(h.state().running, false); assert.equal(h.requests.length, 0)
  assert.deepEqual(h.trail.analysisRetry.ids, ids)
  await h.trail.start(); await h.advance(1000)
  assert.equal(h.state().records.length, 1); assert.equal(h.trail.analysisRetry, null)
})

test('committed events are not recreated when the final chat flush fails', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const flush = h.ctx.sessions.flush
  h.ctx.sessions.flush = async () => { throw new Error('chat flush failed') }
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.trail.analysisRetry, null)
  const calls = h.requests.length; h.ctx.sessions.flush = flush
  await h.advance(120000)
  assert.equal(h.requests.length, calls); assert.equal(h.state().records.length, 1)
})

test('database commit status prevents replay even when a later diagnostic error replaces the receipt error', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.trail.saveDiagnostic = async () => { throw new Error('diagnostic write failed') }
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.trail.analysisRetry, null)
  await h.advance(120000)
  assert.equal(h.requests.length, 1); assert.equal(h.state().records.length, 1)
})

test('clear removes persisted retry metadata as well as evidence', async (t) => {
  const h = await createHost({ reply: '{' }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.ok(h.snapshot().analysisRetry)
  await h.trail.clear(); await h.advance(120000)
  assert.equal(h.snapshot().analysisRetry, null); assert.equal(h.state().observations.length, 0)
  assert.equal(h.requests.length, 1)
})

test('failed analysis evidence counts toward backpressure and resumes capture after recovery', async (t) => {
  let healthy = false
  const h = await createHost({ config: { retention: 6, analysisWindowSec: 15, sampleIntervalSec: 30 },
    reply: ({ observations }) => healthy ? { activities: [{ images: observations.map((item) => item.number), activity: '恢复', summary: '恢复成功' }] } : '{' })
  t.after(h.dispose)
  await h.trail.start(); await h.advance(15000)
  for (let i = 1; i < 6; i++) await h.frame(i * 40)
  assert.equal(h.state().capturePaused, true); assert.equal(h.state().unfinishedCount, 6)
  healthy = true; await h.advance(30000)
  assert.equal(h.state().capturePaused, false); assert.equal(h.source.state, 'ready')
})
