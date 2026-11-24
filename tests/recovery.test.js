import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, root } from './harness.js'

const backlog = (count) => ({ version: 3, contents: {}, records: Array.from({ length: count }, (_, index) => ({
  id: `pending-${index}`, imageId: `image-${index}`, at: 1699999900000 + index,
  analysis: null, analysisError: null, analysisStatus: 'pending',
})) })

test('starting an over-capacity queue drains existing work without capturing or adding records', async (t) => {
  const host = await createHost({ hold: true, history: backlog(212), config: { retention: 6, analysisWindowSec: 15 } }); t.after(host.dispose)
  await host.trail.start(); await host.settle()
  assert.equal(host.state().observations.length, 212)
  assert.equal(host.state().capturePaused, true)
  assert.equal(host.state().analysisEnabled, true)
  assert.equal(host.requests.length, 1)
  assert.equal(host.commands.length, 0)
  await host.trail.start(); await host.trail.start(); await host.settle()
  assert.equal(host.state().observations.length, 212)
  assert.equal(host.requests.length, 1)
  assert.equal(host.state().lastError, null)
})

test('capture resumes automatically after the backlog drops below its low watermark', async (t) => {
  const host = await createHost({ hold: true, history: backlog(212), config: { retention: 6, analysisWindowSec: 15 } }); t.after(host.dispose)
  await host.trail.start(); await host.settle()
  host.release(); await host.settle()
  assert.equal(host.state().running, true)
  assert.equal(host.state().capturePaused, false)
  assert.equal(host.state().captureSource, 'ready')
  assert.ok(host.state().observations.length <= 6)
  assert.ok(host.state().unfinishedCount < 6)
  assert.ok(host.logs.some((line) => line.includes('capture.resumed')))
})

test('an explicit pause during backlog draining does not auto-resume capture', async (t) => {
  const host = await createHost({ hold: true, history: backlog(212), config: { retention: 6, analysisWindowSec: 15 } }); t.after(host.dispose)
  await host.trail.start(); await host.settle()
  host.trail.pause(); host.release(); await host.settle()
  await host.advance(10000, { poll: false })
  assert.equal(host.state().running, false)
  assert.equal(host.state().analysisEnabled, false)
  assert.equal(host.state().captureSource, 'stopped')
  assert.equal(host.commands.length, 0)
})

test('max-tokens is diagnosed before JSON parsing, with usage and the original partial reply saved', async (t) => {
  const reply = '{"screens":[{"content":"unterminated'
  const host = await createHost({ reply, finishReason: { kind: 'max-tokens' }, usage: { inputTokens: 100, outputTokens: 16384, reasoningTokens: 15000 } })
  t.after(host.dispose)
  await host.trail.manualCapture(); await host.settle()
  const diagnostic = host.state().lastAnalysis
  assert.equal(diagnostic.errorCode, 'OUTPUT_TRUNCATED')
  assert.equal(diagnostic.finish.kind, 'max-tokens')
  assert.equal(diagnostic.usage.outputTokens, 16384)
  assert.equal(diagnostic.usage.reasoningTokens, 15000)
  assert.equal(diagnostic.responseCharacters, reply.length)
  assert.equal(JSON.parse(host.files.get(diagnostic.diagnosticFile)).reply, reply)
  assert.equal(host.state().observations[0].analysisStatus, 'failed')
  assert.equal(host.state().records.length, 0)
  assert.match(host.state().lastError, /模型输出达到上限/)
})

test('a syntactically valid reply is still rejected when the provider reports max-tokens', async (t) => {
  const host = await createHost({ finishReason: { kind: 'max-tokens' } }); t.after(host.dispose)
  await host.trail.manualCapture(); await host.settle()
  assert.equal(host.state().lastAnalysis.errorCode, 'OUTPUT_TRUNCATED')
  assert.equal(host.state().analyses, 0)
})

test('a missing finish cannot be mistaken for a completed JSON response', async (t) => {
  const host = await createHost({ finishReason: null }); t.after(host.dispose)
  await host.trail.manualCapture(); await host.settle()
  assert.equal(host.state().lastAnalysis.errorCode, 'MISSING_FINISH')
  assert.equal(host.state().analyses, 0)
  assert.equal(host.state().observations[0].analysisStatus, 'failed')
})

