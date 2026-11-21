import assert from 'node:assert/strict'
import test from 'node:test'
import { observationTimeline } from '../trail.js'
import { createHost } from './harness.js'

const editor = { app: 'Editor', bundleId: 'test.editor', pid: 1, windowId: 1, title: 'Project A' }
const pdf = { app: 'Browser', bundleId: 'test.browser', pid: 2, windowId: 2, title: '论文 PDF' }
const observation = (at, lastSeenAt, context = editor) => ({ at, lastSeenAt, context })

test('timeline compresses only overlapping or touching observations without mutating them', () => {
  const batch = [observation(2500, 4000), observation(1000, 2000), observation(2000, 3000)]
  const original = JSON.stringify(batch)
  const timeline = observationTimeline(batch)
  assert.deepEqual(timeline, [{ context: editor, seen: [[1000, 4000]] }])
  assert.equal(JSON.stringify(batch), original)
  timeline[0].context.title = 'Changed later'
  assert.equal(batch[0].context.title, 'Project A')
})

test('timeline preserves missing intervals and single samples instead of inventing dwell', () => {
  assert.deepEqual(observationTimeline([
    observation(1000, 1000), observation(1500, 1500), observation(86401000, 86402000),
  ]), [{ context: editor, seen: [[1000, 1000], [1500, 1500], [86401000, 86402000]] }])
  assert.deepEqual(observationTimeline([]), [])
})

test('timeline preserves A to B to A even when B has no selected screenshot', () => {
  const timeline = observationTimeline([
    observation(1000, 2000), observation(2500, 3000, pdf), observation(3500, 5000),
  ])
  assert.deepEqual(timeline.map((item) => item.context.title), ['Project A', '论文 PDF', 'Project A'])
  assert.deepEqual(timeline.map((item) => item.seen), [[[1000, 2000]], [[2500, 3000]], [[3500, 5000]]])
})

test('changing resource or native window keeps the recorded boundary', () => {
  const batch = [observation(1, 1, pdf), observation(2, 2, { ...pdf, title: 'Other PDF' }),
    observation(3, 3, { ...pdf, windowId: 3 }), observation(4, 4, { ...pdf, url: 'https://test/another' })]
  assert.equal(observationTimeline(batch).length, 4)
})

test('timeline does not hide title changes even when a URL stays the same', () => {
  const context = { ...pdf, url: 'https://test/document' }
  const timeline = observationTimeline([
    observation(1, 1, context), observation(2, 2, { ...context, title: 'Updated document title' }),
  ])
  assert.deepEqual(timeline.map((item) => item.context.title), ['论文 PDF', 'Updated document title'])
})

test('one static screenshot preserves its recorded two-minute visibility interval', () => {
  const timeline = observationTimeline([observation(1000, 121000, pdf)])
  assert.deepEqual(timeline, [{ context: pdf, seen: [[1000, 121000]] }])
  assert.equal('category' in timeline[0], false)
  assert.equal('score' in timeline[0], false)
})

test('request includes the entire metadata sequence without increasing uploaded images or model calls', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.setScreen(0, editor); await h.trail.start(); await h.settle()
  await h.frame(255, { context: { ...pdf, title: 'Unselected CodeTop page' } })
  await h.frame(0, { context: editor })
  const batch = [...h.state().observations].reverse()
  const selected = [batch[0], batch.at(-1)]
  await h.trail.analyze(batch, selected, new AbortController().signal)
  const request = h.requests[0]
  assert.deepEqual(request.timeline.map((item) => item.context.title), ['Project A', 'Unselected CodeTop page', 'Project A'])
  assert.deepEqual(request.observations.map((item) => item.context.title), ['Project A', 'Project A'])
  assert.equal(request.messages[0].content.filter((item) => item.type === 'image').length, 1)
  assert.equal(h.requests.length, 1)
  assert.match(request.messages[0].content[0].text, /metadata only/)
  assert.match(request.system, /Gaps are unobserved/)
  assert.match(request.system, /Visibility does not establish reading/)
  assert.match(request.system, /current output database/)
  assert.match(request.system, /not an eligibility threshold/)
})

test('full request and successful reply live in diagnostics, not polling state or ordinary logs', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.setScreen(0, { ...editor, title: 'Private window title for diagnostic test' })
  await h.trail.manualCapture(); await h.settle()
  const diagnostic = JSON.parse(h.files.get(h.state().lastAnalysis.diagnosticFile))
  assert.equal(diagnostic.input.system, h.requests[0].system)
  assert.equal(diagnostic.input.text, h.requests[0].messages[0].content[0].text)
  assert.equal(JSON.parse(diagnostic.reply).activities.length, 1)
  assert.equal('input' in h.state().lastAnalysis, false)
  assert.equal('reply' in h.state().lastAnalysis, false)
  assert.equal(h.logs.join('\n').includes('Private window title for diagnostic test'), false)
})

test('failed JSON keeps the same actual input and raw response for investigation', async (t) => {
  const h = await createHost({ reply: '{' }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const diagnostic = JSON.parse(h.files.get(h.state().lastAnalysis.diagnosticFile))
  assert.equal(diagnostic.outcome, 'failed')
  assert.equal(diagnostic.input.text, h.requests[0].messages[0].content[0].text)
  assert.equal(diagnostic.reply, '{')
})

test('captured timeline in diagnostics cannot drift while a response is pending', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const sent = h.requests[0].messages[0].content[0].text
  h.trail.records[0].lastSeenAt += 120000
  h.release(); await h.settle()
  const diagnostic = JSON.parse(h.files.get(h.state().lastAnalysis.diagnosticFile))
  assert.equal(diagnostic.input.text, sent)
  assert.notEqual(h.trail.records[0].lastSeenAt, h.requests[0].timeline[0].seen[0][1])
})

test('the program still accepts a useful short result chosen by the model without a duration gate', async (t) => {
  const h = await createHost({ reply: ({ observations }) => ({ activities: [{
    task: 0, goal: '定位接口连接失败', activity: '发现接口错误', summary: '界面显示接口连接失败。',
    images: observations.map((item) => item.number), cover: 1,
  }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.requests[0].timeline[0].seen[0][0], h.requests[0].timeline[0].seen[0][1])
  assert.equal(h.state().records.length, 1)
})

test('a static page needs no additional screenshots or input events to supply sustained visibility', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.setScreen(0, pdf); await h.trail.start(); await h.settle()
  await h.presence('idle', 120000); await h.advance(180000)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].observations.length, 1)
  const [start, end] = h.requests[0].timeline[0].seen[0]
  assert.equal(end - start, 120000)
})
