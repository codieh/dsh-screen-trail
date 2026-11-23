import assert from 'node:assert/strict'
import test from 'node:test'
import { createHost, root } from './harness.js'
import { representatives } from '../frames.js'

const goal = '在B站观看《中国奇谭2》第9话'
const browser = { app: 'Microsoft Edge', bundleId: 'com.microsoft.edgemac', pid: 1556, windowId: 194, title: '番剧详情' }
function activity(id, label, at) {
  const frame = { id: `frame-${id}`, imageId: `image-${id}`, at, lastSeenAt: at + 1000, context: browser }
  return { id: `activity-${id}`, at, lastSeenAt: frame.lastSeenAt, imageId: frame.imageId, context: browser,
    reason: 'activity', analysisStatus: 'complete', evidence: [frame], analysis: { activity: label, summary: label } }
}
const history = () => ({ version: 4, records: [], activities: [
  activity('playing', '继续观看《中国奇谭2》第9话', 1699999970000),
  activity('details', '浏览《中国奇谭2》详情页', 1699999960000),
  activity('opening', '打开《中国奇谭2》播放页', 1699999950000),
  activity('other', '购买键盘', 1699999940000),
] })

test('five minutes at the default sampling interval fit the pending capacity', async (t) => {
  const h = await createHost(); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  for (let i = 1; i < 60; i += 1) await h.frame(i % 2 ? 255 : 0, { elapsed: 5000 })
  assert.equal(h.state().observations.length, 60)
  assert.equal(h.state().pendingCapacity, 80)
  assert.equal(h.state().capturePaused, false); assert.equal(h.requests.length, 0)
  await h.advance(5000)
  assert.equal(h.requests.length, 1); assert.equal(h.requests[0].observations.length, 20)
  assert.equal(h.state().records.length, 1); assert.equal(h.state().unfinishedCount, 0)
  assert.equal(h.state().observations.length, 20)
  assert.ok(h.logs.some((line) => line.includes('observation.discarded')))
  await h.advance(299999); assert.equal(h.requests.length, 1)
})

test('uniform samples cover the full window rather than only early switches', () => {
  const records = Array.from({ length: 600 }, (_, index) => ({
    id: `frame-${index}`, imageId: `image-${index}`, at: index * 500, lastSeenAt: index * 500,
    reason: index < 100 ? 'context' : 'change', score: index < 100 ? 1 : 0.01,
  }))
  const selected = representatives(records, 20)
  assert.equal(selected.length, 20); assert.equal(selected[0], records[0]); assert.equal(selected.at(-1), records.at(-1))
  for (let minute = 0; minute < 5; minute += 1) assert.ok(selected.some((item) => item.at >= minute * 60000 && item.at < (minute + 1) * 60000))
  assert.deepEqual(representatives([...records].reverse(), 20), selected)
})

test('new resources and context changes do not alter uniform selection', () => {
  const records = Array.from({ length: 8 }, (_, i) => ({ id: `frame-${i}`, imageId: 'duplicate', at: i, reason: 'change', score: 1 }))
  const original = representatives(records, 4).map((item) => item.id)
  records[3].imageId = 'new-resource'; records[3].reason = 'context'; records[3].score = 100
  assert.deepEqual(representatives(records, 4).map((item) => item.id), original)
})

test('player, details and playback form one goal with phases and a meaningful cover', async (t) => {
  const h = await createHost({ reply: ({ observations }) => ({ activities: [{
    task: 0, goal, images: observations.map((item) => item.number), cover: observations.at(-1).number,
    activity: '观看《中国奇谭2》第9话', summary: '进入播放页、查看番剧详情，随后开始观看第9话。',
    details: ['打开播放页', '查看番剧详情', '播放第9话'],
  }] }) }); t.after(h.dispose)
  h.setScreen(0, { ...browser, title: '播放入口' }); await h.trail.start(); await h.settle()
  await h.frame(100, { context: browser, elapsed: 60000 })
  await h.frame(255, { context: { ...browser, title: '中国奇谭2第9集', windowId: 35144 }, elapsed: 60000 })
  await h.advance(180000)
  const record = h.state().records[0]
  assert.equal(h.requests.length, 1); assert.equal(h.state().records.length, 1)
  assert.equal(record.analysis.goal, goal); assert.equal(record.evidence.length, 3)
  assert.equal(record.context.windowId, 35144); assert.equal(record.analysis.details.length, 3)
  assert.match(h.requests[0].system, /Harness conversation/)
  assert.match(h.requests[0].system, /not a browsing history/)
})

