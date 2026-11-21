/** 同时比较全局和局部 RGB 变化；图像差分只决定候选，不决定是否产生新活动。 */
export function frameDifference(current, previous) {
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
  constructor() { this.reset() }
  reset() { this.frame = null; this.key = null; this.context = null }
  consider(frame, key, context, manual = false) {
    const score = frameDifference(frame, this.frame)
    if (!manual && this.frame && this.context === context && (key === this.key || score < 0.003)) return { kind: 'extend', score }
    const reason = manual ? 'manual' : !this.frame ? 'first' : context !== this.context ? 'context' : 'change'
    this.frame = frame; this.key = key; this.context = context
    return { kind: 'keep', reason, score }
  }
}

/** 固定首尾，按时间分桶覆盖整段活动，桶内优先新资源及上下文边界。 */
export function representatives(records, limit = 6) {
  if (!Number.isSafeInteger(limit) || limit < 2) throw new Error('representative limit must be an integer of at least 2')
  records = [...records].sort((a, b) => a.at - b.at)
  if (records.length <= limit) return [...records]
  if (limit === 2) return [records[0], records.at(-1)]
  const selected = new Set([records[0], records.at(-1)])
  const resource = (item) => JSON.stringify([item.imageId || item.id, item.context || null])
  const resources = new Set([...selected].map(resource))
  const buckets = Array.from({ length: limit - 2 }, () => [])
  const first = records[0].at; const span = Math.max(1, records.at(-1).at - first)
  for (const item of records.slice(1, -1)) buckets[Math.min(buckets.length - 1, Math.floor((item.at - first) / span * buckets.length))].push(item)
  const rank = (a, b) => Number(!resources.has(resource(b))) - Number(!resources.has(resource(a)))
    || Number(b.reason === 'manual') - Number(a.reason === 'manual')
    || Number(b.reason === 'context') - Number(a.reason === 'context')
    || (b.lastSeenAt - b.at || 0) - (a.lastSeenAt - a.at || 0) || (b.score || 0) - (a.score || 0) || a.at - b.at
  for (const bucket of buckets) {
    if (!bucket.length) continue
    const item = bucket.sort(rank)[0]; selected.add(item); resources.add(resource(item))
  }
  // 时间分布不均时补齐空桶预算，但不挤掉已经覆盖到的其他时段。
  while (selected.size < limit) {
    const item = records.filter((entry) => !selected.has(entry)).sort(rank)[0]
    selected.add(item); resources.add(resource(item))
  }
  return records.filter((item) => selected.has(item))
}
