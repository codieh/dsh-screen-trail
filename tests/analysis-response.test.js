import assert from 'node:assert/strict'
import test from 'node:test'
import { AnalysisResponse } from '../analysis-response.js'

test('text blocks are assembled by index and authoritative block ends are not appended twice', () => {
  const response = new AnalysisResponse()
  response.push({ type: 'text-delta', index: 2, text: '2}' })
  response.push({ type: 'text-delta', index: 0, text: '1,' })
  response.push({ type: 'block-end', index: 0, block: { type: 'text', text: '{"a":1,"b":' } })
  response.push({ type: 'finish', reason: { kind: 'stop' } })
  response.assertComplete(100)
  assert.deepEqual(JSON.parse(response.text()), { a: 1, b: 2 })
})

test('reasoning text is counted separately from JSON output and usage is preserved', () => {
  const response = new AnalysisResponse()
  response.push({ type: 'reasoning-delta', index: 0, text: 'thinking' })
  response.push({ type: 'text-delta', index: 1, text: '{}' })
  response.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: 20, reasoningTokens: 15 } })
  response.push({ type: 'finish', reason: { kind: 'stop' } })
  assert.equal(response.text(), '{}')
  assert.equal(response.metadata().reasoningCharacters, 8)
  assert.equal(response.metadata().usage.reasoningTokens, 15)
})

test('truncated, failed, missing and unexpected finishes cannot pass as normal completion', () => {
  for (const [reason, code] of [[{ kind: 'max-tokens' }, 'OUTPUT_TRUNCATED'], [{ kind: 'tool-calls' }, 'UNEXPECTED_FINISH'],
    [{ kind: 'error', failure: { code: 'SERVER', message: 'provider failed' } }, 'SERVER'], [null, 'MISSING_FINISH']]) {
    const response = new AnalysisResponse()
    if (reason) response.push({ type: 'finish', reason })
    assert.throws(() => response.assertComplete(100), (error) => error.code === code)
  }
})

test('chunks after a terminal finish are reported as a protocol error', () => {
  const response = new AnalysisResponse()
  response.push({ type: 'finish', reason: { kind: 'stop' } })
  assert.throws(() => response.push({ type: 'text-delta', index: 0, text: 'extra' }), { code: 'STREAM_PROTOCOL' })
})
