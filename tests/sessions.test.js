import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, root } from './harness.js'
import { ScreenTrail } from '../trail.js'
import { AnalysisResponse } from '../analysis-response.js'

const hour = 60 * 60 * 1000
const messages = (session) => session.events.filter((event) => ['user/message', 'assistant/message'].includes(event.type))

// 直接重放宿主公开的帧结构；普通 chunk/end 不携带 turn，不能再靠测试桩补出该字段。
async function replayNativeFrames(frames) {
  const handlers = new Map(); const logs = []; let response = new AnalysisResponse(); let starts = 0
  const on = (name, fn) => { handlers.set(name, fn); return () => handlers.delete(name) }
  const session = { id: 'native-session' }
  const subject = { uuid: () => 'analysis-input', log: (event, data) => logs.push({ event, ...data }),
    ctx: { on, sessions: { flush: async () => {} } } }
  const agent = { id: session.id, session,
    ctx: { on, systemPrompt: { section: () => () => {} }, tools: { restrict: () => () => {}, guard: () => () => {} } },
    cancel: () => {},
    followup: (message) => {
      handlers.get('agent/inbox/claimed')({ agent, message, turn: 2 })
      for (const frame of frames) handlers.get('agent/assistant-stream')({ agent, frame })
      handlers.get('session/event')(session, { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    },
  }
  await ScreenTrail.prototype.runSessionAnalysis.call(subject, agent, [], new AbortController().signal,
    () => { starts += 1; response = new AnalysisResponse() }, (chunk) => response.push(chunk))
  return { response, starts, logs }
}
const startFrame = (attempt, turn = 2) => ({ type: 'start', ...attempt, turn, step: 1 })
const chunkFrames = (attempt, chunks) => chunks.map((chunk, index) => ({ type: 'chunk', ...attempt, index, time: 1700000000000 + index, chunk }))
const endFrame = (attempt, index) => ({ type: 'end', ...attempt, index, outcome: { kind: 'committed', eventType: 'assistant/message', seq: 10 } })
const completeChunks = () => [
  { type: 'block-start', index: 0, block: { type: 'text', text: '' } },
  { type: 'text-delta', index: 0, text: '{"activities":[]}' },
  { type: 'block-end', index: 0, block: { type: 'text', text: '{"activities":[]}' } },
  { type: 'usage', usage: { inputTokens: 100, outputTokens: 20 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

test('analysis is a real native conversation turn, not a second mirrored model request', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const id = h.state().analysisSessionId; const session = h.conversations.get(id)
  assert.equal(session.title, '屏幕纪事'); assert.equal(session.cwd, root)
  assert.deepEqual(messages(session).map((event) => event.type), ['user/message', 'assistant/message'])
  assert.ok(messages(session)[0].data.content.some((item) => item.type === 'image'))
  assert.equal(JSON.parse(messages(session)[1].data.content[0].text).activities.length, 1)
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].sessionId, id)
  assert.equal(h.state().lastAnalysis.sessionId, id); assert.ok(h.flushedSessions.includes(id))
  assert.equal(JSON.parse(h.files.get(`${root}/state.json`)).analysisSessionId, id)
})

test('successive analyses append to one session and keep native message history', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.advance(hour); h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.createdSessions.length, 1); assert.equal(h.state().analysisSessionId, id)
  assert.equal(messages(h.conversations.get(id)).length, 4)
  assert.equal(h.requests.length, 2); assert.equal(h.requests[1].messages.length, 4)
  assert.equal(h.state().records.length, 1)
})

test('the boundary is eight hours since the last message, not session creation time', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.advance(8 * hour - 1); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().analysisSessionId, id)
  await h.advance(8 * hour); await h.trail.manualCapture(); await h.settle()
  assert.notEqual(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 2)
  assert.equal(h.conversations.has(id), true)
})

