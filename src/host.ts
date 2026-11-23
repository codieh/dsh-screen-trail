import type { StreamChunk } from './types.js'

type Dispose = () => void
export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }
export interface HostSession { id: string }
export interface CompactionService {
  config?: { auto?: boolean }
  compactIfNeeded: (...args: any[]) => Promise<unknown>
}
export interface NativeAgent {
  id: string; session: HostSession; status: string
  ctx: {
    // 宿主事件允许第三方扩展；具体流分块仍由现有运行时检查校验。
    on(name: string, listener: (payload: any) => void): Dispose
    systemPrompt: { section(section: { name: string; order: number; text: string; complete: boolean; interpolate: boolean }): Dispose }
    tools: { restrict(filter: { allow: string[] }): Dispose; guard(check: (...args: any[]) => string): Dispose }
  }
  model: { select(selection: ModelSelection): void }
  followup(message: { id: string; role: 'user'; source: { kind: 'user' }; content: unknown[] }): void
  cancel(cause: { kind: 'hook'; reason: string }): void
}
interface AgentHandle { agent: NativeAgent; dispose(): Promise<void> }
interface AgentOptions extends ModelSelection { maxTokens: number }
interface FactoryOptions {
  agentOptions: AgentOptions; signal: AbortSignal
  setup(ctx: NativeAgent['ctx'], agent: NativeAgent): Promise<void>
}
interface Workspace { id: string; path: string; title: string; attachSession(id: string): Promise<void> }
/** 只描述插件消费的宿主接口，避免在运行包中引入第二份 Harness 实现。 */
export interface HostContext {
  logger?: { info(message: string): void; error(message: string): void }
  agentDefaultModel: { currentSelection(): ModelSelection }
  llm: { resolveModelInfo(provider: string, model: string, signal: AbortSignal): Promise<{
    inputModalities?: string[]; reasoning?: { defaultEffort?: string; efforts?: Array<{ id: string }> }
  }> }
  attachments: { saveImage(image: { data: Uint8Array; mediaType: string; name: string }): Promise<unknown> }
  agents: {
    get(id: string): NativeAgent | undefined
    create(options: FactoryOptions & { sessionId: string; meta: { cwd: string; agentPreset: string } }): Promise<AgentHandle>
    resume(options: FactoryOptions & { resumeSessionId: string }): Promise<AgentHandle>
  }
  agentPresets: {
    resolve(id?: string): Promise<{ id: string }>
    mount(ctx: NativeAgent['ctx'], id: string): Promise<unknown>
    composedPreset(ctx: NativeAgent['ctx']): string | undefined
    serviceFor(agent: NativeAgent, name: 'compaction'): CompactionService | undefined
    presetForSession(session: HostSession): string | null
  }
  sessionPersistence: { stat(id: string): Promise<{ header: { cwd?: string } }> }
  sessionQuery: {
    inspectSession<T>(id: string, read: (session: HostSession) => T, signal: AbortSignal): Promise<T>
    listEvents(id: string): Promise<Array<{ type: string; time: number }>>
  }
  sessions: { flush(session: HostSession): Promise<void> }
  sessionTitle: { rename(session: HostSession, title: string): void }
  workspaceRegistry: { create(directory: string, title: string): Promise<Workspace> }
  tokenMeter: {
    measure(session: HostSession): { totalTokens: number; surfaceTokens: number }
    contextPressure(session: HostSession): { contextWindow?: number }
  }
  on(name: 'session/event', listener: (session: HostSession, event: { type: string; seq: number; data: any }) => void): Dispose
  effect(callback: () => unknown): unknown
  webServer: { register(route: { kind: 'exact'; path: string; handler: import('node:http').RequestListener }): unknown }
}
