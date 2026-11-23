import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { MacCapture, decodeFrame } from '../dist/capture.js'
import { makeFrame, settle } from './harness.js'

function packet(context = { app: 'Editor', title: 'Code' }) {
  const frame = makeFrame(120, context, 1700000000000)
  const rgba = Buffer.alloc(16 * 16 * 4, 120)
  return { type: 'frame', at: frame.at, context, imageId: frame.imageId, jpeg: frame.jpeg.toString('base64'), width: 16, height: 16, rgba: rgba.toString('base64') }
}
function clock() {
  let now = 0; let next = 0
  const timers = new Map()
  return { setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id }, clearTimer: (id) => timers.delete(id),
    advance: async (ms) => {
      const target = now + ms
      while (true) {
        const entry = [...timers].filter(([, value]) => value.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!entry) break
        now = entry[1].at; timers.delete(entry[0]); entry[1].fn(); await settle()
      }
      now = target; await settle()
    } }
}
function native(mode = 'frame', timers = {}) {
  const frames = []; const errors = []; const presences = []; const children = []; const logs = []
  const capture = new MacCapture({ root: '/unused', onFrame: (frame) => frames.push(frame), onError: (error) => errors.push(error), onPresence: (message) => presences.push(message), log: (event, data) => logs.push({ event, data }), ...timers,
    spawnProcess: (_command, args) => {
      const currentMode = Array.isArray(mode) ? mode[children.length] : mode
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
      let closed = false
      child.kill = () => { if (!closed) { closed = true; queueMicrotask(() => child.emit('close', 0)) } }
      child.send = (message) => child.stdout.emit('data', `${JSON.stringify(message)}\n`)
      child.args = args; children.push(child)
      setImmediate(() => {
        if (closed) return
        if (currentMode === 'hang') return
        if (currentMode === 'failure') { child.send({ type: 'error', message: 'Screen Recording permission required', domain: 'SCStreamErrorDomain', code: -3801 }); return }
        if (currentMode === 'waiting') { child.send({ type: 'waiting', at: 1700000000000, reason: 'screen-sleep' }); return }
        child.send({ type: 'ready', sampleIntervalSec: capture.sampleIntervalSec })
        if (currentMode === 'frame') child.send(packet())
        else if (currentMode === 'excluded') child.send({ type: 'excluded', at: 1700000000000, context: { title: 'Harness [dsh-screen-trail]' } })
        if (args.includes('--once')) child.kill()
      })
      return child
    } })
  capture.binary = async () => '/fake/capture'
  return { capture, frames, errors, presences, children, logs }
}

