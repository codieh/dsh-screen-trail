import { createHash } from 'node:crypto'
import { ScreenTrail } from '../trail.js'

export const root = '/virtual-home/.dsh/screen-trail'
export const settle = async () => { for (let i = 0; i < 32; i += 1) await new Promise(setImmediate) }
export function makeFrame(value, context, at) {
  const jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.from(`jpeg ${value}`), Buffer.from([255, 217])])
  return { jpeg, imageId: createHash('sha256').update(jpeg).digest('hex'), at, context,
    thumbnail: { width: 16, height: 16, pixels: new Uint8Array(256).fill(value), rgb: new Uint8Array(768).fill(value) } }
}

/** 所有屏幕帧、时钟、磁盘和模型都注入，回归测试不会读取真实桌面或调用云端。 */
export async function createHost({ hold = false, reply, corrupt = false, writeError = false, history, captureError, captureGate,
  finishReason = { kind: 'stop' }, usage = { inputTokens: 100, outputTokens: 200 }, modelInfo = { inputModalities: ['image'] }, config = {} } = {}) {
  const files = new Map(); const removed = []; const requests = []; const logs = []; const commands = []; const timers = new Map()
  let now = 1700000000000; let seq = 0; let timerSeq = 0; let screenValue = 0
  let currentContext = { app: 'Editor', bundleId: 'test.editor', pid: 1, windowId: 1, title: 'A', url: 'https://test/A' }
  let source; let release
  const gate = new Promise((resolve) => { release = resolve })
  if (corrupt) files.set(`${root}/state.json`, '{broken json')
  if (history) {
    files.set(`${root}/state.json`, JSON.stringify(history))
    for (const item of [...history.records, ...(history.activities || []).flatMap((activity) => activity.evidence)]) files.set(`${root}/shots/${item.imageId || item.id}.jpg`, Buffer.from('legacy jpeg'))
  }
  const missing = (file) => Object.assign(new Error(`missing ${file}`), { code: 'ENOENT' })
  const io = {
    mkdir: async () => {},
    readFile: async (file) => { if (!files.has(file)) throw missing(file); return files.get(file) },
    access: async (file) => { if (!files.has(file)) throw missing(file) },
    readdir: async (directory) => [...files.keys()].filter((file) => file.startsWith(`${directory}/`)).map((file) => file.slice(directory.length + 1)).filter((name) => !name.includes('/')),
    writeFile: async (file, body) => { if (writeError) throw new Error('disk write failed'); files.set(file, body) },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from) },
    rm: async (file, options) => { removed.push(file); for (const key of files.keys()) if (key === file || (options?.recursive && key.startsWith(`${file}/`))) files.delete(key) },
  }
  const ctx = {
    logger: { info: (value) => logs.push(value), error: (value) => logs.push(value) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'vision' }) },
    attachments: { saveImage: async ({ name }) => ({ id: name }) },
    llm: {
      resolveModelInfo: async () => modelInfo,
      stream: async function* (request) {
        const text = request.messages[0].content[0].text.split('\n')
        const observations = JSON.parse(text.find((line) => line.startsWith('Observations in time order: ')).slice('Observations in time order: '.length))
        const timeline = JSON.parse(text.find((line) => line.startsWith('Batch timeline (all observations): ')).slice('Batch timeline (all observations): '.length))
        const recent = JSON.parse(text.find((line) => line.startsWith('Recent activities: ')).slice('Recent activities: '.length))
        requests.push({ ...request, at: now, observations, timeline, recent })
        if (hold) await gate
        const result = reply === undefined ? { activities: [{ task: recent[0]?.number || 0,
          images: observations.map((item) => item.number), goal: '完成项目代码修改与验证', activity: '编写代码', summary: `第 ${requests.length} 次请求整理活动`, change: '修改并验证代码。' }] }
          : typeof reply === 'function' ? reply({ observations, timeline, recent, requests }) : reply
        yield { type: 'text-delta', index: 0, text: typeof result === 'string' ? result : JSON.stringify(result) }
        if (usage) yield { type: 'usage', usage }
        if (finishReason) yield { type: 'finish', reason: finishReason }
      },
    },
  }
  const trail = new ScreenTrail(ctx, config, { fs: io, home: '/virtual-home', now: () => now,
    uuid: () => `${String(++seq).padStart(8, '0')}-0000-4000-8000-000000000000`,
    setTimer: (fn, ms) => { const id = ++timerSeq; timers.set(id, { at: now + ms, fn }); return id }, clearTimer: (id) => timers.delete(id),
    run: async (command, args) => { commands.push({ command, args }); return '' },
    createCapture: (options) => {
      source = { state: 'stopped',
        start: async () => {
          if (captureGate) { const wait = captureGate; captureGate = null; await wait }
          if (captureError) { source.state = 'failed'; throw new Error(captureError) }
          source.state = 'ready'; options.onFrame(makeFrame(screenValue, currentContext, now))
        },
        stop: () => { if (source.state !== 'failed') source.state = 'stopped' },
        once: async () => {
          if (captureError) throw new Error(captureError)
          if (currentContext.title.includes('[dsh-screen-trail]')) throw new Error('纪事自身页面已排除')
          return makeFrame(screenValue, currentContext, now)
        },
        emit: () => { if (source.state === 'ready') options.onFrame(makeFrame(screenValue, currentContext, now)) },
        presence: (type = 'idle') => options.onPresence({ type, at: now, context: currentContext }),
        lifecycle: (type) => { source.state = type === 'ready' ? 'ready' : 'waiting'; options.onPresence({ type, at: now, reason: 'test-screen-event' }) },
      }
      return source
    },
  })
  await trail.ready
  return { trail, ctx, files, removed, requests, logs, commands, release, source, settle,
    state: () => trail.state(),
    setScreen: (value, context = currentContext) => { screenValue = value; currentContext = { ...context } },
    frame: async (value = screenValue, { context = currentContext, elapsed = 500 } = {}) => {
      now += elapsed; screenValue = value; currentContext = { ...context }; source.emit(); await settle()
    },
    presence: async (type = 'idle', elapsed = 500) => { now += elapsed; source.presence(type); await settle() },
    advance: async (ms, { value = screenValue, poll = false } = {}) => {
      screenValue = value; const target = now + ms; let count = 0
      while (true) {
        const entry = [...timers].filter(([, item]) => item.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry) break
        if (++count > 1000) throw new Error('timer loop in test')
        now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await settle()
      }
      now = target; if (poll) source.emit(); await settle()
    },
    dispose: async () => { release(); await trail.dispose(); await settle() },
  }
}
