/** 采集、本地存储和模型消息之间的数据边界。 */
export interface WindowContext { app?: string; bundleId?: string; pid?: number; windowId?: number; title?: string; url?: string }
export interface Thumbnail { width: number; height: number; pixels: Uint8Array; rgb?: Uint8Array }
export interface CaptureFrame { at: number; context: WindowContext; imageId: string; jpeg: Buffer; thumbnail: Thumbnail }
export interface Evidence { id: string; imageId: string; at: number; lastSeenAt: number; context: WindowContext }
export interface Observation extends Evidence {
  bytes?: number; reason?: string; score?: number; imageReused?: boolean
  analysisStatus: 'pending' | 'analyzing' | 'complete' | 'failed'
  analysisError?: string | null; selectedForAnalysis?: boolean
}
export interface ActivityAnalysis { goal?: string; activity: string; summary: string; change?: string; model?: string; details?: string[]; tags?: string[] }
export interface Activity extends Evidence { evidence: Evidence[]; analysis: ActivityAnalysis; reason: string; analysisStatus?: string; analysisError?: string | null }
export interface PluginConfig {
  sampleIntervalSec?: number; analysisWindowSec?: number; analysisMaxTokens?: number; retention?: number
  maxDimension?: number; analysisReasoningEffort?: string; provider?: string; model?: string; locale?: string
  autoStart?: boolean; eventsEnabled?: boolean; analysisIntervalSec?: number
}
export interface FinishReason { kind: string; failure?: { code?: string; message?: string } }
export type TokenUsage = Partial<Record<'inputTokens' | 'outputTokens' | 'totalTokens' | 'reasoningTokens' | 'cacheReadTokens' | 'cacheWriteTokens', number>>
export type StreamChunk =
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'block-start' | 'block-end'; index: number; block?: { type: string; text?: string } }
  | { type: 'reasoning-delta'; text: string }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason }
export interface CaptureOptions {
  root: string; maxDimension?: number; sampleIntervalSec?: number
  onFrame: (frame: CaptureFrame) => void; onPresence: (message: any) => void; onError: (error: Error) => void
  log: (event: string, detail: Record<string, unknown>) => void
  spawnProcess?: typeof import('node:child_process').spawn; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout
}
export interface RuntimeAdapters {
  fs?: typeof import('node:fs/promises'); run?: (command: string, args: string[]) => Promise<unknown>
  home?: string; now?: () => number; uuid?: () => string
  setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout
  createCapture?: (options: CaptureOptions) => any
}
export interface ModelObservation { number: number; at: string; lastSeenAt: string; context: Omit<WindowContext, 'bundleId'>; trigger?: string }
export interface ResolvedConfig {
  sampleIntervalSec: number; analysisWindowSec: number; analysisMaxTokens: number
  retention: number; maxDimension: number; analysisReasoningEffort?: string
  provider: string; model: string; locale: string
}
