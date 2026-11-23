import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost } from './harness.js'

test('model input uses selected observations and readable dates without removed metadata', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const editor = { app: 'Editor', title: 'Project A', bundleId: 'test.editor' }
  h.setScreen(0, editor); await h.trail.start(); await h.settle()
  await h.frame(255, { context: { app: 'Browser', title: 'Unselected page' } })
  await h.frame(0, { context: editor })
  const batch = [...h.state().observations].reverse()
  await h.trail.analyze(batch, [batch[0], batch.at(-1)], new AbortController().signal)
  const request = h.requests[0]; const text = request.messages.at(-1).content[0].text
  assert.deepEqual(request.observations.map((item) => item.context.title), ['Project A', 'Project A'])
  assert.equal(request.messages.at(-1).content.filter((item) => item.type === 'image').length, 1)
  assert.doesNotMatch(text, /Unselected page|Batch timeline|Saved activities state|Selection:|bundleId/)
  assert.match(text, /Analysis time: \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/)
  for (const item of request.observations) {
    assert.match(item.at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    assert.match(item.lastSeenAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  }
  assert.equal(batch[0].context.bundleId, 'test.editor')
  assert.equal(typeof batch[0].at, 'number')
})

test('full input and reply are kept in diagnostics, not polling state or ordinary logs', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.setScreen(0, { app: 'Editor', title: 'Private diagnostic title' })
  await h.trail.manualCapture(); await h.settle()
  const diagnostic = JSON.parse(h.files.get(h.state().lastAnalysis.diagnosticFile))
  assert.equal(diagnostic.input.text, h.requests[0].messages[0].content[0].text)
  assert.equal(JSON.parse(diagnostic.reply).activities.length, 1)
  assert.equal('input' in h.state().lastAnalysis, false)
  assert.equal('reply' in h.state().lastAnalysis, false)
  assert.ok(!h.logs.join('\n').includes('Private diagnostic title'))
})

test('invalid JSON fails explicitly and retains input and reply', async (t) => {
  const h = await createHost({ reply: '{' }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const diagnostic = JSON.parse(h.files.get(h.state().lastAnalysis.diagnosticFile))
  assert.equal(diagnostic.errorCode, 'INVALID_JSON')
  assert.equal(diagnostic.input.text, h.requests[0].messages[0].content[0].text)
  assert.equal(diagnostic.reply, '{')
  assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('static visibility is represented by dates without additional images', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  await h.presence('idle', 120000); await h.advance(180000)
  assert.equal(h.requests.length, 1)
  assert.equal(h.requests[0].observations.length, 1)
  const [item] = h.requests[0].observations
  assert.equal(item.at, '2023-11-15 06:13:20')
  assert.equal(item.lastSeenAt, '2023-11-15 06:15:20')
})
