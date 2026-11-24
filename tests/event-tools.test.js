import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost } from './harness.js'
import { findEvents } from '../event-tools.js'

const create = (activity = '编写 LeetCode 438') => ({ action: 'create', activity, summary: '编写滑动窗口代码。', images: [1] })

test('ordinary conversations can query, edit and create from stored evidence without ending their turn', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const actor = { agent: { id: 'ordinary-chat', session: {}, options: { provider: 'mock', model: 'vision' } } }
  const found = await h.invokeTool('screen_trail_find_events', { query: '编写代码', includeEvidence: true }, actor)
  const event = found.events[0]
  await h.invokeTool('screen_trail_write_events', { changes: [{ action: 'update', id: event.id, summary: '普通聊天修改。' }] }, actor)
  await h.invokeTool('screen_trail_write_events', { changes: [{ action: 'create', activity: '从已有证据新增', summary: '使用查询返回的截图依据。', evidenceIds: [event.evidence[0].id] }] }, actor)
  assert.equal(h.state().records.length, 2)
  assert.equal(h.state().records.find((item) => item.id === event.id).analysis.summary, '普通聊天修改。')
  assert.ok(h.state().ignored >= 0)
  assert.equal(h.state().lastError, null)
})

test('analysis may use other host tools without plugin allowlists', async (t) => {
  let invoked = 0
  const h = await createHost({ toolScript: async ({ call }) => {
    await call('host_other_tool', {})
    await call('write_events', { changes: [] })
  } }); t.after(h.dispose)
  h.ctx.tools.register({ name: 'host_other_tool', execute: async () => { invoked++; return { ok: true } } })
  await h.trail.manualCapture(); await h.settle()
  assert.equal(invoked, 1); assert.equal(h.state().lastError, null)
})

