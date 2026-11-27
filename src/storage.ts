import { DatabaseSync, type SQLInputValue } from 'node:sqlite'
import type { Activity, Observation, StoredObservation, Settings, StoreOptions, JournalWrite, DayQuery, DayPage, StoredQuery, StoredSummary } from './types.js'

interface ObservationRow { id: string; image_id: string; at: number; last_seen_at: number; context_json: string; trigger: string;
  analysis_status: Observation['analysisStatus']; analysis_error: string | null; selected_for_analysis: number; extra_json: string }
interface EventRow { id: string; started_at: number; last_seen_at: number; cover_observation_id: string; activity: string; summary: string; extra_json: string }

const DAY_MS = 86400000
const OFFSET_MS = 8 * 3600000
export const journalDay = (at: number): string => new Date(at + OFFSET_MS).toISOString().slice(0, 10)
export function dayBounds(day: string): [number, number] {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('date must be YYYY-MM-DD')
  const start = Date.parse(`${day}T00:00:00+08:00`)
  if (!Number.isFinite(start) || journalDay(start) !== day) throw new Error('invalid calendar date')
  return [start, start + DAY_MS]
}

/** SQLite 是正式事件的唯一来源；内存只保留有上限的采集队列。 */
export class JournalStore {
  declare now: () => number;
  declare log: NonNullable<StoreOptions['log']>;
  declare db: any;
  declare fresh: boolean;