test('crossing midnight within eight hours does not open a new conversation', async (t) => {
  const h = await createHost({ startAt: Date.UTC(2026, 10, 21, 15, 59) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.advance(2 * 60 * 1000); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 1)
})

test('a manually posted message extends reuse, but a later title event does not', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.advance(7 * hour)
  h.conversations.get(id).append('user/message', { id: 'manual-message', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续记录' }] })
  await h.advance(7 * hour); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().analysisSessionId, id)
  await h.advance(8 * hour)
  h.conversations.get(id).append('session/title', { title: '改个名字' })
  await h.trail.manualCapture(); await h.settle()
  assert.notEqual(h.state().analysisSessionId, id)
})

test('restart restores the associated conversation instead of creating another one', async (t) => {
  const first = await createHost()
  await first.trail.manualCapture(); await first.settle()
  const id = first.state().analysisSessionId; await first.dispose()
  const h = await createHost({ history: JSON.parse(first.files.get(`${root}/state.json`)), conversations: first.conversations, startAt: 1700000000000 + hour }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 0)
  assert.deepEqual(h.resumedSessions, [id]); assert.equal(messages(h.conversations.get(id)).length, 4)
})

test('restart after eight hours creates a new session without resuming or deleting the old one', async (t) => {
  const first = await createHost()
  await first.trail.manualCapture(); await first.settle(); const id = first.state().analysisSessionId; await first.dispose()
  const h = await createHost({ history: JSON.parse(first.files.get(`${root}/state.json`)), conversations: first.conversations, startAt: 1700000000000 + 8 * hour }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.notEqual(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 1)
  assert.equal(h.resumedSessions.length, 0); assert.equal(h.conversations.has(id), true)
})

test('an agent already resumed by the UI is reused without taking its lifecycle ownership', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.trail.analysisHandle.dispose(); h.trail.analysisHandle = null
  const external = await h.ctx.agents.resume({ resumeSessionId: id, agentOptions: { provider: 'mock', model: 'vision', maxTokens: 16384 },
    setup: (agentCtx) => h.ctx.agentPresets.mount(agentCtx, 'standard') })
  t.after(external.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.createdSessions.length, 1); assert.equal(h.resumedSessions.length, 1)
  assert.equal(h.trail.analysisHandle, null); assert.equal(external.agent.toolRestriction, null)
  assert.equal(external.agent.toolGuard, null)
  assert.equal(messages(h.conversations.get(id)).length, 4)
})

test('a batch with no worthwhile events still has an input and original reply in the conversation', async (t) => {
  const h = await createHost({ reply: { activities: [] } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const session = h.conversations.get(h.state().analysisSessionId)
  assert.equal(messages(session).length, 2)
  assert.deepEqual(JSON.parse(messages(session)[1].data.content[0].text), { activities: [] })
  assert.equal(h.state().records.length, 0); assert.equal(h.requests.length, 1)
})

test('native failures surface without falling back to an invisible direct model request', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.ctx.agents.create = async () => { throw new Error('native session creation failed') }
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /native session creation failed/)
  assert.equal(h.requests.length, 0); assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('missing associated sessions and busy sessions fail explicitly rather than silently creating another one', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const agent = h.ctx.agents.get(h.state().analysisSessionId)
  agent.status = 'running'
  await h.trail.manualCapture(); await h.settle(); agent.status = 'idle'
  assert.match(h.state().lastError, /正在处理其他消息/); assert.equal(h.requests.length, 1)
  h.conversations.delete(agent.id)
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /session not found/); assert.equal(h.createdSessions.length, 1)
})

test('model failure preserves the submitted input and native failed attempt', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.ctx.llm.stream = async function* () { throw new Error('provider unavailable') }
  await h.trail.manualCapture(); await h.settle()
  const session = h.conversations.get(h.state().analysisSessionId)
  assert.match(h.state().lastError, /provider unavailable/)
  assert.deepEqual(session.events.filter((event) => ['user/message', 'assistant/attempt'].includes(event.type)).map((event) => event.type), ['user/message', 'assistant/attempt'])
})

