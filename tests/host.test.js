import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, root } from './harness.js'

test('a fresh session collects first and waits five minutes before analysing', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  assert.equal(h.state().sampleIntervalSec, 5); assert.equal(h.state().analysisWindowSec, 300)
  assert.equal(h.state().observations.length, 1); assert.equal(h.state().records.length, 0); assert.equal(h.requests.length, 0)
  await h.advance(299999); assert.equal(h.requests.length, 0)
  await h.advance(1); assert.equal(h.requests.length, 1); assert.equal(h.state().records.length, 1)
  assert.equal(h.commands.length, 0)
})

test('sixty changed frames become at most six model images and one activity', async (t) => {
  const h = await createHost({ config: { analysisWindowSec: 30 } }); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  for (let i = 1; i < 60; i += 1) await h.frame(i % 2 ? 255 : 0)
  assert.equal(h.state().observations.length, 60)
  const first = h.state().observations.at(-1).id; const last = h.state().observations[0].id
  await h.advance(500)
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].observations.length, 6)
  assert.equal(h.state().lastAnalysis.selectedIds[0], first); assert.equal(h.state().lastAnalysis.selectedIds.at(-1), last)
  assert.ok(h.requests[0].messages[0].content.filter((item) => item.type === 'image').length <= 6)
  assert.equal(h.state().records.length, 1); assert.equal(h.state().records[0].evidence.length, 6)
  assert.equal(h.state().unfinishedCount, 0)
})

test('the next batch can update one stable activity instead of adding cards', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.advance(300000)
  const original = h.state().records[0].id
  await h.frame(255); await h.advance(300000)
  assert.equal(h.requests.length, 2); assert.equal(h.state().records.length, 1)
  assert.equal(h.state().records[0].id, original)
  assert.equal(h.state().records[0].evidence.length, 2)
  assert.match(h.state().records[0].analysis.summary, /第 2 次/)
})

test('all frames may be explicitly ignored with no activity and no fabricated summary', async (t) => {
  const h = await createHost({ reply: { activities: [] } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 0); assert.equal(h.state().observations.length, 0)
  assert.equal(h.state().imageCount, 0)
  assert.equal(h.state().ignored, 1); assert.equal(h.state().lastError, null)
})

test('several distinct activities may be created in one batch', async (t) => {
  const h = await createHost({ reply: ({ observations }) => ({ activities: observations.map((item, index) => ({ task: 0, images: [item.number], goal: `完成具体任务${index}`, activity: `任务${index}`, summary: '屏幕可见的独立任务。' })) }) }); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.frame(255); await h.advance(299500)
  assert.equal(h.state().records.length, 2)
})

test('identical frames and idle presence extend time without new files or calls', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.advance(300000)
  await h.frame(0); await h.presence(); await h.advance(90000)
  assert.equal(h.state().observations.length, 1); assert.equal(h.state().imageCount, 1); assert.equal(h.requests.length, 1)
  assert.ok(h.state().records[0].lastSeenAt > h.state().records[0].at)
})

test('A to B to A preserves three occurrences and reuses two image resources', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  const a = h.state().observations[0].context
  await h.frame(255, { context: { ...a, title: 'B', url: 'https://test/B' } })
  await h.frame(0, { context: a })
  assert.equal(h.state().observations.length, 3); assert.equal(h.state().imageCount, 2)
  assert.equal(h.state().observations[0].imageReused, true)
  await h.advance(299000)
  assert.deepEqual(h.requests[0].observations.map((item) => item.context.title), ['A', 'B', 'A'])
})

