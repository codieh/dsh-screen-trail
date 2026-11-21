/** 按宿主的分块协议组装文本，保留终止原因，不能把截断误当成正常结束。 */
export class AnalysisResponse {
  constructor() {
    this.blocks = new Map()
    this.finish = null
    this.usage = null
    this.reasoningCharacters = 0
    this.chunks = 0
  }

  push(chunk) {
    this.chunks += 1
    if (this.finish) throw Object.assign(new Error('model emitted data after its terminal finish'), { code: 'STREAM_PROTOCOL' })
    if (chunk.type === 'text-delta') {
      if (!Number.isSafeInteger(chunk.index) || chunk.index < 0 || typeof chunk.text !== 'string') {
        throw Object.assign(new Error('invalid model text block'), { code: 'STREAM_PROTOCOL' })
      }
      this.blocks.set(chunk.index, (this.blocks.get(chunk.index) || '') + chunk.text)
    } else if (chunk.type === 'block-end' && chunk.block?.type === 'text') {
      if (!Number.isSafeInteger(chunk.index) || typeof chunk.block.text !== 'string') throw new Error('invalid completed text block')
      // block-end 是宿主确认的完整块，可能包含 block-start 的初始文本。
      this.blocks.set(chunk.index, chunk.block.text)
    } else if (chunk.type === 'reasoning-delta') {
      this.reasoningCharacters += chunk.text.length
    } else if (chunk.type === 'usage') {
      this.usage = Object.fromEntries(['inputTokens', 'outputTokens', 'totalTokens', 'reasoningTokens', 'cacheReadTokens', 'cacheWriteTokens']
        .filter((key) => Number.isFinite(chunk.usage?.[key])).map((key) => [key, chunk.usage[key]]))
    } else if (chunk.type === 'finish') {
      if (typeof chunk.reason?.kind !== 'string') throw new Error('model finish reason is missing')
      this.finish = { ...chunk.reason }
    }
  }

  text() {
    return [...this.blocks].sort(([a], [b]) => a - b).map(([, text]) => text).join('')
  }

  assertComplete(maxTokens) {
    let code
    let message
    if (!this.finish) {
      code = 'MISSING_FINISH'
      message = '模型流未提供结束原因，不能确认响应完整'
    } else if (this.finish.kind === 'max-tokens') {
      code = 'OUTPUT_TRUNCATED'
      message = `模型输出达到上限（maxTokens=${maxTokens}，outputTokens=${this.usage?.outputTokens ?? 'unknown'}），响应未完成`
    } else if (['error', 'aborted'].includes(this.finish.kind)) {
      code = this.finish.failure?.code || 'MODEL_STREAM_FAILED'
      message = this.finish.failure?.message || `model finished with ${this.finish.kind}`
    } else if (this.finish.kind !== 'stop') {
      code = 'UNEXPECTED_FINISH'
      message = `unexpected model finish: ${this.finish.kind}`
    }
    if (code) throw Object.assign(new Error(message), { code })
  }

  metadata() {
    return { finish: this.finish, usage: this.usage, reasoningCharacters: this.reasoningCharacters,
      responseCharacters: this.text().length, textBlocks: this.blocks.size, chunks: this.chunks }
  }
}
