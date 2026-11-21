import { ScreenTrail } from './trail.js'

export const inject = ['llm', 'webServer', 'attachments', 'agentDefaultModel', 'timer']
const prefix = '/screen-trail/api'

function send(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'cache-control': 'no-store', 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  response.end(body)
}

/** 插件接口独立于宿主登录门禁，同时检查连接、Host 与修改请求的来源。 */
function admit(request, response, mutation = false) {
  const host = String(request.headers.host || '')
  const name = host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.split(':')[0]
  const peer = request.socket?.remoteAddress
  const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer)
  let originMatches = true
  if (mutation && request.headers.origin) {
    try { originMatches = new URL(request.headers.origin).host === host } catch { originMatches = false }
  }
  if (local && ['localhost', '127.0.0.1', '::1'].includes(name) && originMatches) return true
  send(response, 403, { ok: false, error: 'local same-origin requests only' })
  return false
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let bytes = 0
    request.on('data', (chunk) => {
      bytes += chunk.length
      if (bytes > 65536) { reject(new Error('body too large')); return }
      chunks.push(chunk)
    })
    request.on('error', reject)
    request.on('end', () => {
      try {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
        if (!body || Array.isArray(body) || typeof body !== 'object') throw new Error('body must be a JSON object')
        resolve(body)
      } catch (error) { reject(error) }
    })
  })
}

export function apply(ctx, config = {}) {
  const trail = new ScreenTrail(ctx, config)
  registerRoutes(ctx, trail)
}

export function registerRoutes(ctx, trail) {
  const register = (path, handler) => ctx.effect(() => {
    const dispose = ctx.webServer.register({ kind: 'exact', path: `${prefix}/${path}`, handler })
    return () => { if (typeof dispose === 'function') dispose() }
  })
  register('state', (request, response) => {
    if (!admit(request, response)) return
    if (!['GET', 'HEAD'].includes(request.method)) { send(response, 405, { ok: false, error: 'method not allowed' }); return }
    send(response, 200, trail.state())
  })
  register('control', async (request, response) => {
    if (!admit(request, response, true)) return
    if (request.method !== 'POST') { send(response, 405, { ok: false, error: 'method not allowed' }); return }
    let body
    try { body = await readJson(request) } catch (error) { send(response, 400, { ok: false, error: error.message }); return }
    try {
      await trail.assertReady()
      switch (body.action) {
        case 'start': await trail.start(); break
        case 'stop': trail.pause(); await trail.persist(); break
        case 'capture': await trail.manualCapture(); break
        case 'analyzeNow':
          if (!trail.records.some((item) => item.analysisStatus === 'pending')) throw new Error('暂无待分析画面，请先切换到其他窗口采集')
          trail.analysisEnabled = true
          trail.pumpAnalysis(true)
          break
        case 'retryAnalysis':
          if (trail.analysisTask) throw new Error('analysis is already running')
          if (!trail.records.some((item) => item.analysisStatus === 'failed')) throw new Error('暂无失败的分析批次')
          for (const record of trail.records) if (record.analysisStatus === 'failed') { record.analysisStatus = 'pending'; record.analysisError = null }
          trail.status.lastError = null
          trail.analysisEnabled = true
          await trail.persist()
          trail.pumpAnalysis(true)
          break
        case 'clear': await trail.clear(); break
        case 'delete': await trail.remove(String(body.id || '')); await trail.persist(); break
        case 'setInterval': {
          const value = Number(body.intervalSec)
          if (!Number.isInteger(value) || value < 15 || value > 300) throw new Error('intervalSec must be an integer between 15 and 300')
          trail.settings.analysisWindowSec = value
          trail.pumpAnalysis()
          break
        }
        case 'openPermission': await trail.openPermission(body.permission || 'screen'); break
        default: send(response, 400, { ok: false, error: 'unknown action' }); return
      }
      send(response, 200, trail.state())
    } catch (error) {
      trail.fail(`control.${body.action}`, error)
      send(response, 500, { ok: false, error: trail.status.lastError })
    }
  })
  register('image', async (request, response) => {
    if (!admit(request, response)) return
    if (!['GET', 'HEAD'].includes(request.method)) { send(response, 405, { ok: false, error: 'method not allowed' }); return }
    try {
      const id = new URL(request.url || '/', 'http://localhost').searchParams.get('id') || ''
      const data = await trail.image(id)
      response.writeHead(200, { 'cache-control': 'private, max-age=300', 'content-type': 'image/jpeg', 'content-length': data.length })
      response.end(data)
    } catch (error) {
      if (error.code !== 'ENOENT') trail.fail('image.read', error)
      send(response, error.code === 'ENOENT' ? 404 : 500, { ok: false, error: error.message })
    }
  })
  ctx.effect(() => () => { void trail.dispose().catch((error) => trail.fail('shutdown', error)) })
}
