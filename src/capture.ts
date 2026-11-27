import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ChildProcess } from 'node:child_process'
import type { CaptureFrame, CaptureOptions } from './types.js'

export const SURFACE_MARKER = '[dsh-screen-trail]'
const cancelled = () => Object.assign(new Error('capture start cancelled'), { name: 'AbortError' })

/** 校验跨进程帧并校验内容指纹；损坏数据不得进入截图和模型队列。 */
export function decodeFrame(message: any): CaptureFrame {
  if (!Number.isFinite(message.at) || !message.context || typeof message.context !== 'object' || Array.isArray(message.context)
    || !Number.isInteger(message.width) || !Number.isInteger(message.height)
    || message.width < 1 || message.height < 1 || Math.max(message.width, message.height) > 256
    || !/^[a-f0-9]{64}$/.test(message.imageId || '') || typeof message.jpeg !== 'string' || typeof message.rgba !== 'string') {
    throw new Error('invalid native frame metadata')
  }
  const jpeg = Buffer.from(message.jpeg, 'base64')
  const rgba = Buffer.from(message.rgba, 'base64')
  if (jpeg.length < 4 || jpeg.length > 8 * 1024 * 1024 || jpeg[0] !== 255 || jpeg[1] !== 216
    || rgba.length !== message.width * message.height * 4 || jpeg.toString('base64') !== message.jpeg || rgba.toString('base64') !== message.rgba
    || createHash('sha256').update(jpeg).digest('hex') !== message.imageId) {
    throw new Error('native frame data or image fingerprint is invalid')
  }
  const pixels = new Uint8Array(message.width * message.height)
  const rgb = new Uint8Array(pixels.length * 3)
  for (let i = 0; i < pixels.length; i += 1) {
    const at = i * 4
    pixels[i] = Math.round(rgba[at] * 0.299 + rgba[at + 1] * 0.587 + rgba[at + 2] * 0.114)
    rgb.set(rgba.subarray(at, at + 3), i * 3)
  }
  return { at: message.at, context: message.context, imageId: message.imageId, jpeg,
    thumbnail: { width: message.width, height: message.height, pixels, rgb } }
}

/** 原生流保持运行，只有选中的帧落盘；不再启动输入监听或逐帧外部转换命令。 */
export class MacCapture {
  declare root: string;
  declare log: CaptureOptions['log'];
  declare spawn: typeof spawn;
  declare maxDimension: number;
  declare sampleIntervalSec: number;
  declare onFrame: CaptureOptions['onFrame'];
  declare onPresence: CaptureOptions['onPresence'];
  declare onError: CaptureOptions['onError'];
  declare setTimer: typeof setTimeout;
  declare clearTimer: typeof clearTimeout;
  declare state: string;
  declare epoch: number;
  declare wakeTimer: ReturnType<typeof setTimeout> | null;
  declare recovering: boolean;
  declare jobs: Set<ChildProcess>;
  declare preparing: Promise<string> | null;
  declare streamChild: ChildProcess | null;
  declare starting: Promise<void> | null;

  constructor({ root, onFrame, onPresence, onError, log, maxDimension = 1600, sampleIntervalSec = 5, spawnProcess = spawn, setTimer = setTimeout, clearTimer = clearTimeout }: CaptureOptions) {
    if (!Number.isSafeInteger(sampleIntervalSec) || sampleIntervalSec < 1) throw new Error('sampleIntervalSec must be a positive integer')
    Object.assign(this, { root, onFrame, onPresence, onError, log, maxDimension, sampleIntervalSec, spawn: spawnProcess, setTimer, clearTimer })
    this.state = 'stopped'
    this.epoch = 0
    this.wakeTimer = null
    this.recovering = false
    this.jobs = new Set()
  }

