import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../dist/client.js', import.meta.url), 'utf8')

function renderPanel(state, environment = {}) {
  let plugin
  let Panel
  let stateIndex = 0
  let refIndex = 0
  let labels = {}
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (initial) => {
      const index = stateIndex++
      let value = initial
      if (index === 0) value = state
      if (index === 6 && environment.day) value = environment.day
      if (index === 8 && !environment.dynamic) value = { date: environment.day || new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10),
        records: state.records || [], total: state.records?.length || 0, nextCursor: environment.nextCursor || null }
      if (environment.values?.has(index)) value = environment.values.get(index)
      return [value, (next) => environment.values?.set(index, typeof next === 'function' ? next(environment.values.has(index) ? environment.values.get(index) : value) : next)]
    },
    useEffect: (effect) => { environment.effects?.push(effect) },
    useCallback: (fn) => fn,
    useRef: (value) => {
      const index = refIndex++
      if (!environment.refs) return { current: value === null && environment.page ? environment.page : value }
      if (!environment.refs.has(index)) environment.refs.set(index, { current: value })
      return environment.refs.get(index)
    },
    Fragment: Symbol('fragment'),
  }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => { plugin = entry.factory(() => React) } } },
    document: environment.document || { baseURI: 'http://localhost/', documentElement: { lang: 'zh-CN' } },
    MutationObserver: environment.MutationObserver,
    IntersectionObserver: environment.IntersectionObserver,
    URL, URLSearchParams, Intl, Date, AbortController, fetch: environment.fetch,
  })
  plugin.apply({
    locale: {
      bind: () => (key) => labels[key] || key,
      register: (_ns, language, values) => { if (language === 'zh') labels = values },
    },
    effect: (fn) => fn(),
    slots: {
      inject: (_name, fn) => fn(),
      register: (options, component) => { if (options.name === 'main') Panel = component },
    },
  })
  return Panel({ t: (key) => labels[key] || key })
}

function allNodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  return [tree, ...tree.children.flatMap(allNodes)]
}

function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree)
  if (!tree || typeof tree !== 'object') return ''
  return tree.children.map(text).join(' ')
}

test('model settings form provides model, reasoning and explicit save controls', () => {
  const tree = renderPanel({ ready: true, records: [], observations: [],
    modelSettings: { provider: 'mock', model: 'vision', reasoningEffort: 'low' } })
  const component = allNodes(tree).find((node) => node.type?.name === 'ModelSettings')
  const form = component.type(component.props)
  const nodes = allNodes(form)
  const model = nodes.find((node) => node.type === 'select' && node.props['aria-label'] === '分析模型')
  const effort = nodes.find((node) => node.type === 'select' && node.props['aria-label'] === '思考强度')
  assert.equal(model.props.value, '["mock","vision"]')
  assert.equal(effort.props.value, 'low')
  assert.ok(text(form).includes('跟随宿主模型'))
  assert.ok(text(form).includes('模型默认'))
  assert.ok(nodes.some((node) => node.type === 'button' && text(node) === '保存模型设置'))
})

test('panel shows observation, analysis, queue counts and keyframe reasons', () => {
  const tree = renderPanel({
    ready: true, running: true, busy: true, sampling: false, analyzing: true,
    captures: 8, keyframes: 2, queueLength: 1, analyses: 0, sampleIntervalSec: 2,
    records: [], observations: [{ id: 'frame-one', at: Date.now(), reason: 'change', analysisStatus: 'pending' }],
  })
  const content = text(tree)
  const samplingInput = allNodes(tree).find((node) => node.type === 'input' && node.props.type === 'number')
  assert.equal(samplingInput.props.defaultValue, '2')
  assert.equal(samplingInput.props.min, 1)
  assert.ok(content.includes('采样间隔: 2 秒'))
  for (const expected of ['观察中 · 分析中', '已采样: 8', '观察记录: 2', '待分析: 1', '画面变化', '等待分析']) {
    assert.ok(content.includes(expected), expected)
  }
  const capture = allNodes(tree).find((node) => node.type === 'button' && text(node) === '立即分析')
  assert.equal(capture.props.disabled, true)
})