test('one five-minute batch can produce multiple independent goals in the same browser', async (t) => {
  const h = await createHost({ reply: ({ observations }) => ({ activities: observations.map((item, index) => ({
    task: 0, images: [item.number], goal: index ? '购买键盘' : goal, activity: index ? '选购键盘' : '观看番剧', summary: '完成当前可见的独立活动。',
  })) }) }); t.after(h.dispose)
  h.setScreen(0, browser); await h.trail.start(); await h.settle()
  await h.frame(255, { context: { ...browser, title: '键盘商品详情' }, elapsed: 150000 }); await h.advance(150000)
  assert.equal(h.requests.length, 1); assert.equal(h.state().records.length, 2)
  assert.equal(new Set(h.state().records.map((item) => item.analysis.goal)).size, 2)
})

test('an existing goal continues across batches even when its phase label changes', async (t) => {
  const h = await createHost({ reply: ({ fixtureActivities: saved, observations, requests }) => ({ activities: [{
    task: saved[0]?.id ?? null, goal, images: observations.map((item) => item.number),
    activity: requests.length === 1 ? '选择《中国奇谭2》剧集' : '观看《中国奇谭2》第9话', summary: '选择剧集并开始观看。',
  }] }) }); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.advance(300000)
  const id = h.state().records[0].id
  await h.frame(255); await h.advance(300000)
  assert.equal(h.state().records.length, 1); assert.equal(h.state().records[0].id, id)
  assert.equal(h.state().lastAnalysis.decisions[0].activityId, id)
})

