import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, root } from './harness.js'

test('the dedicated workspace is registered without recording or creating an empty conversation', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const workspace = h.workspaces.get(root)
  assert.equal(workspace.title, '屏幕纪事'); assert.equal(workspace.path, root)
  assert.equal(h.createdSessions.length, 0); assert.equal(h.requests.length, 0)
  assert.ok(h.logs.some((line) => line.includes('session.group_ready')))
})

test('analysis sessions attach only to the plugin directory, leaving unrelated sessions untouched', async (t) => {
  const conversations = new Map([['unrelated-session', { id: 'unrelated-session', cwd: '/workspace', events: [] }]])
  const h = await createHost({ conversations }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const workspace = h.workspaces.get(root)
  assert.deepEqual(workspace.sessionIds, [h.state().analysisSessionId])
  assert.equal(h.workspaces.has('/workspace'), false)
  assert.equal(conversations.get('unrelated-session').cwd, '/workspace')
  assert.equal(conversations.get('unrelated-session').events.length, 0)
  assert.ok(h.logs.some((line) => line.includes('session.group_attached')))
})

test('eight-hour session rotation keeps all analysis conversations in the same dedicated group', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const first = h.state().analysisSessionId
  const workspace = h.workspaces.get(root)
  await h.advance(8 * 60 * 60 * 1000); await h.trail.manualCapture(); await h.settle()
  const next = h.state().analysisSessionId
  assert.notEqual(next, first); assert.equal(h.workspaces.size, 1)
  assert.deepEqual(workspace.sessionIds, [next, first])
})

test('restart reuses the native group and preserves a user-renamed group title', async (t) => {
  const first = await createHost()
  await first.trail.manualCapture(); await first.settle()
  const sessionId = first.state().analysisSessionId; const workspace = first.workspaces.get(root)
  workspace.title = '我的屏幕记录'
  await first.dispose()
  const h = await createHost({ conversations: first.conversations, workspaces: first.workspaces,
    history: first.snapshot(), startAt: 1700000000000 + 1000 }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.workspaces.size, 1); assert.equal(h.workspaces.get(root).id, workspace.id)
  assert.equal(h.workspaces.get(root).title, '我的屏幕记录')
  assert.equal(h.state().analysisSessionId, sessionId)
  assert.deepEqual(workspace.sessionIds, [sessionId])
})

test('workspace registration failures are explicit and cannot silently leave recording ungrouped', async (t) => {
  const h = await createHost({ workspaceError: 'workspace storage unavailable' }); t.after(h.dispose)
  assert.equal(h.state().ready, false)
  await assert.rejects(h.trail.start(), /workspace storage unavailable/)
  assert.equal(h.requests.length, 0); assert.equal(h.createdSessions.length, 0)
})

test('failed attachment does not run the model or create an alternative ungrouped session', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const workspace = h.workspaces.get(root); const attach = workspace.attachSession
  workspace.attachSession = async () => { throw new Error('group attachment failed') }
  await h.trail.manualCapture(); await h.settle()
  const id = h.state().analysisSessionId
  assert.match(h.state().lastError, /group attachment failed/)
  assert.equal(h.requests.length, 0); assert.equal(h.createdSessions.length, 1)
  assert.equal(h.state().observations[0].analysisStatus, 'failed')
  workspace.attachSession = attach
  await h.advance(1000); await h.settle()
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 1)
  assert.deepEqual(workspace.sessionIds, [id]); assert.equal(h.requests.length, 1)
})

const legacySession = () => ({ id: 'legacy-analysis-session', cwd: '/workspace', createdAt: 1699999990000, title: '旧屏幕纪事', events: [
  { type: 'user/message', seq: 0, time: 1699999990000, data: { id: 'legacy-input', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '旧观察记录。' }] } },
  { type: 'assistant/message', seq: 1, time: 1699999990500, data: { role: 'assistant', content: [{ type: 'text', text: '{"activities":[]}' }] } },
] })

test('an associated ungrouped session is preserved while subsequent analysis opens a fresh grouped session', async (t) => {
  const old = legacySession(); const before = structuredClone(old)
  const h = await createHost({ conversations: new Map([[old.id, old]]), history: { version: 4, records: [], activities: [], analysisSessionId: old.id } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const id = h.state().analysisSessionId
  assert.notEqual(id, old.id); assert.deepEqual(h.conversations.get(old.id), before)
  assert.equal(h.resumedSessions.length, 0); assert.equal(h.createdSessions.length, 1)
  assert.deepEqual(h.workspaces.get(root).sessionIds, [id])
  assert.equal(h.requests[0].messages.length, 1)
  assert.ok(!h.requests[0].messages[0].content[0].text.includes('旧观察记录。'))
  assert.equal(h.trail.store.setting('analysisSessionId'), id)
  assert.ok(h.logs.some((line) => line.includes('session.group_rollover')))
})

test('switching to the dedicated group does not dispose or alter an old session owned by the UI', async (t) => {
  const old = legacySession()
  const h = await createHost({ conversations: new Map([[old.id, old]]), history: { version: 4, records: [], activities: [], analysisSessionId: old.id } }); t.after(h.dispose)
  const external = await h.ctx.agents.resume({ resumeSessionId: old.id, agentOptions: { provider: 'mock', model: 'vision' } })
  t.after(external.dispose)
  const before = JSON.stringify(old.events)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.ctx.agents.get(old.id), external.agent)
  assert.equal(JSON.stringify(old.events), before); assert.equal(old.cwd, '/workspace')
  assert.notEqual(h.state().analysisSessionId, old.id)
})

test('an unreadable session header is reported rather than silently switching or rewriting it', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); const id = h.state().analysisSessionId
  h.ctx.sessionPersistence.stat = async () => { throw new Error('session header unreadable') }
  await h.trail.manualCapture(); await h.settle()
  assert.match(h.state().lastError, /session header unreadable/)
  assert.equal(h.state().analysisSessionId, id); assert.equal(h.createdSessions.length, 1)
  assert.equal(h.requests.length, 1)
})