test('real tool results supply the ID for querying and continuing one event', async (t) => {
  const receipts = []
  const h = await createHost({ toolScript: async ({ call, requests }) => {
    const found = await call('find_events', { query: 'LeetCode 438' })
    const changes = requests.length === 1 ? [create()] : [{ action: 'update', id: found.events[0].id, summary: '继续完善滑动窗口。', images: [1] }]
    receipts.push(await call('write_events', { changes }))
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastError, null)
  assert.equal(h.state().records.length, 1)
  assert.equal(receipts[0].events[0].id, receipts[1].events[0].id)
  assert.equal(h.state().records[0].evidence.length, 2)
  assert.equal(h.state().records[0].analysis.summary, '继续完善滑动窗口。')
  assert.match(findEvents(h.trail.activities, {}).events[0].at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  assert.ok(h.conversations.get(h.state().analysisSessionId).events.some((event) => event.type === 'tool/result'))
})

test('query results can drive merge and delete without title-based automatic merging', async (t) => {
  const h = await createHost({ toolScript: async ({ call, requests }) => {
    if (requests.length === 1) await call('write_events', { changes: [create('阶段 A'), create('阶段 B')] })
    else {
      const found = await call('find_events', {})
      await call('write_events', { changes: requests.length === 2 ? [{ action: 'merge', id: found.events[0].id,
        mergeIds: [found.events[1].id], activity: '完整活动', summary: '合并两个阶段。', images: [1] }]
        : [{ action: 'delete', id: found.events[0].id }] })
    }
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); assert.equal(h.state().records.length, 2)
  h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().records[0].evidence.length, 2)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 0); assert.equal(h.state().lastError, null)
})

test('an invalid change leaves the whole event batch unapplied and evidence retained', async (t) => {
  const h = await createHost({ toolScript: async ({ call }) => call('write_events', { changes: [create(), { action: 'update', id: 'missing-event' }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 0)
  assert.match(h.state().lastError, /event not found/)
  assert.equal(h.state().observations[0].analysisStatus, 'failed')
  assert.equal(h.state().lastAnalysis.eventCommit, null)
})

test('a failed tool call can be corrected before the final successful commit', async (t) => {
  const h = await createHost({ toolScript: async ({ call }) => {
    await assert.rejects(call('write_events', { changes: [{ action: 'update', id: 'missing-event' }] }), /event not found/)
    await call('write_events', { changes: [create()] })
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().lastError, null)
  assert.deepEqual(h.state().lastAnalysis.toolCalls.map((item) => item.outcome), ['failed', 'complete'])
})

test('identical duplicate submissions return the same receipt without creating duplicates', async (t) => {
  const h = await createHost({ toolScript: async ({ call }) => {
    const args = { changes: [create()] }
    assert.deepEqual(await call('write_events', args, { callId: 'replayed-call' }), await call('write_events', args, { callId: 'replayed-call' }))
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1)
  assert.equal(h.state().lastAnalysis.toolCalls.filter((item) => item.name === 'screen_trail_write_events').length, 1)
})

test('the model may inspect a saved result and update it again in the same turn', async (t) => {
  const h = await createHost({ toolScript: async ({ call }) => {
    const saved = await call('write_events', { changes: [create()] })
    const found = await call('find_events', { ids: [saved.events[0].id] })
    await call('write_events', { changes: [{ action: 'update', id: found.events[0].id, summary: '保存后复查并修正。' }] })
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastError, null)
  assert.equal(h.state().records.length, 1)
  assert.equal(h.state().records[0].analysis.summary, '保存后复查并修正。')
  assert.equal(h.state().analyses, 1)
  assert.notEqual(h.ctx.agents.get(h.state().analysisSessionId).concluded, true)
  assert.equal(h.state().unfinishedCount, 0)
  assert.ok(h.state().lastAnalysis.eventCommit)
})

test('plain final JSON cannot save events without a successful business tool call', async (t) => {
  const h = await createHost({ toolScript: false }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().lastAnalysis.errorCode, 'EVENT_BATCH_NOT_COMMITTED')
  assert.equal(h.state().records.length, 0)
  assert.equal(h.state().observations[0].analysisStatus, 'failed')
})

test('an empty first write does not reclaim screenshots needed by a later edit', async (t) => {
  const h = await createHost({ toolScript: async ({ call, agent }) => {
    await call('write_events', { changes: [] })
    await h.trail.prune()
    const record = h.state().observations[0]
    assert.ok((await h.trail.image(record.id)).length)
    await call('write_events', { changes: [create()] })
    assert.notEqual(agent.concluded, true)
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1)
  assert.equal(h.state().analyses, 1)
  assert.equal(h.state().lastError, null)
})

test('storage failure does not publish a partially edited journal', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  const rename = h.trail.io.rename
  h.trail.io.rename = async (from, to) => {
    if (to === h.trail.stateFile && JSON.parse(h.files.get(from)).activities.length) throw new Error('event disk failed')
    return rename(from, to)
  }
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 0)
  assert.equal(JSON.parse(h.files.get(h.trail.stateFile)).activities.length, 0)
  assert.ok(h.state().observations.length)
  assert.ok(h.logs.some((line) => line.includes('event disk failed')))
})

test('empty commits explicitly ignore evidence and invalid image references fail', async (t) => {
  const ignored = await createHost({ toolScript: async ({ call }) => call('write_events', { changes: [] }) }); t.after(ignored.dispose)
  await ignored.trail.manualCapture(); await ignored.settle()
  assert.equal(ignored.state().observations.length, 0); assert.equal(ignored.state().lastError, null)
  const bad = await createHost({ toolScript: async ({ call }) => call('write_events', { changes: [{ ...create(), images: [99] }] }) }); t.after(bad.dispose)
  await bad.trail.manualCapture(); await bad.settle()
  assert.equal(bad.state().records.length, 0); assert.match(bad.state().lastError, /image reference/)
})

test('covers are attached only when explicitly requested from the event query', async (t) => {
  let covers = 0
  const h = await createHost({ toolScript: async ({ call, requests }) => {
    if (requests.length === 1) await call('write_events', { changes: [create()] })
    else {
      const plain = await call('find_events', { query: 'LeetCode' })
      assert.equal(plain.events[0].cover, undefined)
      const found = await call('find_events', { ids: [plain.events[0].id], includeCover: true })
      assert.ok(found.events[0].cover)
      await call('write_events', { changes: [{ action: 'update', id: found.events[0].id, summary: '依据查询继续更新。' }] })
    }
  } }); t.after(h.dispose)
  const save = h.ctx.attachments.saveImage
  h.ctx.attachments.saveImage = async (args) => { if (args.name.endsWith('-cover.jpg')) covers++; return save(args) }
  await h.trail.manualCapture(); await h.settle(); assert.equal(covers, 0)
  await h.trail.manualCapture(); await h.settle(); assert.equal(covers, 1)
  assert.equal(h.state().records.length, 1); assert.equal(h.state().lastError, null)
})

test('a user deletion racing a commit cannot resurrect the event or delete an unrelated one', async (t) => {
  const h = await createHost({ toolScript: async ({ call, requests }) => {
    if (requests.length === 1) await call('write_events', { changes: [create('目标'), create('无关记录')] })
    else {
      const found = await call('find_events', { query: '目标' })
      await call('write_events', { changes: [{ action: 'update', id: found.events[0].id, summary: '修改目标。', images: [1] }] })
    }
  } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const id = h.state().records.find((item) => item.analysis.activity === '目标').id
  const rename = h.trail.io.rename; let release; let entered = false
  const gate = new Promise((resolve) => { release = resolve })
  h.trail.io.rename = async (...args) => {
    if (args[1] === h.trail.stateFile && !entered && JSON.parse(h.files.get(args[0])).activities.some((item) => item.analysis.summary === '修改目标。')) {
      entered = true; await gate
    }
    return rename(...args)
  }
  h.setScreen(255); await h.trail.manualCapture(); await h.settle(); assert.equal(entered, true)
  const removed = h.trail.remove(id)
  release(); await removed; await h.settle()
  assert.deepEqual(h.state().records.map((item) => item.analysis.activity), ['无关记录'])
  assert.deepEqual(JSON.parse(h.files.get(h.trail.stateFile)).activities.map((item) => item.analysis.activity), ['无关记录'])
})