test('failed chat durability reports failure but does not undo or retry committed events', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  h.ctx.sessions.flush = async () => { throw new Error('session checkpoint failed') }
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /session checkpoint failed/)
  assert.equal(h.state().records.length, 1); assert.equal(h.requests.length, 1)
  assert.equal(h.state().lastAnalysis.outcome, 'failed')
  assert.ok(h.state().lastAnalysis.eventCommit)
  assert.equal(h.state().unfinishedCount, 0)
})

test('clearing recorder data cancels the native turn without deleting or recreating its conversation', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.trail.clear(); await h.settle(); h.release(); await h.settle()
  assert.equal(h.state().records.length, 0); assert.equal(h.state().observations.length, 0)
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.conversations.has(id), true)
  assert.ok(h.conversations.get(id).events.some((event) => event.type === 'assistant/attempt'))
})

test('a late native creation after cancellation cannot attach itself or start a model call', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const create = h.ctx.agents.create; let release
  const gate = new Promise((resolve) => { release = resolve })
  h.ctx.agents.create = async (options) => { const handle = await create(options); await gate; return handle }
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.createdSessions.length, 1)
  await h.trail.clear(); release(); await h.settle()
  assert.equal(h.state().analysisSessionId, null); assert.equal(h.requests.length, 0)
  assert.equal(h.ctx.agents.get(h.createdSessions[0]), undefined)
})

test('assistant completion time rather than request start time determines the eight-hour boundary', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const stream = h.ctx.llm.stream
  h.ctx.llm.stream = async function* (request) { await h.advance(1000); yield* stream(request) }
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  await h.advance(8 * hour - 500); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 1)
})

test('stream events from another turn cannot become the analysis reply', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const create = h.ctx.agents.create; let publish
  h.ctx.agents.create = async (options) => {
    const handle = await create(options); const on = handle.agent.ctx.on
    handle.agent.ctx.on = (name, fn) => {
      if (name === 'agent/assistant-stream') publish = fn
      return on(name, fn)
    }
    return handle
  }
  const stream = h.ctx.llm.stream
  h.ctx.llm.stream = async function* (request) {
    publish({ frame: { type: 'start', attemptId: 'other-attempt', revision: 999, turn: 999, step: 1 } })
    publish({ frame: { type: 'chunk', attemptId: 'other-attempt', revision: 999, index: 0, time: 1, chunk: { type: 'text-delta', index: 0, text: 'another turn' } } })
    publish({ frame: { type: 'chunk', attemptId: 'other-attempt', revision: 999, index: 1, time: 2, chunk: { type: 'finish', reason: { kind: 'stop' } } } })
    yield* stream(request)
  }
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().lastError, null)
  assert.equal(h.state().modelCalls, 1)
})

test('native chunk and end frames without turn preserve reply, usage and finish', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const create = h.ctx.agents.create; const received = []
  h.ctx.agents.create = async (options) => {
    const handle = await create(options); const on = handle.agent.ctx.on
    handle.agent.ctx.on = (name, fn) => on(name, (payload) => {
      if (name === 'agent/assistant-stream') received.push(payload.frame)
      return fn(payload)
    })
    return handle
  }
  await h.trail.manualCapture(); await h.settle()
  assert.ok(received.some((frame) => frame.type === 'chunk'))
  assert.ok(received.filter((frame) => frame.type !== 'start').every((frame) => !('turn' in frame)))
  assert.equal(h.state().lastError, null)
  assert.equal(h.state().records.length, 1)
  assert.equal(h.state().lastAnalysis.finish.kind, 'stop')
  assert.equal(h.state().lastAnalysis.usage.outputTokens, 200)
  assert.equal(h.state().lastAnalysis.chunks, 4)
})

test('recorded-format native frames deliver all chunks and trace their attempt identity', async () => {
  const attempt = { attemptId: 'native-attempt', revision: 1 }; const chunks = completeChunks()
  const { response, starts, logs } = await replayNativeFrames([startFrame(attempt), ...chunkFrames(attempt, chunks), endFrame(attempt, chunks.length)])
  response.assertComplete(16384)
  assert.equal(response.text(), '{"activities":[]}'); assert.equal(starts, 1)
  assert.equal(response.metadata().chunks, 5); assert.equal(response.metadata().usage.outputTokens, 20)
  assert.deepEqual(logs.map((entry) => entry.event), ['analysis.stream_started', 'analysis.stream_ended'])
  assert.equal(logs[1].attemptId, attempt.attemptId)
  assert.equal(logs[1].receivedChunks, logs[1].reportedChunks)
})

