import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost } from './harness.js'

const history = () => ({ version: 4, records: [], activities: Array.from({ length: 14 }, (_, index) => {
  const frame = { id: `past-frame-${index}`, imageId: `past-image-${index}`, at: 1699999900000 + index * 1000,
    lastSeenAt: 1699999900000 + index * 1000, context: { app: 'Editor', title: `Project ${index}` } }
  return { id: `activity-past-${index}`, at: frame.at, lastSeenAt: frame.lastSeenAt, imageId: frame.imageId,
    context: frame.context, evidence: [frame], analysis: { activity: `项目${index}`, summary: `项目${index}的当前已保存结果。` } }
}) })

test('current output records are not resent as a database snapshot', async (t) => {
  const stored = history()
  const h = await createHost({ history: stored }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const request = h.requests[0]
  assert.doesNotMatch(request.messages.at(-1).content[0].text, /Saved activities state|Recent activities|activity-past-/)
  assert.equal('saved' in request, false)
  assert.equal(h.state().records.length, 14)
})

test('stable IDs still update an older event when the saved-state ordering changes', async (t) => {
  const h = await createHost({ history: history(), reply: ({ observations }) => ({ activities: [{
    task: 'activity-past-0', images: observations.map((item) => item.number),
    activity: '继续项目0', summary: '继续处理项目0的工作。',
  }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  h.trail.activities.reverse()
  h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 14)
  assert.equal(h.state().records.find((item) => item.id === 'activity-past-0').analysis.activity, '继续项目0')
  assert.equal(h.state().records.find((item) => item.id === 'activity-past-13').analysis.activity, '项目13')
  assert.equal(h.state().lastAnalysis.decisions[0].activityId, 'activity-past-0')
})

test('conversation history is supplied by the host, not copied into each new batch by the plugin', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.setScreen(0, { app: 'Editor', title: 'historical-context-marker' })
  await h.trail.manualCapture(); await h.settle()
  h.setScreen(255, { app: 'Editor', title: 'new-observation-marker' })
  await h.trail.manualCapture(); await h.settle()
  const request = h.requests[1]
  assert.equal(request.messages.length, 3)
  assert.ok(request.messages[0].content[0].text.includes('historical-context-marker'))
  const current = request.messages.at(-1).content[0].text
  assert.equal(current.includes('historical-context-marker'), false)
  assert.ok(current.includes('new-observation-marker'))
  assert.equal(h.requests[0].sessionId, h.requests[1].sessionId)
})

test('host-prepared compacted history does not break event addressing or invoke a plugin summarizer', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.presetDefinitions.get('standard').compaction.compactIfNeeded = () => { throw new Error('the plugin must not manage compaction') }
  await h.trail.manualCapture(); await h.settle(); const id = h.state().records[0].id
  const stream = h.ctx.llm.stream
  h.ctx.llm.stream = async function* (request) {
    const current = request.messages.at(-1)
    yield* stream({ ...request, messages: [{ role: 'user', content: [{ type: 'text', text: 'Harness 已压缩的会话历史。' }] }, current] })
  }
  h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().records[0].id, id)
  assert.equal(h.requests[1].messages[0].content[0].text, 'Harness 已压缩的会话历史。')
  assert.equal(h.state().lastAnalysis.contextOwner, 'harness')
  assert.equal(h.state().lastAnalysis.compactionAvailable, true)
  assert.equal(h.requests.length, 2)
})

test('a host without an active compaction service fails instead of submitting unbounded history', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  delete h.presetDefinitions.get('standard').compaction
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastAnalysis.contextOwner, 'harness')
  assert.equal(h.state().lastAnalysis.compactionAvailable, false)
  assert.equal(h.state().lastAnalysis.errorCode, 'ANALYSIS_COMPACTION_MISSING')
  assert.equal(h.requests.length, 0)
  assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('existing event descriptions can be corrected from conversation context without new images', async (t) => {
  const h = await createHost({ history: history(), reply: { activities: [{
    task: 'activity-past-0', images: [], cover: 0, activity: '查看项目0', summary: '仅能确认页面显示，不能确认已完成。',
  }] } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const item = h.state().records.find((record) => record.id === 'activity-past-0')
  assert.equal(item.analysis.summary, '仅能确认页面显示，不能确认已完成。')
  assert.equal(item.imageId, 'past-image-0'); assert.equal(item.evidence.length, 1)
  assert.equal(h.state().records.length, 14); assert.equal(h.state().observations.length, 0)
})

test('an event need not invent a goal, and supplied details/tags are not silently trimmed', async (t) => {
  const h = await createHost({ reply: { activities: [{ task: null, images: [1], cover: 1,
    activity: '出现连接错误', summary: '界面显示连接失败，原因未确定。',
    details: ['a', 'b', 'c', 'd'], tags: ['1', '2', '3', '4', '5', '6'],
  }] } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const analysis = h.state().records[0].analysis
  assert.equal('goal' in analysis, false)
  assert.equal(analysis.details.length, 4); assert.equal(analysis.tags.length, 6)
})

test('old temporary task numbers and missing output IDs are protocol errors, not model decisions to discard', async (t) => {
  for (const task of [1, 99, 'activity-removed']) {
    const h = await createHost({ history: history(), reply: { activities: [{
      task, images: [1], activity: '查看项目', summary: '查看当前项目。',
    }] } }); t.after(h.dispose)
    await h.trail.manualCapture(); await h.settle()
    assert.equal(h.state().records.length, 14)
    assert.equal(h.state().observations[0].analysisStatus, 'failed')
    assert.match(h.state().lastError, /saved activity ID/)
    assert.equal(h.state().lastAnalysis.outcome, 'failed')
  }
})

test('new conversations do not receive an extra output-state snapshot', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const first = h.state().analysisSessionId
  const eventId = h.state().records[0].id
  await h.advance(8 * 60 * 60 * 1000); h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.notEqual(h.state().analysisSessionId, first)
  assert.equal(h.requests[1].messages.length, 1)
  assert.ok(!h.requests[1].messages[0].content[0].text.includes(eventId))
  assert.equal(h.state().records.length, 1)
})
