import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { registerRoutes } from '../index.js'
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
