import { createHash } from 'node:crypto'
import { ScreenTrail } from '../trail.js'
import { JournalStore } from '../storage.js'

export const root = '/virtual-home/.dsh/screen-trail'
export const settle = async () => { for (let i = 0; i < 32; i += 1) await new Promise(setImmediate) }
export function makeFrame(value, context, at) {
  const jpeg = Buffer.concat([Buffer.from([255, 216]), Buffer.from(`jpeg ${value}`), Buffer.from([255, 217])])
  return { jpeg, imageId: createHash('sha256').update(jpeg).digest('hex'), at, context,
    thumbnail: { width: 16, height: 16, pixels: new Uint8Array(256).fill(value), rgb: new Uint8Array(768).fill(value) } }
}

/** 所有屏幕帧、时钟、磁盘和模型都注入，回归测试不会读取真实桌面或调用云端。 */
export async function createHost({ hold = false, reply, toolScript, corrupt = false, writeError = false, history, legacyHistory, captureError, captureGate, conversations = new Map(), workspaces = new Map(), workspaceError, startAt = 1700000000000,
  finishReason = { kind: 'stop' }, usage = { inputTokens: 100, outputTokens: 200 }, modelInfo = { inputModalities: ['image'] }, defaultPreset = 'standard',
  presetDefinitions = new Map([['standard', { compaction: { config: { auto: true }, compactIfNeeded: () => { throw new Error('compaction belongs to the host loop') } } }]]), config = {} } = {}) {
  const files = new Map(); const removed = []; const requests = []; const logs = []; const commands = []; const timers = new Map()
  const liveAgents = new Map(); const createdSessions = []; const resumedSessions = []; const flushedSessions = []
  const sessionListeners = new Set(); const registeredTools = new Map(); let toolCallId = 0
  const presetBindings = new WeakMap(); const mountedPresets = []
  let now = startAt; let seq = conversations.size * 10000; let timerSeq = 0; let screenValue = 0
  let currentContext = { app: 'Editor', bundleId: 'test.editor', pid: 1, windowId: 1, title: 'A', url: 'https://test/A' }
  let source; let release; let closedSnapshot
  const gate = new Promise((resolve) => { release = resolve })
  if (corrupt) files.set(`${root}/state.json`, '{broken json')
  const seed = legacyHistory || history
  if (legacyHistory) files.set(`${root}/state.json`, JSON.stringify(legacyHistory))
  if (seed) {
    for (const item of [...seed.records, ...(seed.activities || []).flatMap((activity) => activity.evidence)]) files.set(`${root}/shots/${item.imageId || item.id}.jpg`, Buffer.from('legacy jpeg'))
  }
  const missing = (file) => Object.assign(new Error(`missing ${file}`), { code: 'ENOENT' })
  const io = {
    mkdir: async () => {},
    chmod: async () => {},
    readFile: async (file) => { if (!files.has(file)) throw missing(file); return files.get(file) },
    access: async (file) => { if (!files.has(file)) throw missing(file) },
    readdir: async (directory) => [...files.keys()].filter((file) => file.startsWith(`${directory}/`)).map((file) => file.slice(directory.length + 1)).filter((name) => !name.includes('/')),
    writeFile: async (file, body) => { if (writeError && !file.endsWith('journal.sqlite')) throw new Error('disk write failed'); files.set(file, body) },
    rename: async (from, to) => { files.set(to, files.get(from)); files.delete(from) },
    rm: async (file, options) => { removed.push(file); for (const key of files.keys()) if (key === file || (options?.recursive && key.startsWith(`${file}/`))) files.delete(key) },
  }
  const ctx = {
    tools: { register: (definition) => { registeredTools.set(definition.name, definition); return () => registeredTools.delete(definition.name) } },
    on: (name, fn) => {
      if (name !== 'session/event') throw new Error(`unexpected host event ${name}`)
      sessionListeners.add(fn); return () => sessionListeners.delete(fn)
    },
    logger: { info: (value) => logs.push(value), error: (value) => logs.push(value) },
    agentDefaultModel: { currentSelection: () => ({ provider: 'mock', model: 'vision' }) },
    attachments: { saveImage: async ({ name }) => ({ id: name }) },
    llm: {
      listProviders: () => [{ id: 'mock', name: 'Mock' }],
      listModels: async () => [{ provider: 'mock', id: 'vision', name: 'Vision', inputModalities: ['image'] }],
      resolveModelInfo: async () => modelInfo,
      stream: async function* (request) {
        const input = request.messages.findLast((message) => message.role === 'user'
          && message.content.some((item) => item.type === 'text' && item.text.includes('Observations in time order: ')))
        if (!input) throw new Error('analysis input is missing observations')
        const text = input.content.find((item) => item.type === 'text' && item.text.includes('Observations in time order: ')).text.split('\n')
        const observations = JSON.parse(text.find((line) => line.startsWith('Observations in time order: ')).slice('Observations in time order: '.length))
        requests.push({ ...request, at: now, observations })
        // 仅供预设回复构造合法引用，不属于模型请求；这些测试不验证模型能否自行获知事件 ID。
        const fixtureActivities = trail.activities.map((item) => ({ id: item.id, activity: item.analysis.activity }))
        if (hold) {
          let aborted
          try {
            await Promise.race([gate, new Promise((_, reject) => {
              aborted = () => reject(request.signal.reason || new Error('cancelled'))
              request.signal.addEventListener('abort', aborted, { once: true })
              if (request.signal.aborted) aborted()
            })])
          } finally { request.signal.removeEventListener('abort', aborted) }
        }
        const receiptMessage = request.messages.findLast((message) => message.role === 'tool')
        const previousId = receiptMessage ? JSON.parse(receiptMessage.content[0].text).events?.[0]?.id : null
        const result = reply === undefined ? { activities: [{ task: previousId ?? null,
          images: observations.map((item) => item.number), goal: '完成项目代码修改与验证', activity: '编写代码', summary: `第 ${requests.length} 次请求整理活动`, change: '修改并验证代码。' }] }
          : typeof reply === 'function' ? reply({ observations, fixtureActivities, requests }) : reply
        yield { type: 'text-delta', index: 0, text: typeof result === 'string' ? result : JSON.stringify(result) }
        // 旧测试的数据只用于构造模型工具调用，生产代码不从聊天 JSON 推导写入。
        if (toolScript === undefined) {
          let argumentsText
          try {
            const parsed = typeof result === 'string' ? JSON.parse(result) : result
            argumentsText = JSON.stringify({ changes: parsed.activities.map((item) => {
              const { task, mergeTasks, ...fields } = item
              return { ...fields, action: task ? (mergeTasks?.length ? 'merge' : 'update') : 'create',
                ...(task ? { id: task } : {}), ...(mergeTasks?.length ? { mergeIds: mergeTasks } : {}) }
            }) })
          } catch { argumentsText = typeof result === 'string' ? result : JSON.stringify(result) }
          yield { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'fixture-write', name: 'screen_trail_write_events', arguments: argumentsText } }
        }
        if (usage) yield { type: 'usage', usage }
        if (finishReason) yield { type: 'finish', reason: finishReason }
      },
    },
  }
  // 模拟宿主原生 Agent 契约：先持久化输入，再执行真实流并记录原始回复；不调用云端。
  const attachAgent = (session, options = {}) => {
    const listeners = new Map(); let system = ''; let active; let controller; let selected = { ...options }; let streamRevision = 0
    const emit = (name, payload) => { for (const fn of listeners.get(name) || []) fn({ agent, ...payload }) }
    const append = (type, data) => {
      const event = { seq: session.events.length, time: now, type, data: structuredClone(data) }
      session.events.push(event); for (const fn of sessionListeners) fn(session, event); return event
    }
    session.append = append
    const agent = { id: session.id, session, status: 'idle', options, toolRestriction: null, toolGuard: null,
      model: { select: (selection) => { selected = { ...selection }; append('model/selection', selection) } },
      ctx: {
        // 与真实预设隔离组一致：普通上下文查找看不到内部 compaction。
        get: () => undefined,
        on: (name, fn) => {
          if (!listeners.has(name)) listeners.set(name, new Set())
          listeners.get(name).add(fn); return () => listeners.get(name).delete(fn)
        },
        systemPrompt: { section: (section) => { const previous = system; system = section.text; return () => { system = previous } } },
        tools: {
          register: (definition) => { registeredTools.set(definition.name, definition); return () => registeredTools.delete(definition.name) },
          setExecutor: (executor) => { agent.executor = executor; return () => { agent.executor = null } },
          restrict: (filter) => { agent.toolRestriction = filter; return () => { agent.toolRestriction = null } },
          guard: (fn) => { agent.toolGuard = fn; return () => { agent.toolGuard = null } },
        },
      },
      followup: (message) => {
        if (agent.status !== 'idle') throw new Error('agent busy')
        agent.status = 'running'; controller = new AbortController()
        active = (async () => {
          const turn = session.events.filter((event) => event.type === 'turn/start').length + 1
          append('turn/start', { turn }); emit('agent/inbox/claimed', { message, turn })
          append('user/message', message)
          const chunks = []; const calls = []; let raw = ''
          let reason = { kind: 'completed' }
          const revision = ++streamRevision; const attemptId = `attempt-${session.id}-${turn}-${revision}`
          let streamIndex = 0; let settlement
          let started = false
          try {
            await presetBindings.get(agent.ctx)?.definition.beforeStep?.({ agent, append, turn })
            controller.signal.throwIfAborted()
            const messages = session.messages()
            session.contextWindow = 1048576
            started = true
            emit('agent/assistant-stream', { frame: { type: 'start', attemptId, revision, turn, step: 1 } })
            for await (const chunk of ctx.llm.stream({ ...selected, system, messages, maxTokens: options.maxTokens, sessionId: session.id, signal: controller.signal })) {
              chunks.push(chunk); if (chunk.type === 'text-delta') raw += chunk.text
              if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') calls.push(chunk.block)
              emit('agent/assistant-stream', { frame: { type: 'chunk', attemptId, revision, index: streamIndex++, time: now, chunk } })
            }
            settlement = append('assistant/message', { role: 'assistant', content: [{ type: 'text', text: raw }], chunks })
            const call = async (name, args, callOptions = {}) => {
              if (['find_events', 'write_events'].includes(name)) name = `screen_trail_${name}`
              const denied = agent.toolGuard?.({ name })
              if (denied) throw new Error(denied)
              const definition = registeredTools.get(name)
              if (!definition) throw new Error(`unknown tool: ${name}`)
              const value = await definition.execute(args, { agent, callId: callOptions.callId ?? `call-${++toolCallId}`, signal: controller.signal, concludeTurn: () => { agent.concluded = true } })
              append('tool/result', { role: 'tool', content: [{ type: 'text', text: JSON.stringify(value) }] })
              return value
            }
            if (finishReason?.kind === 'stop' || finishReason?.kind === 'tool-calls') {
              if (typeof toolScript === 'function') await toolScript({ call, agent, requests })
              else if (toolScript !== false) for (const item of calls) await call(item.name, JSON.parse(item.arguments))
            }
          } catch (error) {
            settlement = append('assistant/attempt', { message: String(error.message || error), chunks })
            reason = { kind: 'failed' }; emit('agent/error', { error, turn })
          } finally {
            if (started) emit('agent/assistant-stream', { frame: { type: 'end', attemptId, revision, index: streamIndex,
              outcome: { kind: 'committed', eventType: settlement.type, seq: settlement.seq } } })
            append('turn/end', { turn, reason }); agent.status = 'idle'
          }
        })()
      },
      whenIdle: async () => { await active },
      cancel: () => controller?.abort(new Error('native agent cancelled')),
    }
    session.messages = () => {
      const events = session.events.filter((event) => ['user/message', 'assistant/message', 'tool/result'].includes(event.type)
        && (session.compactThrough === undefined || event.seq > session.compactThrough))
      return [...(session.compactedSummary ? [session.compactedSummary] : []), ...events.map((event) => event.data)]
    }
    liveAgents.set(session.id, agent)
    return { agent, dispose: async () => { agent.cancel(); await agent.whenIdle(); presetBindings.delete(agent.ctx); liveAgents.delete(agent.id) } }
  }
  ctx.agentPresets = {
    defaultId: defaultPreset,
    resolve: async (id = ctx.agentPresets.defaultId) => {
      if (!presetDefinitions.has(id)) throw new Error(`agent preset not found: ${id}`)
      return { id }
    },
    mount: async (agentCtx, id = ctx.agentPresets.defaultId) => {
      await ctx.agentPresets.resolve(id)
      presetBindings.set(agentCtx, { id, definition: presetDefinitions.get(id) }); mountedPresets.push(id)
      return { id }
    },
    composedPreset: (agentCtx) => presetBindings.get(agentCtx)?.id,
    serviceFor: (agent, name) => presetBindings.get(agent.ctx)?.definition[name],
    presetForSession: (session) => session.events.findLast((event) => event.type === 'agent-preset/selected')?.data.agentPreset ?? session.agentPreset ?? null,
  }
  ctx.tokenMeter = {
    measure: (session) => {
      const surfaceTokens = session.measuredTokens ?? Math.ceil(JSON.stringify(session.messages()).length / 4)
      return { totalTokens: surfaceTokens, surfaceTokens }
    },
    contextPressure: (session) => session.contextWindow === undefined ? {} : { contextWindow: session.contextWindow },
  }
  ctx.workingDirectory = { defaultDirectory: '/workspace' }
  ctx.loader = { import: async (name) => {
    if (name !== '@deepseek-ai/dsh-tool-executor-native') throw new Error(`unexpected module: ${name}`)
    return { NativeToolExecutor: class {} }
  } }
  ctx.workspaceRegistry = { create: async (directory, title) => {
    if (workspaceError) throw new Error(workspaceError)
    if (!workspaces.has(directory)) {
      const workspace = { id: `workspace-${workspaces.size + 1}`, path: directory, title, sessionIds: [],
        attachSession: async (id) => {
          const session = conversations.get(id)
          if (!session || session.cwd !== workspace.path) throw new Error('session cwd does not match workspace')
          if (!workspace.sessionIds.includes(id)) workspace.sessionIds.unshift(id)
        },
      }
      workspaces.set(directory, workspace)
    }
    return workspaces.get(directory)
  } }
  ctx.sessions = { get: (id) => liveAgents.get(id)?.session, flush: async (session) => { flushedSessions.push(session.id) } }
  ctx.sessionPersistence = { stat: async (id) => {
    const session = conversations.get(id)
    if (!session) throw new Error('session not found')
    return { header: { version: 4, id, cwd: session.cwd, agentPreset: session.agentPreset, createdAt: session.createdAt, isSeeded: false, delegationDepth: 0 } }
  } }
  ctx.sessionQuery = { listEvents: async (id) => {
    const session = conversations.get(id)
    if (!session) throw new Error('session not found')
    return session.events.map(({ seq, time, type }) => ({ seq, time, type }))
  }, inspectSession: async (id, read) => {
    const session = conversations.get(id)
    if (!session) throw new Error('session not found')
    return read(session)
  } }
  ctx.sessionTitle = { rename: (session, title) => { session.title = title; session.append('session/title', { title }) } }
  ctx.agents = {
    turnBoundaryOf: (session) => ({ lastTurn: (session.events || []).filter((event) => event.type === 'turn/start').length, lastStepStartSeq: 0 }),
    get: (id) => liveAgents.get(id),
    create: async (options) => {
      if (options.signal?.aborted) throw options.signal.reason
      const session = { id: options.sessionId, cwd: options.meta.cwd, agentPreset: options.meta.agentPreset, createdAt: now, events: [] }
      if (conversations.has(session.id)) throw new Error('duplicate session id')
      conversations.set(session.id, session); createdSessions.push(session.id)
      const handle = attachAgent(session, options.agentOptions)
      try { await options.setup?.(handle.agent.ctx, handle.agent) }
      catch (error) { await handle.dispose(); throw error }
      return handle
    },
    resume: async (options) => {
      if (options.signal?.aborted) throw options.signal.reason
      const session = conversations.get(options.resumeSessionId)
      if (!session) throw new Error('session not found')
      resumedSessions.push(session.id)
      const handle = attachAgent(session, options.agentOptions)
      try { await options.setup?.(handle.agent.ctx, handle.agent) }
      catch (error) { await handle.dispose(); throw error }
      return handle
    },
  }
  const trail = new ScreenTrail(ctx, config, { fs: io, home: '/virtual-home', now: () => now,
    createStore: (_file, options) => {
      // 使用真正的内存 SQLite，不伪造事务与外键；history 表示已保存的新库测试数据。
      const store = new JournalStore(':memory:', options)
      if (history) store.save({ records: history.records, events: history.activities || [], settings: {
        legacyResetPending: false, analysisSessionId: history.analysisSessionId ?? null,
        analysisRetry: history.analysisRetry ?? null,
        ...(history.sampleIntervalSec !== undefined ? { sampleIntervalSec: history.sampleIntervalSec } : {}),
        ...(history.analysisWindowSec !== undefined ? { analysisWindowSec: history.analysisWindowSec } : {}),
        ...(history.modelSettings ? { modelSettings: history.modelSettings } : {}),
      } })
      const close = store.close.bind(store)
      store.close = () => {
        closedSnapshot = { version: 1, records: store.pool(), activities: store.allEvents(),
          analysisSessionId: store.setting('analysisSessionId') ?? null, sampleIntervalSec: store.setting('sampleIntervalSec'),
          analysisWindowSec: store.setting('analysisWindowSec'),
          analysisRetry: store.setting('analysisRetry'),
          ...(store.setting('modelSettings') ? { modelSettings: store.setting('modelSettings') } : {}) }
        close()
      }
      return store
    },
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
        fail: (error = new Error('native connection interrupted')) => { source.state = 'failed'; options.onError(error) },
      }
      return source
    },
  })
  await trail.ready
  if (writeError) {
    trail.store.save = () => { throw new Error('disk write failed') }
  }
  return { trail, ctx, files, removed, requests, logs, commands, release, source, settle, conversations, workspaces, createdSessions, resumedSessions, flushedSessions, presetDefinitions, mountedPresets,
    invokeTool: (name, args, exec = {}) => registeredTools.get(name).execute(args, { signal: new AbortController().signal, callId: `external-${++toolCallId}`, concludeTurn: () => { throw new Error('ordinary chat must not be concluded') }, ...exec }),
    state: () => ({ ...trail.state(), records: trail.activities }),
    snapshot: () => closedSnapshot ?? ({ version: 1, records: trail.store.pool(), activities: trail.activities, ...trail.persistedSettings() }),
    setScreen: (value, context = currentContext) => { screenValue = value; currentContext = { ...context } },
    setCaptureError: (error) => { captureError = error },
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