test('recorder page is excluded before persistence, but normal Harness chat is captured', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const context = { app: 'DeepSeek Harness', bundleId: 'test.harness', pid: 10, windowId: 5, title: 'Harness [dsh-screen-trail]' }
  h.setScreen(0, context); await h.trail.start(); await h.settle(); await h.advance(300000)
  assert.equal(h.state().observations.length, 0); assert.equal(h.requests.length, 0); assert.equal(h.state().selfExcluded, true)
  assert.equal([...h.files.keys()].filter((name) => name.endsWith('.jpg')).length, 0)
  await h.frame(0, { context: { ...context, title: 'Normal chat' } }); await h.advance(300000)
  assert.equal(h.state().observations.length, 1); assert.equal(h.state().records.length, 1)
  assert.equal(h.state().selfExcluded, false)
})

test('slow model processing never blocks the native frame consumer', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.advance(300000)
  assert.equal(h.state().analyzing, true)
  await h.frame(255)
  assert.equal(h.state().observations.length, 2); assert.equal(h.state().queueLength, 1)
  h.release(); await h.settle(); await h.advance(300000)
  assert.equal(h.state().analyses, 2)
})

test('clear cancels an in-flight result and removes owned images and diagnostics', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); await h.trail.clear()
  h.release(); await h.settle(); await h.advance(90000)
  assert.equal(h.state().records.length, 0); assert.equal(h.state().observations.length, 0); assert.equal(h.state().running, false)
  assert.equal([...h.files.keys()].filter((name) => name.endsWith('.jpg')).length, 0)
  assert.equal(h.trail.store.eventCount(), 0)
})

test('activity evidence remains readable after its raw observation is pruned', async (t) => {
  const h = await createHost({ config: { retention: 6 } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const first = h.state().observations[0]
  for (let i = 1; i < 8; i += 1) { h.setScreen(i * 30); await h.trail.manualCapture(); await h.settle() }
  assert.equal(h.state().observations.length, 6)
  assert.ok(h.files.has(`${root}/shots/${first.imageId}.jpg`))
  assert.ok((await h.trail.image(first.id)).length > 0)
  await assert.rejects(h.trail.remove('../../outside'), /bad record id/)
})

test('corrupt history is reported and never replaced with empty history', async () => {
  const h = await createHost({ corrupt: true })
  assert.equal(h.state().ready, false); await assert.rejects(h.trail.manualCapture(), /initialize/)
  await h.dispose(); assert.equal(h.files.get(`${root}/state.json`), '{broken json')
})

test('legacy history is discarded once while user preferences survive and old chats are not reused', async (t) => {
  const h = await createHost({ legacyHistory: { version: 1, analysisSessionId: 'old-session', sampleIntervalSec: 15,
    modelSettings: { provider: '', model: '', reasoningEffort: null },
    records: [{ id: 'legacy-frame', at: 1699999990000, analysis: { activity: '阅读', summary: '旧版记录。' } }] } }); t.after(h.dispose)
  assert.equal(h.state().records.length, 0); assert.equal(h.state().observations.length, 0)
  assert.equal(h.state().sampleIntervalSec, 15); assert.equal(h.state().analysisSessionId, null)
  assert.equal(h.files.has(`${root}/shots/legacy-frame.jpg`), false)
  await h.trail.manualCapture(); await h.settle()
  assert.doesNotMatch(h.requests[0].messages[0].content[0].text, /旧版记录/)
  assert.equal(h.files.has(`${root}/state.json`), false)
  assert.equal(h.trail.store.setting('legacyResetPending'), false)
})

test('native permission failure rejects startup without a polling fallback', async (t) => {
  const h = await createHost({ captureError: 'Screen Recording permission is required' }); t.after(h.dispose)
  await assert.rejects(h.trail.start(), /Screen Recording/)
  assert.equal(h.state().running, false); assert.equal(h.state().captureSource, 'failed'); assert.equal(h.state().permission, 'denied')
})

test('disk failure rejects startup before native capture or model execution', async (t) => {
  const h = await createHost({ writeError: true }); t.after(async () => { h.release(); await assert.rejects(h.trail.dispose(), /disk write failed/) })
  await assert.rejects(h.trail.start(), /disk write failed/)
  assert.equal(h.state().running, false); assert.equal(h.requests.length, 0); assert.equal(h.state().captures, 0)
})
