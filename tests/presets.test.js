import assert from 'node:assert/strict'
import test from 'node:test'
import { inject } from '../dist/index.js'
import { createHost, root } from './harness.js'

const definition = () => ({ compaction: { config: { auto: true },
  compactIfNeeded: () => { throw new Error('the host, not the plugin, owns compaction') } } })

test('the plugin requires the host preset registry and token meter', () => {
  assert.ok(inject.includes('agentPresets')); assert.ok(inject.includes('tokenMeter'))
})

test('a fresh analysis mounts the host default preset before publishing and submitting input', async (t) => {
  const h = await createHost({ defaultPreset: 'minimal', presetDefinitions: new Map([['minimal', definition()]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const agent = h.ctx.agents.get(h.state().analysisSessionId)
  assert.equal(agent.session.agentPreset, 'minimal')
  assert.deepEqual(h.mountedPresets, ['minimal'])
  assert.equal(agent.ctx.get('compaction'), undefined)
  assert.ok(h.ctx.agentPresets.serviceFor(agent, 'compaction'))
  assert.equal(h.state().lastAnalysis.agentPreset, 'minimal')
  assert.equal(h.state().lastAnalysis.compactionAvailable, true)
  assert.equal(h.state().lastAnalysis.compactionAuto, true)
  assert.ok(h.state().lastAnalysis.contextAfter.totalTokens > 0)
  assert.ok(h.logs.findIndex((line) => line.includes('session.preset_mounted')) < h.logs.findIndex((line) => line.includes('analysis.started')))
  assert.equal(h.requests.length, 1)
})

test('restart mounts the saved preset, not a newly selected host default', async (t) => {
  const first = await createHost()
  await first.trail.manualCapture(); await first.settle(); await first.dispose()
  const h = await createHost({ history: JSON.parse(first.files.get(`${root}/state.json`)), conversations: first.conversations,
    defaultPreset: 'minimal', presetDefinitions: new Map([['standard', definition()], ['minimal', definition()]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.deepEqual(h.mountedPresets, ['standard'])
  assert.equal(h.createdSessions.length, 0); assert.equal(h.resumedSessions.length, 1)
  assert.equal(h.state().lastAnalysis.agentPreset, 'standard')
})

test('resume reads the latest preset projection rather than a stale header', async (t) => {
  const old = { id: 'selected-preset-session', cwd: root, agentPreset: 'standard', createdAt: 1699999900000, events: [
    { type: 'agent-preset/selected', seq: 0, time: 1699999900000, data: { agentPreset: 'minimal' } },
    { type: 'user/message', seq: 1, time: 1699999990000, data: { role: 'user', content: [{ type: 'text', text: 'prior observation' }] } },
  ] }
  const h = await createHost({ conversations: new Map([[old.id, old]]), history: { version: 4, records: [], activities: [], analysisSessionId: old.id },
    presetDefinitions: new Map([['standard', definition()], ['minimal', definition()]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().analysisSessionId, old.id)
  assert.deepEqual(h.mountedPresets, ['minimal'])
  assert.equal(h.state().lastAnalysis.agentPreset, 'minimal')
})

test('a legacy session without a preset stays intact while new analysis uses a properly composed session', async (t) => {
  const old = { id: 'legacy-raw-session', cwd: root, createdAt: 1699999900000, events: [
    { type: 'user/message', seq: 0, time: 1699999990000, data: { role: 'user', content: [{ type: 'text', text: 'old oversized history' }] } },
  ] }
  const before = structuredClone(old)
  const h = await createHost({ conversations: new Map([[old.id, old]]), history: { version: 4, records: [], activities: [], analysisSessionId: old.id } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.notEqual(h.state().analysisSessionId, old.id)
  assert.deepEqual(old, before); assert.equal(h.resumedSessions.length, 0)
  assert.deepEqual(h.workspaces.get(root).sessionIds, [h.state().analysisSessionId])
  assert.equal(h.requests[0].messages.length, 1)
  assert.ok(h.logs.some((line) => line.includes('session.preset_rollover')))
})

test('a missing saved preset fails without silently using the default or replacing history', async (t) => {
  const first = await createHost()
  await first.trail.manualCapture(); await first.settle(); await first.dispose()
  const h = await createHost({ history: JSON.parse(first.files.get(`${root}/state.json`)), conversations: first.conversations,
    defaultPreset: 'minimal', presetDefinitions: new Map([['minimal', definition()]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /agent preset not found: standard/)
  assert.equal(h.createdSessions.length, 0); assert.equal(h.requests.length, 0)
  assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('a preset mount error prevents analysis without a raw-agent fallback', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.ctx.agentPresets.mount = async () => { throw new Error('preset activation failed') }
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /preset activation failed/)
  assert.equal(h.requests.length, 0); assert.equal(h.state().analysisSessionId, null)
  assert.equal(h.ctx.agents.get(h.createdSessions[0]), undefined)
})

test('disabled automatic compaction prevents a model call and preserves evidence', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.presetDefinitions.get('standard').compaction.config.auto = false
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastAnalysis.errorCode, 'ANALYSIS_COMPACTION_DISABLED')
  assert.equal(h.state().lastAnalysis.compactionAuto, false)
  assert.equal(h.requests.length, 0); assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('a host-plane compaction service cannot mask a missing preset-local service', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.ctx.compaction = definition().compaction
  delete h.presetDefinitions.get('standard').compaction
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastAnalysis.errorCode, 'ANALYSIS_COMPACTION_MISSING')
  assert.equal(h.requests.length, 0)
})

test('an externally owned raw agent is rejected rather than silently reconfigured', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.trail.analysisHandle.dispose(); h.trail.analysisHandle = null
  const external = await h.ctx.agents.resume({ resumeSessionId: id }); t.after(external.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastAnalysis.errorCode, 'ANALYSIS_PRESET_MISSING')
  assert.equal(h.ctx.agents.get(id), external.agent); assert.equal(h.requests.length, 1)
  assert.equal(h.mountedPresets.length, 1)
})

test('cancellation during preset mounting cannot publish a late analysis agent', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const mount = h.ctx.agentPresets.mount; let release
  const gate = new Promise((resolve) => { release = resolve })
  h.ctx.agentPresets.mount = async (...args) => { await gate; return mount(...args) }
  await h.trail.manualCapture(); await h.settle()
  await h.trail.clear(); release(); await h.settle()
  assert.equal(h.state().analysisSessionId, null); assert.equal(h.requests.length, 0)
  assert.equal(h.ctx.agents.get(h.createdSessions[0]), undefined)
})

test('host pre-step compaction runs with execution tools blocked and is traced without summary text', async (t) => {
  const preset = definition()
  // 这是宿主生命周期契约，不是插件直接调用 compactIfNeeded 的替代实现。
  preset.beforeStep = async ({ agent, append, turn }) => {
    const previous = agent.session.events.filter((event) => event.type === 'assistant/message').at(-1)
    if (!previous) return
    assert.deepEqual(agent.toolRestriction, { allow: [] })
    assert.match(agent.toolGuard({ name: 'run_code' }), /不执行工具/)
    const compactionId = `host-compaction-${turn}`
    agent.session.measuredTokens = 900000
    append('compaction/start', { compactionId, turn })
    agent.session.compactThrough = previous.seq
    agent.session.compactedSummary = { role: 'user', content: [{ type: 'text', text: 'host checkpoint for previous work' }] }
    agent.session.measuredTokens = 8000
    append('compaction/summary', { compactionId, summary: [{ type: 'text', text: 'private summary must not appear in diagnostic metadata' }],
      shadowedTokenCount: 892000, shadowedSeqs: [1, previous.seq] })
    append('compaction/end', { compactionId, turn })
  }
  const h = await createHost({ presetDefinitions: new Map([['standard', preset]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const activity = h.state().records[0].id
  h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastError, null); assert.equal(h.state().records[0].id, activity)
  assert.equal(h.requests.length, 2); assert.equal(h.state().modelCalls, 2)
  assert.equal(h.requests[1].messages[0].content[0].text, 'host checkpoint for previous work')
  const diagnostic = h.state().lastAnalysis
  assert.deepEqual(diagnostic.compactions.map((entry) => entry.phase), ['start', 'summary', 'end'])
  assert.equal(diagnostic.compactions[0].tokens.totalTokens, 900000)
  assert.equal(diagnostic.compactions[2].tokens.totalTokens, 8000)
  assert.equal(diagnostic.compactions[1].shadowedTokenCount, 892000)
  assert.ok(!JSON.stringify(diagnostic).includes('private summary'))
  assert.ok(!h.logs.some((line) => line.includes('private summary')))
})

test('failed native compaction is traceable without hiding its error or losing pending evidence', async (t) => {
  const preset = definition()
  preset.beforeStep = async ({ append, turn }) => {
    const compactionId = 'failed-host-compaction'
    append('compaction/start', { compactionId, turn })
    append('compaction/end', { compactionId, turn, error: 'summary provider unavailable' })
    throw new Error('summary provider unavailable')
  }
  const h = await createHost({ presetDefinitions: new Map([['standard', preset]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /summary provider unavailable/)
  assert.equal(h.state().lastAnalysis.compactions.at(-1).error, 'summary provider unavailable')
  assert.equal(h.requests.length, 0); assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('compaction from another turn is not reported as this batch history management', async (t) => {
  const preset = definition()
  preset.beforeStep = async ({ append }) => {
    append('compaction/start', { compactionId: 'foreign-compaction', turn: 999 })
    append('compaction/end', { compactionId: 'foreign-compaction', turn: 999 })
  }
  const h = await createHost({ presetDefinitions: new Map([['standard', preset]]) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.deepEqual(h.state().lastAnalysis.compactions, [])
  assert.equal(h.state().lastError, null)
})

test('a broken compaction observer cancels analysis and reports the original tracing failure', async (t) => {
  const preset = definition()
  preset.beforeStep = async ({ append, turn }) => {
    append('compaction/start', { compactionId: 'meter-failure', turn })
    append('compaction/end', { compactionId: 'meter-failure', turn })
  }
  const h = await createHost({ presetDefinitions: new Map([['standard', preset]]) }); t.after(h.dispose)
  const metrics = h.trail.contextMetrics.bind(h.trail)
  h.trail.contextMetrics = (agent) => {
    if (agent.session.events.at(-1)?.type === 'compaction/start') throw new Error('diagnostic meter failed')
    return metrics(agent)
  }
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /diagnostic meter failed/)
  assert.equal(h.state().lastAnalysis.errorMessage, 'diagnostic meter failed')
  assert.equal(h.requests.length, 0); assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('unreadable preset projection fails rather than choosing a default for existing history', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  h.ctx.sessionQuery.inspectSession = async () => { throw new Error('preset projection unreadable') }
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /preset projection unreadable/)
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 1)
  assert.equal(h.requests.length, 1)
})