  async binary(): Promise<string> {
    if (!this.preparing) this.preparing = (async () => {
      const source = fileURLToPath(new URL('../native/capture.swift', import.meta.url))
      const hash = createHash('sha256').update(await fs.readFile(source)).digest('hex').slice(0, 16)
      const directory = path.join(this.root, 'native')
      await fs.mkdir(directory, { recursive: true, mode: 0o700 })
      const binary = path.join(directory, `capture-${hash}`)
      try { await fs.access(binary); return binary } catch (error) { if (error.code !== 'ENOENT') throw error }
      this.log('capture.compiling', { source })
      await new Promise<void>((resolve, reject) => {
        const child = this.spawn('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-O', '-module-cache-path',
          path.join(directory, 'module-cache'), source, '-o', binary], { stdio: ['ignore', 'ignore', 'pipe'] })
        let detail = ''
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('capture helper compilation timed out')) }, 120000)
        child.stderr.on('data', (data) => { detail = `${detail}${data}`.slice(-16000) })
        child.once('error', (error) => { clearTimeout(timer); reject(error) })
        child.once('close', (code) => {
          clearTimeout(timer)
          if (detail.trim()) this.log('capture.compiler_output', { detail: detail.trim() })
          code === 0 ? resolve() : reject(new Error(`capture helper compile failed (${code}): ${detail}`))
        })
      })
      this.log('capture.compiled', { binary })
      return binary
    })().catch((error) => { this.preparing = null; this.state = 'failed'; throw error })
    return this.preparing
  }

  launch(single: true): Promise<CaptureFrame>;
  launch(single?: false): Promise<void>;
  async launch(single = false): Promise<CaptureFrame | void> {
    const epoch = this.epoch
    const binary = await this.binary()
    if (epoch !== this.epoch) throw cancelled()
    return new Promise<CaptureFrame | void>((resolve, reject) => {
      let ready = false
      let settled = false
      let failed = false
      let buffer = ''
      let detail = ''
      const child = this.spawn(binary, [`--dimension=${this.maxDimension}`, `--sample-interval-sec=${this.sampleIntervalSec}`,
        ...(!single && this.recovering ? ['--no-permission-prompt'] : []), ...(single ? ['--once'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] })
      if (!single) this.streamChild = child
      this.jobs.add(child)
      const timer = this.setTimer(() => fail(new Error(this.recovering && !single
        ? 'native capture wake recovery timed out before a screen frame'
        : 'native capture startup timed out; check Screen Recording permission')), 60000)
      const cleanup = () => { this.clearTimer(timer); this.jobs.delete(child) }
      const confirmStream = () => {
        this.clearTimer(timer)
        if (!single && this.recovering) {
          this.recovering = false
          this.log('capture.recovered', { firstFrameAt: Date.now() })
        }
      }
      const fail = (error) => {
        if (failed) return
        failed = true
        cleanup()
        if (epoch !== this.epoch) { child.kill(); if (!settled) reject(cancelled()); return }
        if (!single) this.cancelWake()
        if (!single || !this.streamChild) this.state = 'failed'
        child.kill()
        if (!settled) { settled = true; reject(error) }
        else this.onError(error)
      }
      child.stderr.on('data', (data) => { detail = `${detail}${data}`.slice(-16000) })
      child.stdout.on('data', (data) => {
        if (epoch !== this.epoch || failed) return
        buffer += String(data)
        if (buffer.length > 16 * 1024 * 1024) { fail(new Error('native capture protocol exceeded its size limit')); return }
        const lines = buffer.split('\n')
        buffer = lines.pop()
        for (const line of lines) {
          if (!line) continue
          try {
            const message = JSON.parse(line)
            if (message.type === 'ready') {
              ready = true
              if (!single) {
                this.state = 'ready'
                this.log('capture.ready', { displayId: message.displayId, sampleIntervalSec: message.sampleIntervalSec })
                this.onPresence({ type: 'ready', at: Date.now() })
                if (!settled) {
                  if (!this.recovering) this.clearTimer(timer)
                  settled = true; resolve()
                }
              }
            } else if (message.type === 'frame') {
              if (!ready) throw new Error('native frame arrived before ready')
              const frame = decodeFrame(message)
              if (frame.context.title?.includes(SURFACE_MARKER)) throw new Error('native self-surface exclusion was bypassed')
              confirmStream()
              if (single) { cleanup(); settled = true; resolve(frame); child.kill() }
              else this.onFrame(frame)
            } else if (message.type === 'idle' || message.type === 'excluded') {
              if (!Number.isFinite(message.at) || !message.context || typeof message.context !== 'object' || Array.isArray(message.context)) throw new Error('invalid native presence message')
              if (single && message.type === 'excluded') {
                cleanup(); settled = true
                reject(Object.assign(new Error('纪事自身页面已排除，请切换到其他窗口后再采集'), { code: 'SELF_SURFACE' }))
                child.kill()
              } else {
                if (ready) confirmStream()
                this.onPresence(message)
              }
            } else if (message.type === 'waiting' || message.type === 'wake') {
              if (single || !Number.isFinite(message.at) || typeof message.reason !== 'string' || !message.reason) throw new Error('invalid native screen lifecycle message')
              if (message.type === 'waiting') {
                if (this.recovering && message.reason === 'source-unavailable') {
                  throw Object.assign(new Error(`native capture source unavailable after wake rebuild: ${message.message || message.reason}`), {
                    domain: message.domain, code: message.code,
                  })
                }
                // 真正再次熄屏可等待下一轮亮屏；源再次失效不能形成自动重启循环。
                this.recovering = false
                this.cancelWake(); ready = false; this.state = 'waiting'
                this.log('capture.waiting', message); this.onPresence(message)
                if (!settled) { this.clearTimer(timer); settled = true; resolve() }
              } else if (this.state === 'waiting' && this.wakeTimer === null) {
                this.log('capture.wake', message)
                // 每次亮屏只重建一次；主动停止会撤销定时器及旧进程的全部回调。
                this.wakeTimer = this.setTimer(() => {
                  this.wakeTimer = null
                  if (epoch !== this.epoch || this.streamChild !== child || this.state !== 'waiting') return
                  this.log('capture.wake_restart', { delayMs: 1000 })
                  this.stop()
                  this.recovering = true
                  const currentEpoch = this.epoch
                  void this.start().catch((error) => { if (currentEpoch === this.epoch) this.onError(error) })
                }, 1000)
              }
            } else if (message.type === 'diagnostic') {
              if (typeof message.reason !== 'string' || !message.reason) throw new Error('invalid native diagnostic')
              this.log('capture.native_diagnostic', message)
            } else if (message.type === 'error') {
              const suffix = typeof message.domain === 'string' && Number.isInteger(message.code) ? ` [${message.domain} ${message.code}]` : ''
              throw Object.assign(new Error(`${message.message || 'native capture failed'}${suffix}`), { domain: message.domain, code: message.code })
            }
            else throw new Error(`unknown native capture message: ${message.type}`)
          } catch (error) { fail(error); break }
        }
      })
      child.once('error', fail)
      child.once('close', (code) => {
        cleanup()
        if (this.streamChild === child) this.streamChild = null
        if (epoch !== this.epoch) { if (!settled) { settled = true; reject(cancelled()) }; return }
        if ((!single || !settled) && this.state !== 'failed') fail(new Error(detail || `native capture exited unexpectedly (${code})`))
        if (single && this.jobs.size === 0 && this.state !== 'failed') this.state = 'stopped'
      })
    })
  }

  async start({ confirmFrame = false } = {}) {
    if (this.starting) return this.starting
    if (this.streamChild && ['ready', 'waiting'].includes(this.state)) return
    if (confirmFrame) this.recovering = true
    this.state = 'starting'
    const epoch = this.epoch
    const task = this.launch().finally(() => { if (this.starting === task) this.starting = null })
    this.starting = task
    try { await task } catch (error) { if (epoch === this.epoch) this.state = 'failed'; throw error }
  }

  once() { return this.launch(true) }

  cancelWake() { if (this.wakeTimer !== null) this.clearTimer(this.wakeTimer); this.wakeTimer = null }

  stop() {
    this.cancelWake()
    this.recovering = false
    this.epoch += 1
    this.starting = null
    this.streamChild = null
    for (const child of this.jobs) child.kill()
    this.jobs.clear()
    if (this.state !== 'failed') this.state = 'stopped'
  }
}