test('pending observations show context without requesting retired input permissions', () => {
  const tree = renderPanel({ captureSource: 'failed', lastError: 'Enable Screen Recording',
    records: [{ id: 'pending-frame', at: Date.now(), reason: 'context', imageReused: true, analysisStatus: 'pending',
      context: { app: 'Editor', title: 'Returning to A', url: 'https://test/A' } }] })
  for (const expected of ['原生采集: 失败', 'Returning to A', 'https://test/A', '图片复用']) {
    assert.ok(text(tree).includes(expected), expected)
  }
  assert.ok(!text(tree).includes('输入监控'))
})

test('panel renders progress from contextual model analysis', () => {
  const tree = renderPanel({ records: [{
    id: 'frame-two', at: Date.now(), reason: 'manual', analysisStatus: 'complete',
    analysis: { activity: '编写代码', summary: '在开发插件。', change: '增加了关键帧选择。' },
  }] })
  assert.ok(text(tree).includes('进展: 增加了关键帧选择。'))
  assert.ok(text(tree).includes('手动采集'))
})

test('capacity shows backlog draining instead of falsely claiming capture is active', () => {
  const tree = renderPanel({ ready: true, running: true, capturePaused: true, unfinishedCount: 782, retention: 80, pendingCapacity: 780,
    captureResumeAt: 774, queueLength: 776, analyzing: true, records: [] })
  for (const expected of ['暂停采集，正在处理积压', '正在分析积压记录', '782 / 780', '774']) assert.ok(text(tree).includes(expected), expected)
})

test('screen sleep is displayed as waiting, not recording failure or manual pause', () => {
  const tree = renderPanel({ ready: true, running: true, captureSource: 'waiting', analyzing: true, records: [] })
  assert.ok(text(tree).includes('等待屏幕恢复'))
  assert.ok(text(tree).includes('分析中'))
  assert.ok(!text(tree).includes('操作出现错误'))
  assert.ok(!text(tree).includes('观察中'))
})

test('analysis error banner exposes the request, finish reason and output budget', () => {
  const tree = renderPanel({ lastError: 'model output was truncated', records: [],
    lastAnalysis: { outcome: 'failed', requestId: 'request-1234', finish: { kind: 'max-tokens' }, usage: { outputTokens: 2400 }, maxTokens: 16384 } })
  for (const expected of ['request-1234', 'max-tokens', '2400 / 16384']) assert.ok(text(tree).includes(expected), expected)
})

test('only a visible recorder surface marks the native window title and restores current chat title', () => {
  const effects = []; let title = 'Harness'; let changed; let visible
  const document = { baseURI: 'http://localhost/', documentElement: { lang: 'zh-CN' }, head: {},
    get title() { return title }, set title(value) { title = value; changed?.() } }
  renderPanel({ records: [] }, { document, effects, page: { getClientRects: () => [{}] },
    MutationObserver: class { constructor(fn) { changed = fn } observe() {} disconnect() { changed = null } },
    IntersectionObserver: class { constructor(fn) { visible = (value) => fn([{ isIntersecting: value }]) } observe() {} disconnect() {} } })
  const cleanup = effects[0]()
  assert.equal(title, 'Harness [dsh-screen-trail]')
  document.title = 'Updated title'; assert.equal(title, 'Updated title [dsh-screen-trail]')
  visible(false); document.title = 'Normal chat'; assert.equal(title, 'Normal chat')
  visible(true); assert.equal(title, 'Normal chat [dsh-screen-trail]')
  cleanup(); assert.equal(title, 'Normal chat')
})

test('empty activity list still exposes pending evidence, clear and manual analysis controls', () => {
  const tree = renderPanel({ ready: true, records: [], selfExcluded: true, running: true, observations: [{ id: 'pending-one', at: Date.now(), analysisStatus: 'pending' }] })
  for (const expected of ['正在整理活动', '采集证据 (1)', '纪事自身页面已排除', '清空']) assert.ok(text(tree).includes(expected), expected)
  const analyse = allNodes(tree).find((node) => node.type === 'button' && text(node) === '立即分析')
  assert.equal(analyse.props.disabled, false)
})