test('native frames are decoded with RGB information and verified JPEG fingerprints', () => {
  const value = decodeFrame(packet())
  assert.equal(value.thumbnail.pixels.length, 256); assert.equal(value.jpeg[0], 255)
  assert.throws(() => decodeFrame({ ...packet(), imageId: '0'.repeat(64) }), /fingerprint/)
  assert.throws(() => decodeFrame({ ...packet(), rgba: '' }), /invalid/)
  assert.throws(() => decodeFrame({ ...packet(), width: 5000 }), /metadata/)
})
test('one long-lived native process supplies frames and stops without a false error', async () => {
  const h = native(); await h.capture.start(); await settle()
  assert.equal(h.children.length, 1); assert.equal(h.frames.length, 1); assert.equal(h.capture.state, 'ready')
  await h.capture.start(); assert.equal(h.children.length, 1)
  h.capture.stop(); await settle(); assert.equal(h.errors.length, 0); assert.equal(h.capture.state, 'stopped')
})
test('sampling interval reaches the native helper and rejects invalid values', async (t) => {
  const h = native('frame', { sampleIntervalSec: 17 }); t.after(() => h.capture.stop())
  await h.capture.start()
  assert.ok(h.children[0].args.includes('--sample-interval-sec=17'))
  assert.equal(h.logs.find((item) => item.event === 'capture.ready').data.sampleIntervalSec, 17)
  for (const value of [0, -1, 1.5, NaN]) assert.throws(() => native('frame', { sampleIntervalSec: value }), /positive integer/)
})
test('single capture resolves an actual frame and releases its native process', async () => {
  const h = native(); const frame = await h.capture.once(); await settle()
  assert.equal(frame.imageId, packet().imageId); assert.equal(h.capture.jobs.size, 0)
})
test('self-surface exclusion is a presence signal, not a captured image', async () => {
  const h = native('excluded'); await h.capture.start(); await settle()
  assert.equal(h.frames.length, 0); assert.equal(h.presences.filter((item) => item.type === 'excluded').length, 1)
  h.capture.stop(); await settle()
  const one = native('excluded'); await assert.rejects(one.capture.once(), /自身页面已排除/); await settle()
  assert.equal(one.errors.length, 0)
})
test('a native permission failure rejects startup visibly', async () => {
  const h = native('failure'); await assert.rejects(h.capture.start(), /Screen Recording/); await settle()
  assert.equal(h.capture.state, 'failed')
})
test('corrupted stream messages terminate capture rather than silently switching modes', async () => {
  const h = native(); await h.capture.start(); await settle()
  h.children[0].send({ type: 'frame', at: 10 }); await settle()
  assert.equal(h.capture.state, 'failed'); assert.equal(h.errors.length, 1)
})
test('pausing during compilation cannot spawn an obsolete second native process', async () => {
  const h = native(); let release
  const binary = new Promise((resolve) => { release = resolve })
  h.capture.binary = () => binary
  const old = h.capture.start(); const rejected = assert.rejects(old, /cancelled/)
  h.capture.stop(); const current = h.capture.start(); release('/fake/capture')
  await rejected; await current; await settle()
  assert.equal(h.children.length, 1); assert.equal(h.capture.state, 'ready'); h.capture.stop(); await settle()
})

test('a manual one-shot cannot masquerade as the persistent capture stream', async () => {
  const h = native(); const once = h.capture.once(); await h.capture.start(); await once; await settle()
  assert.equal(h.children.length, 2); assert.equal(h.capture.jobs.size, 1)
  await h.capture.start(); assert.equal(h.children.length, 2)
  h.capture.stop(); await settle(); assert.equal(h.errors.length, 0)
})

const screenEvent = (type, reason = type) => ({ type, at: 1700000000000, reason })
test('screen sleep keeps one waiting helper and wake rebuilds it once after one second', async (t) => {
  const timers = clock(); const h = native('frame', timers); t.after(() => h.capture.stop())
  await h.capture.start(); h.children[0].send({ ...screenEvent('waiting'), domain: 'SCStreamErrorDomain', code: -3815 })
  assert.equal(h.capture.state, 'waiting'); assert.equal(h.capture.jobs.size, 1); assert.equal(h.errors.length, 0)
  await h.capture.start(); assert.equal(h.children.length, 1)
  h.children[0].send(screenEvent('wake')); await timers.advance(999); assert.equal(h.children.length, 1)
  await timers.advance(1)
  assert.equal(h.children.length, 2); assert.equal(h.capture.jobs.size, 1)
  assert.equal(h.capture.state, 'ready'); assert.equal(h.frames.length, 2); assert.equal(h.errors.length, 0)
  assert.equal(h.logs.find((item) => item.event === 'capture.waiting').data.code, -3815)
})

test('duplicate display wake notifications schedule only one restart', async (t) => {
  const timers = clock(); const h = native('frame', timers); t.after(() => h.capture.stop())
  await h.capture.start(); h.children[0].send(screenEvent('waiting'))
  h.children[0].send(screenEvent('wake', 'display-wake')); h.children[0].send(screenEvent('wake', 'display-wake'))
  await timers.advance(10000)
  assert.equal(h.children.length, 2); assert.equal(h.logs.filter((item) => item.event === 'capture.wake_restart').length, 1)
})

