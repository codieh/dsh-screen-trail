import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { registerRoutes } from '../dist/index.js'
import { createHost } from './harness.js'

async function apiHost(t, options) {
  const host = await createHost(options)
  t.after(host.dispose)
  const routes = new Map()
  registerRoutes({ effect: (fn) => fn(), webServer: { register: (route) => { routes.set(route.path, route.handler); return () => {} } } }, host.trail)
  return { ...host, request: async (endpoint, { method = 'GET', body, origin = 'http://localhost', peer = '127.0.0.1', query = '' } = {}) => {
    const req = new EventEmitter()
    req.method = method
    req.url = `/screen-trail/api/${endpoint}${query}`
    req.headers = { host: 'localhost', origin }
    req.socket = { remoteAddress: peer }
    const response = { writeHead(code) { this.code = code }, end(data) { this.data = data } }
    const pending = routes.get(`/screen-trail/api/${endpoint}`)(req, response)
    if (body !== undefined) { req.emit('data', Buffer.from(JSON.stringify(body))); req.emit('end') }
    await pending
    return response
  } }
}

test('existing API returns new state and serves shared images through observation IDs', async (t) => {
  const host = await apiHost(t)
  const capture = await host.request('control', { method: 'POST', body: { action: 'capture' } })
  assert.equal(capture.code, 200)
  const record = JSON.parse(capture.data).observations[0]
  const image = await host.request('image', { query: `?id=${record.id}` })
  assert.equal(image.code, 200)
  assert.ok(image.data.includes(Buffer.from('jpeg 0')))
  const state = await host.request('state')
  assert.equal(JSON.parse(state.data).captureSource, 'stopped')
})

test('API rejects remote, cross-origin and malformed control requests', async (t) => {
  const host = await apiHost(t)
  assert.equal((await host.request('state', { peer: '10.0.0.1' })).code, 403)
  assert.equal((await host.request('control', { method: 'POST', origin: 'https://evil.test', body: { action: 'start' } })).code, 403)
  assert.equal((await host.request('control', { method: 'POST', body: null })).code, 400)
})

test('state contains no event history and the date endpoint validates dates and pages', async (t) => {
  const host = await apiHost(t)
  await host.trail.manualCapture(); await host.settle()
  const state = JSON.parse((await host.request('state')).data)
  assert.equal('records' in state, false); assert.equal(state.activityCount, 1); assert.ok(state.eventsRevision > 0)
  const day = JSON.parse((await host.request('events', { query: '?date=2023-11-15&limit=1' })).data)
  assert.equal(day.records.length, 1); assert.equal(day.nextCursor, null)
  assert.equal(JSON.parse((await host.request('events', { query: '?date=2023-11-16' })).data).total, 0)
  for (const query of ['', '?date=2026-02-30', '?date=2023-11-15&limit=0', '?date=2023-11-15&cursor=bad']) {
    assert.equal((await host.request('events', { query })).code, 400, query)
  }
  assert.equal((await host.request('events', { peer: '10.0.0.1', query: '?date=2023-11-15' })).code, 403)
})

test('model catalog and details expose host metadata without a generation request', async (t) => {
  const host = await apiHost(t, { modelInfo: { inputModalities: ['image'], reasoning: { defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'high' }] } } })
  host.ctx.llm.listModels = async () => [{ id: 'vision', name: 'Vision', inputModalities: ['image'] }, { id: 'text-only', name: 'Text', inputModalities: ['text'] }]
  const models = JSON.parse((await host.request('models')).data)
  assert.equal(models.models.length, 1)
  assert.equal(models.models[0].model, 'vision')
  const info = JSON.parse((await host.request('model-info', { query: '?provider=mock&model=vision' })).data)
  assert.deepEqual(info.efforts.map((item) => item.id), ['low', 'high'])
  assert.equal(info.defaultEffort, 'low'); assert.equal(host.requests.length, 0)
  assert.equal((await host.request('models', { peer: '10.0.0.1' })).code, 403)
})

test('model settings are not published when persistence fails', async (t) => {
  const host = await apiHost(t)
  await host.trail.persist()
  const previous = host.state().modelSettings
  const set = host.trail.store.setSetting.bind(host.trail.store)
  host.trail.store.setSetting = (key, value) => { set(key, value); if (key === 'modelSettings') throw new Error('settings disk failed') }
  const response = await host.request('control', { method: 'POST', body: { action: 'setModelSettings',
    settings: { provider: 'mock', model: 'vision', reasoningEffort: null } } })
  assert.equal(response.code, 500)
  assert.deepEqual(host.state().modelSettings, previous)
  assert.equal(host.trail.store.setting('modelSettings'), undefined)
  assert.equal(host.requests.length, 0)
})

