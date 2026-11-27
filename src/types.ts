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
export interface Activity extends Evidence { coverObservationId?: string; evidence: Evidence[]; analysis: ActivityAnalysis; reason: string; analysisStatus?: AnalysisStatus; analysisError?: string | null }
export type AnalysisStatus = Observation['analysisStatus']
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
  onFrame: (frame: CaptureFrame) => void; onPresence: (message: Presence) => void; onError: (error: TrailError) => void
  log: (event: string, detail: Record<string, unknown>) => void
  spawnProcess?: typeof import('node:child_process').spawn; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout
}
export interface RuntimeAdapters {
  fs?: typeof import('node:fs/promises'); run?: (command: string, args: string[]) => Promise<unknown>
  home?: string; now?: () => number; uuid?: () => string
  setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout
  createCapture?: (options: CaptureOptions) => CaptureController
  createStore?: (file: string, options: StoreOptions) => import('./storage.js').JournalStore
}
export type Presence =
  | { type: 'idle' | 'excluded'; at: number; context: WindowContext; reason?: string }
  | { type: 'ready' | 'waiting' | 'wake'; at: number; reason?: string }
export interface CaptureController {
  state: string; sampleIntervalSec?: number
  start(options?: { confirmFrame?: boolean }): Promise<void>; stop(): void; once(): Promise<CaptureFrame>
}
export interface ModelSettings { provider: string; model: string; reasoningEffort: string | null }
export interface AnalysisRetry { ids: string[]; selectedIds: string[]; attempt: number; at: number }
export interface StoreOptions { now?: () => number; log?: (event: string, details?: Record<string, unknown>) => void }
export interface Settings {
  legacyResetPending: boolean; journalRevision: number; sampleIntervalSec: number; analysisWindowSec: number;
  analysisSessionId: string | null; analysisRetry: AnalysisRetry | null; modelSettings: ModelSettings
}
export type StoredObservation = Evidence & Partial<Omit<Observation, keyof Evidence>>
export interface JournalWrite { records?: StoredObservation[]; settings?: Partial<Settings>; events?: Activity[]; deletedIds?: string[]; clear?: boolean }
export interface DayQuery { date: string; limit?: number; cursor?: string }
export interface DayPage { ok: true; date: string; revision: number; total: number; records: Activity[]; nextCursor: string | null }
export interface EventQuery { ids?: string[]; query?: string; from?: string; to?: string; limit?: number; includeCover?: boolean; includeEvidence?: boolean }
export interface StoredQuery { ids?: string[]; terms?: string[]; from?: number; to?: number; limit: number }
export interface EventSummary { id: string; activity: string; summary: string; at: string; lastSeenAt: string; evidenceCount: number; cover?: unknown; evidence?: Array<{ id: string; at: string; lastSeenAt: string }> }
export interface StoredSummary extends Omit<EventSummary, 'at' | 'lastSeenAt'> { at: number; lastSeenAt: number }
export interface ModelActivity extends Partial<ActivityAnalysis> { task?: string | 0 | null; images?: number[]; cover?: number; mergeTasks?: string[] }
export interface ActivityChange { action: 'update' | 'new'; activityId?: string; mergeActivityIds: string[]; observationIds: string[]; coverObservationId: string | null; analysis: ActivityAnalysis }
export interface ActivityResult { activities: ActivityChange[]; ignoredObservationIds: string[] }
export interface EventReceipt { events: Array<{ id: string; action: 'created' | 'updated' | 'merged'; activity: string; mergedIds: string[] }>; deletedIds: string[]; ignoredImages: number }
export interface CommittedResult extends ActivityResult { committed: true; receipt: EventReceipt; usedObservationIds?: string[] }
type EditFields = Partial<ActivityAnalysis> & { images?: number[]; evidenceIds?: string[]; cover?: number }
export type EventEdit =
  | (EditFields & { action: 'create'; activity: string; summary: string; id?: never; mergeIds?: never })
  | (EditFields & { action: 'update'; id: string; mergeIds?: never })
  | (EditFields & { action: 'merge'; id: string; mergeIds: string[] })
  | { action: 'delete'; id: string }
export interface EventEdits { changes: EventEdit[] }
export interface ToolTrace { name: string; outcome: string; code?: string; message?: string; ids?: string[]; receipt?: unknown }
export interface EventBatch {
  signal: AbortSignal; requestId: string; agentId?: string; batch: Observation[]; selected: Observation[]; version?: number; model: string;
  active?: boolean; calls: ToolTrace[]; receipt: EventReceipt | null; result?: CommittedResult | null;
  parent?: EventBatch | null; canonical?: string | null; pending?: Promise<EventReceipt> | null;
  usedObservationIds?: Set<string>; counted?: boolean
}
export type CaptureOutcome = (Observation & { cancelled?: never }) | { cancelled?: boolean; coalesced?: boolean; excluded?: boolean; reason?: string }
export interface CaptureJob { frame: CaptureFrame; manual: boolean; epoch: number; resolve(value: CaptureOutcome): void; reject(error: unknown): void }
export interface TrailError extends Error { code?: string | number; domain?: string; eventCommit?: EventReceipt; usedObservationIds?: string[]; analysisContext?: ContextInfo }
export interface ContextInfo { agentPreset: string | null; compactionAvailable: boolean; compactionAuto: boolean | null }
export interface TokenMetrics { totalTokens: number; surfaceTokens: number; contextWindow: number | null }
export interface Diagnostic extends Record<string, unknown> {
  requestId: string; outcome: string; diagnosticFile?: string; maxTokens?: number; finish?: FinishReason | null; usage?: TokenUsage | null
}
export interface TrailStatus {
  permission: string; lastError: string | null; captures: number; keyframes: number; analyses: number; modelCalls: number; reusedImages: number;
  extended: number; skipped: number; excluded: number; coalesced: number; ignored: number; selfExcluded: boolean;
  lastCaptureAt: number | null; lastAnalysisAt: number | null; selection: {provider: string; model: string} | null; lastAnalysis: Diagnostic | null
}
export interface ModelObservation { number: number; at: string; lastSeenAt: string; context: Omit<WindowContext, 'bundleId'>; trigger?: string }
export interface ResolvedConfig {
  sampleIntervalSec: number; analysisWindowSec: number; analysisMaxTokens: number
  retention: number; maxDimension: number; analysisReasoningEffort?: string
  provider: string; model: string; locale: string
}