test('invalid JSON after a normal stop keeps the precise parse error and raw response', async (t) => {
  const reply = '{"screens":[],"observations":[{"summary":"unfinished'
  const host = await createHost({ reply }); t.after(host.dispose)
  await host.trail.manualCapture(); await host.settle()
  const diagnostic = host.state().lastAnalysis
  assert.equal(diagnostic.finish.kind, 'stop')
  assert.equal(diagnostic.errorCode, 'INVALID_JSON')
  assert.match(diagnostic.errorMessage, /Unterminated/)
  assert.equal(JSON.parse(host.files.get(diagnostic.diagnosticFile)).reply, reply)
})

test('unconfigured reasoning follows the advertised model default with an explicit output budget', async (t) => {
  const host = await createHost({ modelInfo: { inputModalities: ['image'], reasoning: { defaultEffort: 'high', efforts: [{ id: 'off' }, { id: 'high' }] } } })
  t.after(host.dispose)
  await host.trail.manualCapture(); await host.settle()
  assert.equal(host.requests[0].maxTokens, 16384)
  assert.equal(host.requests[0].reasoningEffort, 'high')
  assert.equal(host.state().lastAnalysis.adapterDefaultEffort, 'high')
  assert.equal(host.state().lastAnalysis.reasoningEffort, 'high')
})

test('clear removes diagnostics, raw samples and cache and prevents late metadata work from writing back', async (t) => {
  const host = await createHost(); t.after(host.dispose)
  await host.trail.manualCapture(); await host.settle()
  let releaseMetadata
  host.ctx.llm.resolveModelInfo = async () => new Promise((resolve) => { releaseMetadata = resolve })
  await host.trail.manualCapture(); await host.settle()
  await host.trail.clear()
  assert.equal(host.state().records.length, 0)
  assert.equal(host.state().lastAnalysis, null)
  assert.equal(host.state().modelCalls, 0)
  assert.equal('contents' in host.snapshot(), false)
  assert.equal([...host.files.keys()].filter((file) => file.startsWith(`${root}/diagnostics/`)).length, 0)
  assert.equal([...host.files.keys()].filter((file) => file.startsWith('/virtual-temp/samples/')).length, 0)
  releaseMetadata({ inputModalities: ['image'] }); await host.settle()
  assert.equal(host.state().records.length, 0)
  assert.equal(host.state().lastAnalysis, null)
  assert.equal([...host.files.keys()].filter((file) => file.startsWith(`${root}/diagnostics/`)).length, 0)
  assert.equal(host.requests.length, 1)
})

test('diagnostics keep only the latest fifty requests', async (t) => {
  const host = await createHost(); t.after(host.dispose)
  for (let i = 0; i < 52; i += 1) { await host.trail.manualCapture(); await host.settle() }
  const files = [...host.files.keys()].filter((file) => file.startsWith(`${root}/diagnostics/`) && file.endsWith('.json'))
  assert.equal(files.length, 50)
  assert.ok(host.files.has(host.state().lastAnalysis.diagnosticFile))
})

test('a storage failure while restoring old analysis rejects startup visibly', async (t) => {
  const host = await createHost({ writeError: true, history: backlog(1) })
  t.after(async () => { host.release(); await assert.rejects(host.trail.dispose(), /disk write failed/) })
  await assert.rejects(host.trail.start(), /disk write failed/)
  assert.equal(host.state().running, false)
  assert.equal(host.requests.length, 0)
  assert.match(host.state().lastError, /disk write failed/)
})

test('invalid output controls fail instead of silently changing the configured budget', async () => {
  for (const analysisMaxTokens of ['invalid', 0, 16384.5, 131073]) {
    await assert.rejects(createHost({ config: { analysisMaxTokens } }), /analysisMaxTokens must be an integer/)
  }
  await assert.rejects(createHost({ config: { analysisReasoningEffort: '' } }), /non-empty advertised effort ID/)
})