test('sleeping again cancels a pending wake restart', async (t) => {
  const timers = clock(); const h = native('frame', timers); t.after(() => h.capture.stop())
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(500); h.children[0].send(screenEvent('waiting', 'sleep-again'))
  await timers.advance(1500); assert.equal(h.children.length, 1); assert.equal(h.capture.state, 'waiting')
  h.children[0].send(screenEvent('wake')); await timers.advance(1000); assert.equal(h.children.length, 2)
})

test('manual stop cancels wake restart and late notifications cannot reactivate capture', async () => {
  const timers = clock(); const h = native('frame', timers)
  await h.capture.start(); const old = h.children[0]
  old.send(screenEvent('waiting')); old.send(screenEvent('wake')); h.capture.stop()
  old.send(screenEvent('wake')); await timers.advance(10000)
  assert.equal(h.children.length, 1); assert.equal(h.capture.state, 'stopped'); assert.equal(h.errors.length, 0)
})

test('a failed wake rebuild reports its system error and does not retry automatically', async () => {
  const timers = clock(); const h = native(['frame', 'failure'], timers)
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(1000); await timers.advance(60000)
  assert.equal(h.children.length, 2); assert.equal(h.capture.state, 'failed'); assert.equal(h.errors.length, 1)
  assert.equal(h.errors[0].code, -3801); assert.match(h.errors[0].message, /SCStreamErrorDomain -3801/)
})

test('a wake rebuild that never becomes ready times out once instead of retrying', async () => {
  const timers = clock(); const h = native(['frame', 'hang'], timers)
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(61000)
  assert.equal(h.children.length, 2); assert.equal(h.errors.length, 1)
  assert.equal(h.capture.state, 'failed'); assert.match(h.errors[0].message, /wake recovery timed out/)
})

test('a manual one-shot cannot replace the persistent waiting state or cancel wake recovery', async (t) => {
  const timers = clock(); const h = native(['frame', 'excluded', 'frame'], timers); t.after(() => h.capture.stop())
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await assert.rejects(h.capture.once(), /自身页面已排除/)
  assert.equal(h.capture.state, 'waiting')
  await timers.advance(1000)
  assert.equal(h.capture.state, 'ready'); assert.equal(h.children.length, 3); assert.equal(h.errors.length, 0)
})

test('manual stop during wake rebuild cancels the new startup without a false error', async () => {
  const timers = clock(); const h = native('frame', timers)
  await h.capture.start()
  let release; h.capture.binary = () => new Promise((resolve) => { release = resolve })
  h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake')); await timers.advance(1000)
  assert.equal(h.capture.state, 'starting'); h.capture.stop(); release('/fake/capture'); await settle()
  assert.equal(h.children.length, 1); assert.equal(h.capture.state, 'stopped'); assert.equal(h.errors.length, 0)
})

test('sleep during startup settles in waiting rather than triggering the startup timeout', async (t) => {
  const timers = clock(); const h = native(['waiting', 'frame'], timers); t.after(() => h.capture.stop())
  await h.capture.start(); await timers.advance(120000)
  assert.equal(h.capture.state, 'waiting'); assert.equal(h.errors.length, 0)
  h.children[0].send(screenEvent('wake')); await timers.advance(1000); assert.equal(h.capture.state, 'ready')
})

test('user-stopped and permission errors remain fatal even while waiting for wake', async () => {
  for (const code of [-3817, -3801]) {
    const timers = clock(); const h = native('frame', timers)
    await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
    h.children[0].send({ type: 'error', message: 'Capture stopped', domain: 'SCStreamErrorDomain', code })
    await timers.advance(10000)
    assert.equal(h.children.length, 1); assert.equal(h.capture.state, 'failed'); assert.equal(h.errors[0].code, code)
  }
})

test('malformed screen lifecycle messages fail visibly instead of entering a hidden waiting state', async () => {
  const h = native(); await h.capture.start()
  h.children[0].send({ type: 'waiting', reason: 'no timestamp' }); await settle()
  assert.equal(h.capture.state, 'failed'); assert.match(h.errors[0].message, /lifecycle/)
})