test('foreign start/chunk/end frames do not replace the active attempt', async () => {
  const own = { attemptId: 'own-attempt', revision: 1 }; const other = { attemptId: 'foreign-attempt', revision: 2 }
  const chunks = completeChunks()
  const { response, starts } = await replayNativeFrames([
    startFrame(own), startFrame(other, 999),
    ...chunkFrames(other, [{ type: 'text-delta', index: 0, text: 'foreign reply' }]), endFrame(other, 1),
    ...chunkFrames(own, chunks), endFrame(own, chunks.length),
  ])
  response.assertComplete(16384)
  assert.equal(starts, 1); assert.equal(response.text(), '{"activities":[]}')
})

test('a new attempt resets assembly and late chunks from the previous attempt cannot contaminate it', async () => {
  const first = { attemptId: 'first-attempt', revision: 1 }; const retry = { attemptId: 'retry-attempt', revision: 2 }
  const chunks = completeChunks()
  const { response, starts } = await replayNativeFrames([
    startFrame(first), ...chunkFrames(first, [{ type: 'text-delta', index: 0, text: '{unfinished' }]),
    startFrame(retry),
    ...chunkFrames(first, [{ type: 'text-delta', index: 0, text: 'stale reply' }, { type: 'finish', reason: { kind: 'stop' } }]), endFrame(first, 2),
    ...chunkFrames(retry, chunks), endFrame(retry, chunks.length),
  ])
  response.assertComplete(16384)
  assert.equal(starts, 2); assert.equal(response.text(), '{"activities":[]}')
  assert.equal(response.metadata().chunks, chunks.length)
})

test('genuinely missing finish still fails despite a native end frame', async () => {
  const attempt = { attemptId: 'unfinished-attempt', revision: 1 }; const chunks = completeChunks().slice(0, -1)
  const { response } = await replayNativeFrames([startFrame(attempt), ...chunkFrames(attempt, chunks), endFrame(attempt, chunks.length)])
  assert.throws(() => response.assertComplete(16384), (error) => error.code === 'MISSING_FINISH')
})

test('missing attempt identity fails explicitly rather than silently dropping the stream', async () => {
  await assert.rejects(replayNativeFrames([{ type: 'start', revision: 1, turn: 2, step: 1 }]),
    (error) => error.code === 'STREAM_PROTOCOL' && /attemptId/.test(error.message))
})

test('nonconsecutive chunk indices fail as a stream protocol error', async () => {
  const attempt = { attemptId: 'gap-attempt', revision: 1 }
  const frame = { ...chunkFrames(attempt, completeChunks())[0], index: 1 }
  await assert.rejects(replayNativeFrames([startFrame(attempt), frame, endFrame(attempt, 2)]),
    (error) => error.code === 'STREAM_PROTOCOL' && /expected 0/.test(error.message))
})

test('native end count mismatches cannot masquerade as a complete response', async () => {
  const attempt = { attemptId: 'count-attempt', revision: 1 }; const chunks = completeChunks()
  await assert.rejects(replayNativeFrames([startFrame(attempt), ...chunkFrames(attempt, chunks), endFrame(attempt, chunks.length + 1)]),
    (error) => error.code === 'STREAM_PROTOCOL' && /received 5/.test(error.message))
})

test('native analysis does not override the host tool permissions or executor', async (t) => {
  const h = await createHost({ hold: true }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const agent = h.ctx.agents.get(h.state().analysisSessionId)
  assert.equal(agent.toolRestriction, null)
  assert.equal(agent.toolGuard, null)
  assert.equal(agent.executor, undefined)
  h.release(); await h.settle()
  assert.equal(agent.toolGuard, null)
})