  constructor(file: string, { now = Date.now, log = () => {} }: StoreOptions = {}) {
    this.now = now; this.log = log
    this.db = new DatabaseSync(file, { timeout: 5000 })
    try {
      this.db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;')
      const version = this.row<{ user_version: number }>('PRAGMA user_version')!.user_version
      if (version !== 0 && version !== 1) throw new Error(`unsupported journal database version: ${version}`)
      this.fresh = version === 0
      if (this.fresh) this.transaction(() => {
        this.db.exec(`
          CREATE TABLE observations (
            id TEXT PRIMARY KEY, image_id TEXT NOT NULL, at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
            context_json TEXT NOT NULL, trigger TEXT NOT NULL, analysis_status TEXT NOT NULL
              CHECK (analysis_status IN ('pending','analyzing','complete','failed')),
            analysis_error TEXT, selected_for_analysis INTEGER NOT NULL DEFAULT 0,
            in_pool INTEGER NOT NULL DEFAULT 1, extra_json TEXT NOT NULL DEFAULT '{}',
            CHECK(last_seen_at >= at)
          ) STRICT;
          CREATE TABLE events (
            id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
            activity TEXT NOT NULL, summary TEXT NOT NULL,
            cover_observation_id TEXT NOT NULL REFERENCES observations(id), extra_json TEXT NOT NULL DEFAULT '{}',
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, CHECK(last_seen_at >= started_at)
          ) STRICT;
          CREATE TABLE event_observations (
            event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
            observation_id TEXT NOT NULL REFERENCES observations(id), PRIMARY KEY(event_id, observation_id)
          ) STRICT;
          CREATE TABLE settings (key TEXT PRIMARY KEY, value_json TEXT NOT NULL) STRICT;
          CREATE INDEX events_started ON events(started_at DESC, id DESC);
          CREATE INDEX events_last_seen ON events(last_seen_at DESC, id DESC);
          CREATE INDEX observation_status ON observations(in_pool, analysis_status, at);
          CREATE INDEX observation_images ON observations(image_id);
          CREATE INDEX observation_events ON event_observations(observation_id);
          PRAGMA user_version = 1;
        `)
        // 首次打开要显式完成旧数据清理；中途失败后，下次启动继续，不悄悄跳过。
        this.setSetting('legacyResetPending', true)
        this.setSetting('journalRevision', 0)
      }, 'schema')
      if (!Number.isSafeInteger(this.revision) || this.revision < 0) throw new Error('invalid journal revision')
      this.log('database.opened', { version: 1, fresh: this.fresh })
    } catch (error) { this.db.close(); throw error }
  }
  // SQLite 驱动返回的通用行只在这一边界转换，业务代码使用明确的列类型。
  private row<T>(sql: string, ...params: SQLInputValue[]): T | undefined { return this.db.prepare(sql).get(...params) as T | undefined }
  private rows<T>(sql: string, ...params: SQLInputValue[]): T[] { return this.db.prepare(sql).all(...params) as T[] }
  transaction<T>(fn: () => T, stage = 'write', signal?: AbortSignal): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      signal?.throwIfAborted()
      const value = fn()
      signal?.throwIfAborted()
      this.db.exec('COMMIT')
      this.log('database.committed', { stage })
      return value
    } catch (error) {
      try { this.db.exec('ROLLBACK') }
      catch (rollback) { throw new AggregateError([error, rollback], 'journal transaction and rollback failed') }
      this.log('database.rolled_back', { stage, message: (error as Error).message })
      throw error
    }
  }
  setting<K extends keyof Settings>(key: K): Settings[K] | undefined {
    const row = this.row<{ value_json: string }>('SELECT value_json FROM settings WHERE key = ?', key)
    return row ? JSON.parse(row.value_json) as Settings[K] : undefined
  }
  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    this.db.prepare(`INSERT INTO settings VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
      WHERE settings.value_json != excluded.value_json`).run(key, JSON.stringify(value))
  }
  get revision(): number { return this.setting('journalRevision')! }
  bumpRevision() { this.setSetting('journalRevision', this.revision + 1) }
  observation(row: ObservationRow | undefined): Observation | null {
    if (!row) return null
    return { ...JSON.parse(row.extra_json), id: row.id, imageId: row.image_id, at: row.at, lastSeenAt: row.last_seen_at,
      context: JSON.parse(row.context_json), reason: row.trigger, analysisStatus: row.analysis_status,
      analysisError: row.analysis_error, selectedForAnalysis: Boolean(row.selected_for_analysis) }
  }
  getObservation(id: string): Observation | null { return this.observation(this.row<ObservationRow>('SELECT * FROM observations WHERE id=?', id)) }
  pool(): Observation[] { return this.rows<ObservationRow>('SELECT * FROM observations WHERE in_pool=1 ORDER BY at DESC, id DESC').map((row) => this.observation(row)!) }
  putObservation(item: StoredObservation, inPool: number): void {
    const { id, imageId, at, lastSeenAt = at, context = {}, reason = 'activity', analysisStatus = 'complete',
      analysisError = null, selectedForAnalysis = false, ...extra } = item
    this.db.prepare(`INSERT INTO observations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET last_seen_at=excluded.last_seen_at, context_json=excluded.context_json,
        analysis_status=excluded.analysis_status, analysis_error=excluded.analysis_error,
        selected_for_analysis=excluded.selected_for_analysis, in_pool=MAX(observations.in_pool, excluded.in_pool), extra_json=excluded.extra_json
      WHERE observations.last_seen_at != excluded.last_seen_at OR observations.context_json != excluded.context_json
        OR observations.analysis_status != excluded.analysis_status OR observations.analysis_error IS NOT excluded.analysis_error
        OR observations.selected_for_analysis != excluded.selected_for_analysis OR observations.in_pool < excluded.in_pool
        OR observations.extra_json != excluded.extra_json`).run(id, imageId, at, lastSeenAt, JSON.stringify(context), reason,
      analysisStatus, analysisError, Number(selectedForAnalysis), inPool, JSON.stringify(extra))
  }
  hydrate(row: EventRow | undefined): Activity | null {
    if (!row) return null
    const evidence = this.rows<ObservationRow>(`SELECT o.* FROM observations o JOIN event_observations eo ON eo.observation_id=o.id
      WHERE eo.event_id=? ORDER BY o.at, o.id`, row.id).map((item) => this.observation(item)!)
      .map(({ id, imageId, at, lastSeenAt, context }) => ({ id, imageId, at, lastSeenAt, context }))
    const cover = evidence.find((item) => item.id === row.cover_observation_id)
    if (!cover) throw new Error(`event cover is missing from evidence: ${row.id}`)
    return { id: row.id, at: row.started_at, lastSeenAt: row.last_seen_at, coverObservationId: cover.id, imageId: cover.imageId, context: cover.context,
      evidence, reason: 'activity', analysisStatus: 'complete', analysisError: null,
      analysis: { ...JSON.parse(row.extra_json), activity: row.activity, summary: row.summary } }
  }
  getEvent(id: string): Activity | null { return this.hydrate(this.row<EventRow>('SELECT * FROM events WHERE id=?', id)) }
  // 仅供显式导出及测试快照；页面与模型查询不加载全部历史。
  allEvents(): Activity[] { return this.rows<EventRow>('SELECT * FROM events ORDER BY started_at DESC, id DESC').map((row) => this.hydrate(row)!) }
  eventCount(): number { return this.row<{ n: number }>('SELECT COUNT(*) AS n FROM events')!.n }
  referencedObservationIds(): Set<string> { return new Set(this.rows<{ id: string }>('SELECT DISTINCT observation_id AS id FROM event_observations').map((row) => row.id)) }
  imageIds(): Set<string> { return new Set(this.rows<{ id: string }>('SELECT DISTINCT image_id AS id FROM observations').map((row) => row.id)) }
  imageCount(): number { return this.row<{ n: number }>('SELECT COUNT(DISTINCT image_id) AS n FROM observations')!.n }
  hasImage(id: string): boolean { return Boolean(this.row('SELECT 1 FROM observations WHERE image_id=? LIMIT 1', id)) }
  putEvent(item: Activity): void {
    for (const frame of item.evidence) {
      const stored = this.getObservation(frame.id)
      this.putObservation({ ...(stored || {}), ...frame, lastSeenAt: Math.max(stored?.lastSeenAt ?? frame.at, frame.lastSeenAt) }, 0)
    }
    const cover = item.coverObservationId ? item.evidence.find((frame) => frame.id === item.coverObservationId)
      : item.evidence.find((frame) => frame.imageId === item.imageId)
    if (!cover) throw new Error(`event cover is missing from evidence: ${item.id}`)
    const { activity, summary, ...extra } = item.analysis
    this.db.prepare(`INSERT INTO events VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET started_at=excluded.started_at, last_seen_at=excluded.last_seen_at,
        activity=excluded.activity, summary=excluded.summary, cover_observation_id=excluded.cover_observation_id,
        extra_json=excluded.extra_json, updated_at=excluded.updated_at`).run(item.id, item.at, item.lastSeenAt,
      activity, summary, cover.id, JSON.stringify(extra), this.now(), this.now())
    this.db.prepare('DELETE FROM event_observations WHERE event_id=?').run(item.id)
    const insert = this.db.prepare('INSERT INTO event_observations VALUES (?, ?)')
    for (const frame of item.evidence) insert.run(item.id, frame.id)
  }
  save({ records, settings = {}, events = [], deletedIds = [], clear = false }: JournalWrite, signal?: AbortSignal): void {
    return this.transaction(() => {
      let changed = clear || events.length > 0 || deletedIds.length > 0
      const released = new Set<string>()
      if (clear) this.db.exec('DELETE FROM events; DELETE FROM observations;')
      if (records) {
        const liveIds = new Set(records.map((item) => item.id))
        for (const row of this.rows<{ id: string }>('SELECT id FROM observations WHERE in_pool=1')) {
          if (!liveIds.has(row.id)) { this.db.prepare('UPDATE observations SET in_pool=0 WHERE id=?').run(row.id); released.add(row.id) }
        }
        for (const record of records) {
          this.putObservation(record, 1)
          const lastSeenAt = record.lastSeenAt ?? record.at
          // 静止延长只影响以此观察作为最后证据的事件，不把历史缺测补成连续活动。
          const updated = this.db.prepare(`UPDATE events SET last_seen_at=?, updated_at=?
            WHERE last_seen_at < ? AND id IN (SELECT eo.event_id FROM event_observations eo
              WHERE eo.observation_id=? AND NOT EXISTS (SELECT 1 FROM event_observations newer
                JOIN observations o ON o.id=newer.observation_id WHERE newer.event_id=eo.event_id AND o.at > ?))`)
            .run(lastSeenAt, this.now(), lastSeenAt, record.id, record.at)
          changed ||= updated.changes > 0
        }
      }
      for (const id of [...events.map((item) => item.id), ...deletedIds]) {
        for (const row of this.rows<{ id: string }>('SELECT observation_id AS id FROM event_observations WHERE event_id=?', id)) released.add(row.id)
      }
      for (const item of events) this.putEvent(item)
      for (const id of deletedIds) this.db.prepare('DELETE FROM events WHERE id=?').run(id)
      // 只检查此次失去引用的记录，不在每次采样时扫描所有历史证据。
      for (const id of released) this.db.prepare(`DELETE FROM observations WHERE id=? AND in_pool=0
        AND NOT EXISTS (SELECT 1 FROM event_observations WHERE observation_id=observations.id)`).run(id)
      for (const key of Object.keys(settings) as Array<keyof Settings>) this.setSetting(key, settings[key]!)
      if (changed) this.bumpRevision()
    }, 'journal', signal)
  }
  listDay({ date, limit = 30, cursor }: DayQuery): DayPage {
    const [start, end] = dayBounds(date)
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 80) throw new Error('limit must be 1..80')
    let after = ''; const params: SQLInputValue[] = [start, end]
    if (cursor) {
      let key
      try { key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) } catch { throw new Error('invalid event cursor') }
      if (!Array.isArray(key) || key.length !== 3 || key[0] !== date || !Number.isSafeInteger(key[1]) || typeof key[2] !== 'string') throw new Error('invalid event cursor')
      after = ' AND (started_at < ? OR (started_at = ? AND id < ?))'; params.push(key[1], key[1], key[2])
    }
    const rows = this.rows<EventRow>(`SELECT * FROM events WHERE started_at >= ? AND started_at < ?${after}
      ORDER BY started_at DESC, id DESC LIMIT ?`, ...params, limit + 1)
    const more = rows.length > limit; rows.length = Math.min(rows.length, limit)
    const last = rows.at(-1)
    return { ok: true, date, revision: this.revision,
      total: this.row<{ n: number }>('SELECT COUNT(*) AS n FROM events WHERE started_at >= ? AND started_at < ?', start, end)!.n,
      records: rows.map((row) => this.hydrate(row)!),
      nextCursor: more ? Buffer.from(JSON.stringify([date, last!.started_at, last!.id])).toString('base64url') : null }
  }
  find({ ids, terms = [], from, to, limit }: StoredQuery): { total: number; events: StoredSummary[] } {
    const clauses: string[] = []; const params: SQLInputValue[] = []
    if (ids) {
      if (!ids.length) return { total: 0, events: [] }
      clauses.push(`id IN (${ids.map(() => '?').join(',')})`); params.push(...ids)
    }
    if (from !== undefined) { clauses.push('last_seen_at >= ?'); params.push(from) }
    if (to !== undefined) { clauses.push('started_at <= ?'); params.push(to) }
    for (const term of terms) { clauses.push("instr(lower(activity || ' ' || summary), ?) > 0"); params.push(term) }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const total = this.row<{ n: number }>(`SELECT COUNT(*) AS n FROM events${where}`, ...params)!.n
    const events = this.rows<EventRow>(`SELECT * FROM events${where} ORDER BY last_seen_at DESC, id DESC LIMIT ?`, ...params, limit)
    return { total, events: events.map((row) => ({ id: row.id, activity: row.activity, summary: row.summary,
      at: row.started_at, lastSeenAt: row.last_seen_at,
      evidenceCount: this.row<{ n: number }>('SELECT COUNT(*) AS n FROM event_observations WHERE event_id=?', row.id)!.n })) }
  }
  close() { if (this.db.isOpen) this.db.close() }
}
