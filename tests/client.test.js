import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')

function renderPanel(state, environment = {}) {
  let plugin
  let Panel
  let stateIndex = 0
  let labels = {}
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (initial) => [stateIndex++ === 0 ? state : initial, () => {}],
    useEffect: (effect) => { environment.effects?.push(effect) },
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value === null && environment.page ? environment.page : value }),
    Fragment: Symbol('fragment'),
  }
  vm.runInNewContext(source, {
    window: { __ModuleLoader__: { load: (entry) => { plugin = entry.factory(() => React) } } },
    document: environment.document || { baseURI: 'http://localhost/', documentElement: { lang: 'zh-CN' } },
    MutationObserver: environment.MutationObserver,
    IntersectionObserver: environment.IntersectionObserver,
    URL, Intl, Date,
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

test('panel shows observation, analysis, queue counts and keyframe reasons', () => {
  const tree = renderPanel({
    ready: true, running: true, busy: true, sampling: false, analyzing: true,
    captures: 8, keyframes: 2, queueLength: 1, analyses: 0, sampleIntervalSec: 2,
    records: [], observations: [{ id: 'frame-one', at: Date.now(), reason: 'change', analysisStatus: 'pending' }],
  })
  const content = text(tree)
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
