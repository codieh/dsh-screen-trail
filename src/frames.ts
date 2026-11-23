/** 同时比较全局和局部 RGB 变化；图像差分只决定候选，不决定是否产生新活动。 */
import type { Thumbnail } from './types.js'
export function frameDifference(current: Thumbnail, previous: Thumbnail | null): number {
  if (!previous || current.width !== previous.width || current.height !== previous.height) return 1
  const { width, height, pixels } = current
  let changed = 0; let maxBlockRatio = 0
  for (let y = 0; y < height; y += 16) {
    for (let x = 0; x < width; x += 16) {
      let blockChanged = 0
      const right = Math.min(width, x + 16); const bottom = Math.min(height, y + 16)
      for (let by = y; by < bottom; by += 1) {
        for (let bx = x; bx < right; bx += 1) {
          const at = by * width + bx; const colorAt = at * 3
          const colorChanged = current.rgb && previous.rgb && (
            Math.abs(current.rgb[colorAt] - previous.rgb[colorAt]) > 20
            || Math.abs(current.rgb[colorAt + 1] - previous.rgb[colorAt + 1]) > 20
            || Math.abs(current.rgb[colorAt + 2] - previous.rgb[colorAt + 2]) > 20)
          if (colorChanged || Math.abs(pixels[at] - previous.pixels[at]) > 20) blockChanged += 1
        }
      }
      changed += blockChanged
      maxBlockRatio = Math.max(maxBlockRatio, blockChanged / ((right - x) * (bottom - y)))
    }
  }
  return Math.max(changed / pixels.length, maxBlockRatio * 0.1)
}

export class SimpleSelector {
  declare frame: Thumbnail | null;
  declare key: string | null;
  declare context: string | null;

  constructor() { this.reset() }
  reset() { this.frame = null; this.key = null; this.context = null }
  consider(frame: Thumbnail, key: string, context: string, manual = false) {
    const score = frameDifference(frame, this.frame)
    if (!manual && this.frame && this.context === context && (key === this.key || score < 0.003)) return { kind: 'extend', score }
    const reason = manual ? 'manual' : !this.frame ? 'first' : context !== this.context ? 'context' : 'change'
    this.frame = frame; this.key = key; this.context = context
    return { kind: 'keep', reason, score }
  }
}

/** 固定首尾，其余按等间隔目标时间取最近候选，不对窗口、触发原因或画面变化加权。 */
export function representatives<T extends { at: number }>(records: readonly T[], limit = 6): T[] {
  if (!Number.isSafeInteger(limit) || limit < 2) throw new Error('representative limit must be an integer of at least 2')
  records = [...records].sort((a, b) => a.at - b.at)
  if (records.length <= limit) return [...records]
  if (limit === 2) return [records[0], records.at(-1)!]
  const selected = new Set([0, records.length - 1])
  const first = records[0].at; const span = records.at(-1)!.at - first
  for (let slot = 1; slot < limit - 1; slot += 1) {
    const target = first + span * slot / (limit - 1)
    let closest = -1
    for (let index = 1; index < records.length - 1; index += 1) {
      if (selected.has(index)) continue
      // 同距时保留时间更早的候选；同一条观察不会重复占用选图名额。
      if (closest === -1 || Math.abs(records[index].at - target) < Math.abs(records[closest].at - target)) closest = index
    }
    selected.add(closest)
  }
  return records.filter((_, index) => selected.has(index))
}
