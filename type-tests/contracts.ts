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