test('date tabs expose the selected day, date picker and pagination without relative-time labels', () => {
  const tree = renderPanel({ ready: true, activityCount: 2, records: [{ id: 'overnight', at: Date.parse('2026-11-23T23:55:00+08:00'),
    lastSeenAt: Date.parse('2026-11-24T00:10:00+08:00'), analysis: { activity: '持续工作', summary: '跨午夜。' } }] },
  { day: '2026-11-23', nextCursor: 'next-page' })
  const nodes = allNodes(tree); const tabs = nodes.filter((node) => node.props.role === 'tab')
  assert.equal(tabs.length, 7); assert.equal(tabs.filter((node) => node.props['aria-selected']).length, 1)
  assert.equal(tabs.find((node) => node.props['aria-selected']).props.title, '2026-11-23')
  assert.ok(nodes.some((node) => node.type === 'input' && node.props.type === 'date'))
  assert.ok(text(tree).includes('23:55–2026-11-24 00:10'))
  assert.ok(text(tree).includes('加载更多')); assert.ok(!text(tree).includes('小时前'))
  const empty = renderPanel({ ready: true, records: [], observations: [] }, { day: '2026-11-01' })
  assert.ok(text(empty).includes('当天暂无记录'))
})

const nextTick = () => new Promise(setImmediate)
const pageRecord = (id) => ({ id, at: Date.now(), analysis: { activity: id, summary: id } })
function dynamicPanel(fetch, day = '2026-11-23') {
  const environment = { fetch, day, dynamic: true, values: new Map(), refs: new Map(), effects: [] }
  let state = { ready: true, eventsRevision: 1, activityCount: 5, observations: [] }
  return {
    environment,
    render: (revision = state.eventsRevision) => { state = { ...state, eventsRevision: revision }; environment.effects = []; return renderPanel(state, environment) },
    load: () => environment.effects[1](),
  }
}

test('switching dates aborts stale results instead of replacing the newly selected day', async () => {
  const calls = []
  const app = dynamicPanel((url) => new Promise((resolve) => calls.push({ url, resolve })))
  let tree = app.render(); const cancel = app.load(); await nextTick()
  const previous = allNodes(tree).find((node) => node.props['aria-label'] === '前一天')
  previous.props.onClick(); cancel(); app.render(); const cleanup = app.load(); await nextTick()
  calls[1].resolve({ ok: true, json: async () => ({ ok: true, date: '2026-11-22', revision: 1, records: [pageRecord('new day')], total: 1, nextCursor: null }) })
  await nextTick()
  calls[0].resolve({ ok: true, json: async () => ({ ok: true, date: '2026-11-23', revision: 1, records: [pageRecord('stale')], total: 1, nextCursor: null }) })
  await nextTick(); tree = app.render(); cleanup()
  assert.ok(text(tree).includes('new day')); assert.ok(!text(tree).includes('stale'))
  assert.equal(app.environment.values.get(6), '2026-11-22')
})

test('load more appends only the next page and revision refresh preserves the selected date and expanded card', async () => {
  const calls = []; let revision = 1
  const app = dynamicPanel(async (url) => {
    calls.push(url); const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
    return { ok: true, json: async () => ({ ok: true, date: '2026-11-23', revision, total: 2,
      records: [pageRecord(cursor ? 'second' : 'first')], nextCursor: cursor ? null : 'cursor-two' }) }
  })
  app.render(); let cleanup = app.load(); await nextTick()
  let tree = app.render()
  allNodes(tree).find((node) => node.type === 'button' && text(node) === '加载更多').props.onClick()
  cleanup(); app.render(); cleanup = app.load(); await nextTick()
  tree = app.render()
  assert.equal(calls.length, 2); assert.ok(calls[1].includes('cursor=cursor-two'))
  assert.ok(text(tree).includes('first')); assert.ok(text(tree).includes('second'))
  app.environment.values.set(3, 'first')
  revision = 2; cleanup(); app.render(2); cleanup = app.load(); await nextTick(); tree = app.render(2)
  assert.equal(calls.length, 4); assert.equal(app.environment.values.get(3), 'first')
  assert.ok(allNodes(tree).some((node) => node.props.role === 'tab' && node.props.title === '2026-11-23' && node.props['aria-selected']))
  cleanup()
})

test('event request errors are visible with an explicit retry control', async () => {
  const app = dynamicPanel(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'database read failed' }) }))
  app.render(); const cleanup = app.load(); await nextTick(); const tree = app.render(); cleanup()
  assert.ok(text(tree).includes('database read failed'))
  assert.ok(allNodes(tree).some((node) => node.type === 'button' && text(node) === '重试'))
  assert.ok(!text(tree).includes('当天暂无记录'))
})
