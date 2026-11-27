import type { PluginConfig, Observation, ModelObservation, StreamChunk } from '../src/types.js'
import { representatives } from '../src/frames.js'

const config: PluginConfig = { sampleIntervalSec: 5, analysisWindowSec: 300 }
// @ts-expect-error 采样配置不能接收字符串单位。
config.sampleIntervalSec = '5 seconds'
const samples = representatives([{ at: 1, id: 'a' }, { at: 2, id: 'b' }])
const id: string = samples[0].id
// @ts-expect-error 时间选图要求数值时间戳，不能混入模型日期字符串。
representatives([{ at: '2026-11-23 12:00:00' }])
// @ts-expect-error 文本分块不能携带数值文本。
const badChunk: StreamChunk = { type: 'text-delta', index: 0, text: 1 }
declare const local: Observation
declare const message: ModelObservation
const localTime: number = local.at
const messageTime: string = message.at
void [config, id, badChunk, localTime, messageTime]

import type { EventEdits, DayPage, AnalysisRetry, CaptureController, Settings } from '../src/types.js'
import { JournalStore } from '../src/storage.js'
declare const store: JournalStore
const interval: number | undefined = store.setting('sampleIntervalSec')
// @ts-expect-error 设置值必须与对应 key 匹配。
store.setSetting('sampleIntervalSec', '5 seconds')
// @ts-expect-error 数据库没有任意名称的设置。
store.setting('missingSetting')
// @ts-expect-error 更新操作必须指定真实事件 ID。
const invalidEdit: EventEdits = { changes: [{ action: 'update', summary: '继续工作' }] }
// @ts-expect-error 删除操作不接受用于新建事件的图片编号。
const invalidDelete: EventEdits = { changes: [{ action: 'delete', id: 'event-one', images: [1] }] }
declare const page: DayPage
const started: number = page.records[0].at
const retry: AnalysisRetry = { ids: ['frame-one'], selectedIds: ['frame-one'], attempt: 1, at: 1 }
declare const capture: CaptureController
const image: Promise<import('../src/types.js').CaptureFrame> = capture.once()
const modelPreferences: Settings['modelSettings'] = { provider: '', model: '', reasoningEffort: null }
void [interval, invalidEdit, invalidDelete, started, retry, image, modelPreferences]

// @ts-expect-error 静止画面消息必须携带窗口上下文。
const invalidPresence: import('../src/types.js').Presence = { type: 'idle', at: 1 }
void invalidPresence
