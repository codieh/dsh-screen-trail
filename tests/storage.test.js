import assert from 'node:assert/strict'
import { promises as fs } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { JournalStore, dayBounds } from '../dist/storage.js'
import { createHost } from './harness.js'
import { ScreenTrail } from '../dist/trail.js'

function event(id, at, end = at) {
  const frame = { id: `frame-${id}`, imageId: `image-${id}`, at, lastSeenAt: end, context: { app: 'Editor', title: id } }
  return { id: `event-${id}`, at, lastSeenAt: end, imageId: frame.imageId, evidence: [frame],
    analysis: { activity: '编写 LeetCode 438 题解', summary: id, tags: ['算法'] } }
}
function memory(t) { const store = new JournalStore(':memory:'); t.after(() => store.close()); return store }

test('a real SQLite file preserves events, evidence and settings across reopen', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'screen-trail-db-')); t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'journal.sqlite'); const [at] = dayBounds('2026-11-24')
  const store = new JournalStore(file)
  store.save({ events: [event('persisted', at)], settings: { sampleIntervalSec: 15, analysisSessionId: 'native-session', legacyResetPending: false } })
  store.close()
  assert.equal((await readFile(file)).subarray(0, 16).toString(), 'SQLite format 3\0')
  const reopened = new JournalStore(file); t.after(() => reopened.close())
  assert.equal(reopened.fresh, false); assert.equal(reopened.eventCount(), 1)
  assert.equal(reopened.getEvent('event-persisted').analysis.summary, 'persisted')
  assert.equal(reopened.setting('sampleIntervalSec'), 15); assert.equal(reopened.setting('analysisSessionId'), 'native-session')
  assert.equal(reopened.setting('legacyResetPending'), false)
  assert.deepEqual(reopened.db.prepare('PRAGMA foreign_key_check').all(), [])
})

test('invalid existing databases are reported rather than replaced', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'screen-trail-bad-db-')); t.after(() => rm(root, { recursive: true, force: true }))
  const file = path.join(root, 'journal.sqlite'); await writeFile(file, 'broken database')
  assert.throws(() => new JournalStore(file), /not a database/)
  assert.equal(await readFile(file, 'utf8'), 'broken database')
})

test('date paging uses Taipei midnight, stable cursors and start-day ownership for cross-day events', (t) => {
  const store = memory(t); const [start, end] = dayBounds('2026-11-24')
  store.save({ events: [event('previous', start - 1, start + 60000), event('midnight', start),
    event('a', start + 1000), event('b', start + 1000), event('last', end - 1), event('next', end)] })
  const first = store.listDay({ date: '2026-11-24', limit: 2 })
  const next = store.listDay({ date: '2026-11-24', limit: 2, cursor: first.nextCursor })
  assert.equal(first.total, 4); assert.equal(first.records[0].id, 'event-last')
  assert.deepEqual([...first.records, ...next.records].map((item) => item.id), ['event-last', 'event-b', 'event-a', 'event-midnight'])
  assert.equal(next.nextCursor, null)
  assert.equal(store.listDay({ date: '2026-11-23' }).records[0].lastSeenAt, start + 60000)
  assert.equal(store.listDay({ date: '2026-11-25' }).total, 1)
  assert.throws(() => store.listDay({ date: '2026-02-30' }), /invalid calendar date/)
  assert.throws(() => store.listDay({ date: '2026-11-25', cursor: first.nextCursor }), /invalid event cursor/)
  assert.throws(() => store.listDay({ date: '2026-11-24', limit: 0 }), /limit/)
})

test('failed multi-event writes roll back records, relations, settings and revision together', (t) => {
  const store = memory(t); const [at] = dayBounds('2026-11-24'); const revision = store.revision
  const broken = event('broken', at); broken.imageId = 'missing-cover'
  assert.throws(() => store.save({ events: [event('valid', at), broken], settings: { sampleIntervalSec: 99 } }), /cover/)
  assert.equal(store.eventCount(), 0); assert.equal(store.imageCount(), 0)
  assert.equal(store.setting('sampleIntervalSec'), undefined); assert.equal(store.revision, revision)
  assert.deepEqual(store.db.prepare('SELECT * FROM event_observations').all(), [])
})

test('pruning the temporary pool retains referenced evidence, and deleting its event releases it', (t) => {
  const store = memory(t); const [at] = dayBounds('2026-11-24'); const saved = event('retained', at)
  store.save({ records: saved.evidence, events: [saved] })
  store.save({ records: [] })
  assert.equal(store.pool().length, 0); assert.equal(store.imageCount(), 1)
  assert.equal(store.getObservation('frame-retained').id, 'frame-retained')
  store.save({ deletedIds: [saved.id] })
  assert.equal(store.getObservation('frame-retained'), null); assert.equal(store.imageCount(), 0)
})

test('one image resource can have different contexts while preserving the selected cover observation', (t) => {
  const store = memory(t); const [at] = dayBounds('2026-11-24'); const saved = event('cover', at)
  const other = { ...saved.evidence[0], id: 'frame-other', at: at + 1000, lastSeenAt: at + 1000, context: { app: 'Browser' } }
  saved.evidence.push(other); saved.coverObservationId = other.id; saved.lastSeenAt = other.lastSeenAt
  store.save({ events: [saved] })
  assert.equal(store.imageCount(), 1); assert.equal(store.getEvent(saved.id).context.app, 'Browser')
  assert.equal(store.getEvent(saved.id).coverObservationId, other.id)
})