test('a screen-state check recovers when the earlier wake notification arrived before waiting', async (t) => {
  const timers = clock(); const h = native('frame', timers); t.after(() => h.capture.stop())
  await h.capture.start()
  h.children[0].send(screenEvent('wake', 'early-display-wake'))
  h.children[0].send(screenEvent('waiting', 'source-unavailable'))
  await timers.advance(2000)
  assert.equal(h.capture.state, 'waiting'); assert.equal(h.children.length, 1)
  h.children[0].send(screenEvent('wake', 'screen-state-check'))
  await timers.advance(1000)
  assert.equal(h.capture.state, 'ready'); assert.equal(h.children.length, 2)
  assert.equal(h.logs.filter((item) => item.event === 'capture.recovered').length, 1)
})

test('repeated state checks cannot launch more than one wake rebuild', async (t) => {
  const timers = clock(); const h = native('frame', timers); t.after(() => h.capture.stop())
  await h.capture.start(); h.children[0].send(screenEvent('waiting'))
  for (let i = 0; i < 4; i += 1) h.children[0].send(screenEvent('wake', 'screen-state-check'))
  await timers.advance(10000)
  assert.equal(h.children.length, 2); assert.equal(h.errors.length, 0)
})

test('a rebuilt source failing before any frame reports once instead of rebuilding in a loop', async () => {
  const timers = clock(); const h = native(['frame', 'ready-only'], timers)
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(1000)
  assert.equal(h.capture.recovering, true)
  h.children[1].send({ ...screenEvent('waiting', 'source-unavailable'), message: 'No capture source', domain: 'SCStreamErrorDomain', code: -3815 })
  h.children[1].send(screenEvent('wake', 'screen-state-check'))
  await timers.advance(120000)
  assert.equal(h.children.length, 2); assert.equal(h.errors.length, 1); assert.equal(h.capture.state, 'failed')
  assert.equal(h.errors[0].code, -3815)
  assert.match(h.errors[0].message, /source unavailable after wake rebuild/)
  assert.equal(h.frames.length, 1)
})

test('ready without any screen callback does not count as a successful recovery', async () => {
  const timers = clock(); const h = native(['frame', 'ready-only'], timers)
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(61000)
  assert.equal(h.children.length, 2); assert.equal(h.capture.state, 'failed'); assert.equal(h.errors.length, 1)
  assert.match(h.errors[0].message, /wake recovery timed out before a screen frame/)
})

test('an idle or excluded screen callback can confirm recovery without forcing a new screenshot', async (t) => {
  for (const type of ['idle', 'excluded']) {
    const timers = clock(); const h = native(['frame', 'ready-only'], timers); t.after(() => h.capture.stop())
    await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
    await timers.advance(1000)
    h.children[1].send({ type, at: 1700000001000, context: { app: 'Editor', title: 'A' } })
    await timers.advance(120000)
    assert.equal(h.capture.state, 'ready'); assert.equal(h.capture.recovering, false); assert.equal(h.errors.length, 0)
  }
})

test('a genuine new sleep during rebuilding can wait for a new wake cycle', async (t) => {
  const timers = clock(); const h = native(['frame', 'waiting', 'frame'], timers); t.after(() => h.capture.stop())
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(1000)
  assert.equal(h.capture.state, 'waiting'); assert.equal(h.capture.recovering, false)
  h.children[1].send(screenEvent('wake', 'screen-state-check')); await timers.advance(1000)
  assert.equal(h.capture.state, 'ready'); assert.equal(h.children.length, 3); assert.equal(h.errors.length, 0)
})

test('manual capture cannot confirm recovery for the persistent stream', async () => {
  const timers = clock(); const h = native(['frame', 'ready-only', 'frame'], timers)
  await h.capture.start(); h.children[0].send(screenEvent('waiting')); h.children[0].send(screenEvent('wake'))
  await timers.advance(1000); await h.capture.once()
  assert.equal(h.capture.recovering, true)
  await timers.advance(60000)
  assert.equal(h.errors.length, 1); assert.equal(h.capture.state, 'failed')
})