test('explicitly new work is not silently merged by a matching label and window', async (t) => {
  const h = await createHost({ reply: ({ observations, requests }) => ({ activities: [{
    task: 0, images: observations.map((item) => item.number), goal: `修复项目${requests.length}的登录问题`,
    activity: '修复登录问题', summary: '在当前项目中定位并修改登录逻辑。',
  }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle(); h.setScreen(255); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 2)
})

test('later evidence consolidates previously split phases while preserving an unrelated goal', async (t) => {
  const h = await createHost({ history: history(), reply: ({ fixtureActivities: saved, observations }) => ({ activities: [{
    task: saved.find((item) => item.activity.includes('打开')).id,
    mergeTasks: saved.filter((item) => /继续观看|浏览《/.test(item.activity)).map((item) => item.id),
    goal, images: observations.map((item) => item.number), cover: 1,
    activity: '观看《中国奇谭2》第9话', summary: '进入播放页并查看详情后，开始观看第9话。', details: ['进入播放页', '查看详情', '继续观看'],
  }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 2)
  const record = h.state().records.find((item) => item.id === 'activity-opening')
  assert.equal(record.analysis.goal, goal); assert.equal(record.at, 1699999950000)
  assert.equal(record.evidence.length, 4); assert.ok(h.state().records.some((item) => item.id === 'activity-other'))
  for (const frame of record.evidence) assert.ok((await h.trail.image(frame.id)).length)
  const stored = JSON.parse(h.files.get(`${root}/state.json`))
  assert.equal(stored.activities.length, 2)
  assert.ok(h.logs.some((line) => line.includes('activity.merged')))
  const diagnostic = JSON.parse(h.files.get(h.state().lastAnalysis.diagnosticFile))
  assert.deepEqual(new Set(diagnostic.decisions[0].mergeActivityIds), new Set(['activity-details', 'activity-playing']))
})

test('old fragmented goals may merge without inventing a new screenshot association', async (t) => {
  const h = await createHost({ history: history(), reply: ({ fixtureActivities: saved }) => ({ activities: [{
    task: saved.find((item) => item.activity.includes('打开')).id,
    mergeTasks: saved.filter((item) => /继续观看|浏览《/.test(item.activity)).map((item) => item.id),
    goal, images: [], cover: 0, activity: '观看《中国奇谭2》第9话', summary: '打开播放页、查看详情后观看同一剧集。',
  }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 2); assert.equal(h.state().observations.length, 0)
  assert.equal(h.state().records.find((item) => item.id === 'activity-opening').evidence.length, 3)
})

test('supporting lookup keeps the existing main goal and cover', async (t) => {
  const h = await createHost({ reply: ({ observations, fixtureActivities: saved }) => ({ activities: [{
    task: saved[0]?.id ?? null, goal: '修复支付接口超时', images: observations.map((item) => item.number), cover: saved.length ? 0 : 1,
    activity: '修复支付接口超时', summary: saved.length ? '编写修复代码，并查阅相关接口文档。' : '编写支付接口修复代码。',
  }] }) }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const main = { ...h.state().records[0] }
  h.setScreen(255, browser); await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().records[0].imageId, main.imageId)
  assert.deepEqual(h.state().records[0].context, main.context)
  assert.equal(h.state().records[0].evidence.length, 2)
})

test('discarding low-value observations does not delete an image referenced by a previous goal', async (t) => {
  const h = await createHost({ reply: ({ observations, requests }) => requests.length > 1 ? { activities: [] } : { activities: [{
    task: 0, goal: '阅读接口文档', images: observations.map((item) => item.number), activity: '阅读接口文档', summary: '查看接口定义。',
  }] } }); t.after(h.dispose)
  await h.trail.manualCapture(); await h.settle()
  const main = { ...h.state().records[0] }
  await h.trail.manualCapture(); await h.settle()
  assert.equal(h.state().records.length, 1); assert.equal(h.state().observations.length, 1)
  assert.equal(h.state().unfinishedCount, 0); assert.ok((await h.trail.image(main.id)).length)
})

test('discarded latest pixels cannot extend the time of an older activity in the same window', async (t) => {
  const h = await createHost({ reply: ({ observations, requests }) => requests.length > 1 ? { activities: [] } : { activities: [{
    task: 0, goal: '阅读接口文档', images: observations.map((item) => item.number), activity: '阅读接口文档', summary: '查看接口定义。',
  }] } }); t.after(h.dispose)
  await h.trail.start(); await h.settle(); await h.advance(300000)
  const end = h.state().records[0].lastSeenAt
  await h.frame(255); await h.advance(300000); await h.presence()
  assert.equal(h.state().records[0].lastSeenAt, end)
  await h.frame(255)
  assert.equal(h.state().unfinishedCount, 1)
  assert.notEqual(h.state().observations[0].imageId, h.state().records[0].imageId)
})

test('invalid stable references or merge contracts fail visibly and retain evidence for explicit retry', async (t) => {
  const replies = [
    {},
    { activities: [{ task: 1, images: [1], activity: '观看', summary: '旧的临时编号。' }] },
    { activities: [{ task: 'activity-opening', mergeTasks: ['activity-missing'], images: [1], goal, activity: '观看', summary: '错误合并编号。' }] },
    { activities: [{ task: null, mergeTasks: ['activity-opening'], images: [1], goal, activity: '观看', summary: '没有已有主事件。' }] },
    { activities: [{ task: 'activity-opening', images: [1], cover: 2, goal, activity: '观看', summary: '错误封面编号。' }] },
    { activities: [1, 1].map(() => ({ task: 'activity-opening', images: [1], goal, activity: '观看', summary: '同一事件被重复处理。' })) },
  ]
  for (const reply of replies) {
    const h = await createHost({ history: history(), reply }); t.after(h.dispose)
    await h.trail.manualCapture(); await h.settle()
    assert.equal(h.state().records.length, 4); assert.equal(h.state().observations[0].analysisStatus, 'failed')
    assert.ok(h.state().lastError); assert.equal(h.state().lastAnalysis.outcome, 'failed')
  }
})

test('the retained cover remains in evidence when a large merged goal exceeds twelve images', async (t) => {
  const h = await createHost({ reply: ({ observations }) => ({ activities: [{
    task: 0, goal, images: observations.map((item) => item.number), cover: 2, activity: '观看番剧', summary: '观看同一剧集。',
  }] }) }); t.after(h.dispose)
  await h.trail.start(); await h.settle()
  for (let i = 1; i < 20; i += 1) await h.frame(i % 2 ? 255 : 0, { context: { ...browser, title: `页面${i}` }, elapsed: 15000 })
  await h.advance(15000)
  const record = h.state().records[0]
  assert.equal(record.evidence.length, 12)
  assert.ok(record.evidence.some((frame) => frame.id === h.state().lastAnalysis.decisions[0].coverObservationId))
  assert.ok((await h.trail.image(record.id)).length)
})