test('extending an observation changes its event revision but no-op persistence does not', (t) => {
  const store = memory(t); const [at] = dayBounds('2026-11-24'); const saved = event('static', at)
  store.save({ records: saved.evidence, events: [saved] }); const revision = store.revision
  store.save({ records: saved.evidence }); assert.equal(store.revision, revision)
  store.save({ records: [{ ...saved.evidence[0], lastSeenAt: at + 5000 }] })
  assert.equal(store.getEvent(saved.id).lastSeenAt, at + 5000); assert.equal(store.revision, revision + 1)
})

test('formal events outlive temporary retention and production reads do not load every event', async (t) => {
  const h = await createHost({ config: { retention: 6 }, toolScript: async ({ call }) => {
    await call('write_events', { changes: [{ action: 'create', activity: '任务', summary: '独立活动', images: [1] }] })
  } }); t.after(h.dispose)
  for (let i = 0; i < 9; i++) { h.setScreen(i * 25); await h.trail.manualCapture(); await h.settle(); await h.advance(500) }
  assert.equal(h.trail.store.eventCount(), 9); assert.ok(h.trail.records.length <= 6)
  const all = h.trail.store.allEvents
  h.trail.store.allEvents = () => { throw new Error('unexpected full history read') }
  assert.equal(h.trail.state().activityCount, 9)
  assert.equal((await h.invokeTool('screen_trail_find_events', { query: '独立', limit: 2 })).events.length, 2)
  assert.equal(h.trail.store.listDay({ date: '2023-11-15', limit: 2 }).records.length, 2)
  h.trail.store.allEvents = all
})

test('real plugin initialization clears legacy files once, preserves preferences and creates a private database', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'screen-trail-upgrade-')); t.after(() => rm(home, { recursive: true, force: true }))
  const root = path.join(home, '.dsh', 'screen-trail'); await mkdir(path.join(root, 'shots'), { recursive: true })
  await mkdir(path.join(root, 'diagnostics')); await mkdir(path.join(root, 'native'))
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ records: [], activities: [], analysisSessionId: 'old-session',
    sampleIntervalSec: 15, modelSettings: { provider: '', model: '', reasoningEffort: null } }))
  await writeFile(path.join(root, 'shots', 'legacy.jpg'), 'old screenshot'); await writeFile(path.join(root, 'native', 'keep-helper'), 'native')
  const h = await createHost(); t.after(h.dispose)
  const createCapture = () => ({ state: 'stopped', stop() {}, start() { throw new Error('must not capture') } })
  let trail = new ScreenTrail(h.ctx, {}, { home, createCapture })
  assert.equal(await trail.ready, true); assert.equal(trail.state().sampleIntervalSec, 15)
  assert.equal(trail.analysisSessionId, null); assert.equal(trail.store.setting('legacyResetPending'), false)
  await assert.rejects(readFile(path.join(root, 'state.json')), { code: 'ENOENT' })
  await assert.rejects(readFile(path.join(root, 'shots', 'legacy.jpg')), { code: 'ENOENT' })
  assert.equal(await readFile(path.join(root, 'native', 'keep-helper'), 'utf8'), 'native')
  assert.equal((await stat(trail.databaseFile)).mode & 0o777, 0o600)
  const [at] = dayBounds('2026-11-24'); trail.store.save({ events: [event('survives-restart', at)] })
  await writeFile(path.join(root, 'shots', 'image-survives-restart.jpg'), 'evidence')
  await trail.dispose()
  trail = new ScreenTrail(h.ctx, {}, { home, createCapture }); t.after(() => trail.dispose())
  assert.equal(await trail.ready, true); assert.equal(trail.store.eventCount(), 1)
  assert.equal(trail.store.getEvent('event-survives-restart').analysis.summary, 'survives-restart')
  assert.equal(h.requests.length, 0)
})

test('interrupted legacy cleanup reports failure and resumes explicitly on the next startup', async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'screen-trail-reset-')); t.after(() => rm(home, { recursive: true, force: true }))
  const root = path.join(home, '.dsh', 'screen-trail'); await mkdir(root, { recursive: true })
  await writeFile(path.join(root, 'state.json'), JSON.stringify({ records: [], sampleIntervalSec: 25 }))
  const h = await createHost(); t.after(h.dispose)
  const createCapture = () => ({ state: 'stopped', stop() {} })
  const io = { ...fs, rm: async (file, options) => { if (file.endsWith('state.json')) throw new Error('legacy cleanup denied'); return fs.rm(file, options) } }
  const failed = new ScreenTrail(h.ctx, {}, { home, createCapture, fs: io })
  assert.equal(await failed.ready, false); assert.match(failed.state().lastError, /legacy cleanup denied/)
  assert.equal(failed.store.setting('legacyResetPending'), true); await failed.dispose()
  const restored = new ScreenTrail(h.ctx, {}, { home, createCapture }); t.after(() => restored.dispose())
  assert.equal(await restored.ready, true); assert.equal(restored.settings.sampleIntervalSec, 25)
  assert.equal(restored.store.setting('legacyResetPending'), false)
})