test('model settings persist across restart and validate supported reasoning', async (t) => {
  const options = { modelInfo: { inputModalities: ['image'], reasoning: { defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'high' }] } } }
  const host = await apiHost(t, options)
  const prefs = { provider: 'mock', model: 'vision', reasoningEffort: 'high' }
  const saved = await host.request('control', { method: 'POST', body: { action: 'setModelSettings', settings: prefs } })
  assert.equal(saved.code, 200); assert.deepEqual(JSON.parse(saved.data).modelSettings, prefs)
  const history = host.snapshot()
  const restored = await createHost({ ...options, history, config: { analysisReasoningEffort: 'low' } }); t.after(restored.dispose)
  assert.deepEqual(restored.state().modelSettings, prefs)
  await host.trail.manualCapture(); await host.settle()
  assert.equal(host.requests[0].reasoningEffort, 'high')
  const invalid = await host.request('control', { method: 'POST', body: { action: 'setModelSettings', settings: { ...prefs, reasoningEffort: 'unsupported' } } })
  assert.equal(invalid.code, 500); assert.deepEqual(host.state().modelSettings, prefs)
})

test('saving model preferences does not cancel or change the running analysis', async (t) => {
  const host = await apiHost(t, { hold: true, config: { analysisReasoningEffort: 'low' },
    modelInfo: { inputModalities: ['image'], reasoning: { efforts: [{ id: 'low' }, { id: 'high' }], defaultEffort: 'high' } } })
  await host.trail.manualCapture(); await host.settle()
  await host.trail.setModelSettings({ provider: 'mock', model: 'another-vision', reasoningEffort: 'high' })
  assert.equal(host.trail.controller.signal.aborted, false)
  assert.equal(host.requests[0].model, 'vision'); assert.equal(host.requests[0].reasoningEffort, 'low')
  host.release(); await host.settle()
  await host.trail.manualCapture(); await host.settle()
  assert.equal(host.requests[1].model, 'another-vision'); assert.equal(host.requests[1].reasoningEffort, 'high')
})

test('model-default reasoning can be selected and clearing captures preserves model settings', async (t) => {
  const host = await apiHost(t, { config: { analysisReasoningEffort: 'high' }, modelInfo: {
    inputModalities: ['image'], reasoning: { defaultEffort: 'low', efforts: [{ id: 'low' }, { id: 'high' }] } } })
  const prefs = { provider: '', model: '', reasoningEffort: null }
  await host.trail.setModelSettings(prefs)
  await host.trail.manualCapture(); await host.settle()
  assert.equal(host.requests[0].reasoningEffort, 'low')
  await host.trail.clear()
  assert.deepEqual(host.state().modelSettings, prefs)
  assert.deepEqual(host.trail.store.setting('modelSettings'), prefs)
})

test('sampling interval control persists seconds and rejects invalid input', async (t) => {
  const host = await apiHost(t)
  const response = await host.request('control', { method: 'POST', body: { action: 'setSampleInterval', intervalSec: 15 } })
  assert.equal(response.code, 200)
  assert.equal(JSON.parse(response.data).sampleIntervalSec, 15)
  const history = host.snapshot()
  assert.equal(history.sampleIntervalSec, 15)
  const restored = await createHost({ history }); t.after(restored.dispose)
  assert.equal(restored.state().sampleIntervalSec, 15)
  const invalid = await host.request('control', { method: 'POST', body: { action: 'setSampleInterval', intervalSec: 0 } })
  assert.equal(invalid.code, 500)
  assert.equal(host.state().sampleIntervalSec, 15)
})

test('analysis window settings persist in SQLite independently of sampling', async (t) => {
  const host = await apiHost(t)
  const response = await host.request('control', { method: 'POST', body: { action: 'setInterval', intervalSec: 120 } })
  assert.equal(response.code, 200); assert.equal(host.trail.store.setting('analysisWindowSec'), 120)
  const restored = await createHost({ history: host.snapshot() }); t.after(restored.dispose)
  assert.equal(restored.state().analysisWindowSec, 120); assert.equal(restored.state().sampleIntervalSec, 5)
})

test('changing sampling interval does not cancel in-flight analysis', async (t) => {
  const host = await apiHost(t, { hold: true })
  await host.trail.start(); await host.advance(300000)
  assert.equal(host.state().analyzing, true)
  await host.trail.setSampleInterval(10)
  assert.equal(host.state().running, true)
  assert.equal(host.state().analyzing, true)
  assert.equal(host.trail.controller.signal.aborted, false)
  host.release(); await host.settle()
  assert.equal(host.state().records.length, 1)
  assert.equal(host.state().lastError, null)
})

test('manual analysis processes queued images without capturing the recorder page', async (t) => {
  const host = await apiHost(t)
  await host.request('control', { method: 'POST', body: { action: 'start' } }); await host.settle()
  const count = host.state().captures
  await host.request('control', { method: 'POST', body: { action: 'analyzeNow' } }); await host.settle()
  assert.equal(host.state().captures, count); assert.equal(host.state().records.length, 1)
})

test('retry is explicit and reuses failed evidence instead of taking another screenshot', async (t) => {
  const host = await apiHost(t, { reply: ({ observations, requests }) => requests.length === 1 ? '{' : {
    activities: [{ task: 0, images: observations.map((item) => item.number), goal: '阅读当前资料', activity: '阅读', summary: '重新分析已有证据。' }] } })
  await host.request('control', { method: 'POST', body: { action: 'capture' } }); await host.settle()
  assert.equal(host.state().observations[0].analysisStatus, 'failed')
  const count = host.state().captures
  await host.request('control', { method: 'POST', body: { action: 'retryAnalysis' } }); await host.settle()
  assert.equal(host.state().captures, count); assert.equal(host.state().records.length, 1); assert.equal(host.requests.length, 2)
})
