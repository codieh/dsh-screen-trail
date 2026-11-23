/** 保持宿主提供的全局脚本协议。 */
interface Window { __ModuleLoader__: { load(entry: { id: string; factory(require: (id: string) => any): any }): void } }
window.__ModuleLoader__.load({
  id: '@local/dsh-screen-trail',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'screen-trail'
    const PANEL_ID = 'screen-trail'
    const API = '/screen-trail/api'
    const MAX_ERROR_CHARS = 180
    const SURFACE_MARKER = '[dsh-screen-trail]'

    const EN = {
      panel: 'Screen trail',
      title: 'Screen trail',
      intro: 'Samples the primary display at your chosen interval (5 seconds by default). Every 5 minutes, up to 20 representative images become activities. Low-value images are discarded. This recorder page is excluded.',
      start: 'Start',
      stop: 'Pause',
      capture: 'Analyse now',
      clear: 'Clear all',
      confirmClear: 'Pause and clear every record?',
      yes: 'Clear',
      no: 'Cancel',
      interval: 'Analysis window',
      seconds: 'seconds',
      minutes: 'minutes',
      oneMinute: 'minute',
      recording: 'Observing',
      paused: 'Paused',
      idle: 'Not recording',
      working: 'Analysing',
      sampling: 'Sampling interval',
      activities: 'Activities',
      evidence: 'Screenshots',
      observations: 'Capture evidence',
      selfExcluded: 'This recorder page is excluded. Switch to another app or a normal chat to collect work; observing continues in the background.',
      waitingTitle: 'Organising your activity',
      waitingBody: 'Images are collected. The next batch will create or update an activity only when there is meaningful new work.',
      evidenceAnalysed: 'Analysed; a new activity is not always needed.',
      evidenceSampledOut: 'Not selected as a representative image for this batch.',
      samples: 'Samples',
      keyframes: 'Observations',
      queued: 'Queued',
      analysed: 'Analysed',
      pendingAnalysis: 'Waiting for analysis',
      firstFrame: 'First capture',
      changedFrame: 'Screen changed',
      motionFrame: 'Continuous changes',
      heartbeatFrame: 'Timed capture',
      manualFrame: 'Manual capture',
      change: 'Progress',
      contextFrame: 'Context changed',
      clickFrame: 'Click',
      submitFrame: 'Submitted',
      typingFrame: 'Typing paused',
      scrollFrame: 'Scrolling stopped',
      resultFrame: 'Result',
      returnFrame: 'Returned to an earlier screen',
      reuse: 'Shared image',
      modelCalls: 'Model requests',
      eventSource: 'Native capture',
      eventReady: 'Listening',
      eventStopped: 'Stopped',
      eventStarting: 'Starting',
      eventFailed: 'Failed',
      screenWaiting: 'Waiting for the screen to wake',
      eventDisabled: 'Polling only',
      accessibility: 'Accessibility',
      inputMonitoring: 'Input Monitoring',
      observedUntil: 'Observed until',
      draining: 'Capture paused; processing backlog',
      backlogTitle: 'Processing the observation backlog',
      backlogBody: 'Capture resumes automatically after the queue drops to',
      analysisRequest: 'Request',
      analysisFinish: 'Finish',
      analysisUsage: 'Output tokens / budget',
      emptyTitle: 'Nothing captured yet',
      emptyBody: 'Start observing, then switch to another window. This page will not record itself. Representative images are analysed together into activities.',
      emptyNote: 'macOS asks for Screen Recording permission on the first capture.',
      permissionTitle: 'Screen Recording permission is required',
      permissionBody: 'macOS blocks screen capture until this application is allowed. Open System Settings, enable Screen & System Audio Recording for DeepSeek Harness, then restart the application.',
      openSettings: 'Open System Settings',
      retry: 'Try again',
      failed: 'An operation failed',
      analysisFailed: 'Analysis failed',
      noAnalysis: 'No analysis for this capture.',
      details: 'Details',
      hideDetails: 'Hide details',
      entities: 'Extracted',
      todos: 'Next steps',
      tags: 'Topics',
      delete: 'Delete entry',
      deleteOne: 'Delete',
      model: 'Model',
      untitled: 'Untitled screen',
      openImage: 'Open screenshot',
      closeImage: 'Close screenshot',
    }

    const ZH = {
      panel: '屏幕纪事',
      title: '屏幕纪事',
      intro: '按自定义间隔采样主屏，默认每 5 秒一次；每 5 分钟选最多 20 张图整理为事件，无价值画面直接舍弃。纪事自身页面不采集。',
      start: '开始记录',
      stop: '暂停',
      capture: '立即分析',
      clear: '清空',
      confirmClear: '暂停并清空全部记录？',
      yes: '清空',
      no: '取消',
      interval: '分析间隔',
      seconds: '秒',
      minutes: '分钟',
      oneMinute: '分钟',
      recording: '观察中',
      paused: '已暂停',
      idle: '未记录',
      working: '分析中',
      sampling: '采样间隔',
      activities: '活动',
      evidence: '截图依据',
      observations: '采集证据',
      selfExcluded: '纪事自身页面已排除。请切换到其他应用或正常聊天页面，后台会继续采集。',
      waitingTitle: '正在整理活动',
      waitingBody: '已采集画面，等待批量分析。只有出现有意义的新内容才会新增或更新活动。',
      evidenceAnalysed: '已分析，不一定新增活动。',
      evidenceSampledOut: '本批次未选为代表图，未送入模型。',
      samples: '已采样',
      keyframes: '观察记录',
      queued: '待分析',
      analysed: '已分析',
      pendingAnalysis: '等待分析',
      firstFrame: '首次采集',
      changedFrame: '画面变化',
      motionFrame: '连续变化',
      heartbeatFrame: '定时保底',
      manualFrame: '手动采集',
      change: '进展',
      contextFrame: '上下文切换',
      clickFrame: '点击',
      submitFrame: '提交',
      typingFrame: '输入停顿',
      scrollFrame: '滚动停止',
      resultFrame: '操作结果',
      returnFrame: '返回先前画面',
      reuse: '图片复用',
      modelCalls: '模型请求',
      eventSource: '原生采集',
      eventReady: '监听中',
      eventStopped: '已停止',
      eventStarting: '启动中',
      eventFailed: '失败',
      screenWaiting: '等待屏幕恢复',
      eventDisabled: '仅轮询',
      accessibility: '辅助功能',
      inputMonitoring: '输入监控',
      observedUntil: '观察至',
      draining: '暂停采集，正在处理积压',
      backlogTitle: '正在分析积压记录',
      backlogBody: '队列降至以下条数后自动恢复采集',
      analysisRequest: '请求',
      analysisFinish: '结束原因',
      analysisUsage: '输出 token / 预算',
      emptyTitle: '还没有记录',
      emptyBody: '开始后请切换到其他窗口，本页面不会采集自己。模型会将多张代表图合并理解为一段活动。',
      emptyNote: '首次截屏时 macOS 会请求“屏幕录制”权限。',
      permissionTitle: '需要“屏幕录制”权限',
      permissionBody: 'macOS 未允许本应用截屏。请打开系统设置，在“隐私与安全性 › 屏幕与系统音频录制”中勾选 DeepSeek Harness，然后重启应用。',
      openSettings: '打开系统设置',
      retry: '重试',
      failed: '操作出现错误',
      analysisFailed: '分析失败',
      noAnalysis: '这次截屏没有分析结果。',
      details: '详情',
      hideDetails: '收起',
      entities: '提取信息',
      todos: '待办',
      tags: '主题',
      delete: '删除这条',
      deleteOne: '删除',
      model: '模型',
      untitled: '未命名画面',
      openImage: '查看截图',
      closeImage: '关闭截图',
    }

    const CSS = `
.st-page { display:flex; flex-direction:column; width:100%; height:100%; min-height:0; overflow:hidden;
  background:var(--dsw-alias-bg-base); color:var(--dsw-alias-label-primary);
  font-size:14px; line-height:1.6; }
.st-page :focus-visible { outline:2px solid var(--dsw-alias-brand-primary); outline-offset:2px; }
.st-head { flex:none; padding:calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(24px,4vw,48px) 14px;
  border-bottom:0.5px solid var(--dsw-alias-border-l1);
  background:var(--dsw-alias-bg-base); }
.st-headrow { display:flex; flex-wrap:wrap; align-items:center; gap:10px 12px; max-width:960px; margin:0 auto; }
.st-titleblock { display:flex; flex-direction:column; min-width:0; margin-right:auto; }
.st-title { margin:0; font-size:20px; line-height:28px; font-weight:500; letter-spacing:-0.01em; }
.st-intro { margin:2px 0 0; font-size:12px; line-height:18px; color:var(--dsw-alias-label-secondary); max-width:54ch; }
.st-status { display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 10px; border-radius:13px;
  font-size:12px; color:var(--dsw-alias-label-secondary);
  background:var(--dsw-alias-bg-layer-2); border:0.5px solid var(--dsw-alias-border-l1); white-space:nowrap; }
.st-dot { width:7px; height:7px; border-radius:50%; background:var(--dsw-alias-state-idle-primary); flex:none; }
.st-dot.live { background:var(--dsw-alias-state-success-primary); box-shadow:0 0 0 3px color-mix(in srgb, var(--dsw-alias-state-success-primary) 18%, transparent); }
.st-dot.busy { background:var(--dsw-alias-brand-primary); animation:st-pulse 1.1s ease-in-out infinite; }
@keyframes st-pulse { 0%,100% { opacity:1; } 50% { opacity:0.35; } }
@media (prefers-reduced-motion: reduce) { .st-dot.busy { animation:none; } }
.st-btn { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 14px; border-radius:16px;
  font:inherit; font-size:13px; line-height:20px; cursor:pointer; white-space:nowrap;
  color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1);
  border:0.5px solid var(--dsw-alias-border-l1); transition:background .12s ease, border-color .12s ease, opacity .12s ease; }
.st-btn:hover { background:var(--dsw-alias-bg-layer-2); border-color:var(--dsw-alias-border-l2); }
.st-btn:disabled { opacity:.5; cursor:default; }
.st-btn.primary { color:var(--dsw-alias-label-primary-foreground); background:var(--dsw-alias-button-primary-fill); border-color:transparent; }
.st-btn.primary:hover { background:var(--dsw-alias-button-primary-hover); }
.st-btn.ghost { background:transparent; }
.st-select { height:32px; padding:0 8px; border-radius:16px; font:inherit; font-size:13px;
  color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-1);
  border:0.5px solid var(--dsw-alias-border-l1); cursor:pointer; }
.st-interval { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.st-stats { display:flex; flex-wrap:wrap; gap:6px 16px; max-width:960px; margin:10px auto 0;
  font-size:12px; color:var(--dsw-alias-label-secondary); }
.st-body { flex:1; min-height:0; overflow:auto; scrollbar-gutter:stable; }
.st-inner { max-width:960px; margin:0 auto; padding:16px clamp(24px,4vw,48px) 56px; display:flex; flex-direction:column; gap:12px; }
.st-banner { display:flex; flex-direction:column; gap:8px; padding:14px 16px; border-radius:14px;
  border:0.5px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 45%, transparent);
  background:color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, var(--dsw-alias-bg-layer-1)); }
.st-banner h2 { margin:0; font-size:14px; line-height:22px; font-weight:600; }
.st-banner p { margin:0; font-size:13px; color:var(--dsw-alias-label-secondary); }
.st-banner-row { display:flex; gap:8px; flex-wrap:wrap; margin-top:2px; }
.st-error { display:flex; gap:8px; padding:10px 14px; border-radius:12px; font-size:12.5px;
  color:var(--dsw-alias-state-error-primary);
  background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 8%, var(--dsw-alias-bg-layer-1));
  border:0.5px solid color-mix(in srgb, var(--dsw-alias-state-error-primary) 30%, transparent); }
.st-error code { font-family:var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); word-break:break-word; }
.st-empty { display:flex; flex-direction:column; align-items:center; gap:10px; padding:56px 24px; text-align:center;
  border-radius:18px; border:0.5px dashed var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); }
.st-empty h2 { margin:0; font-size:15px; font-weight:600; }
.st-empty p { margin:0; max-width:46ch; font-size:13px; color:var(--dsw-alias-label-secondary); }
.st-empty .st-note { margin-top:2px; }
.st-mark { width:44px; height:44px; color:var(--dsw-alias-brand-primary); opacity:.9; }
.st-card { display:flex; gap:14px; padding:12px; border-radius:16px;
  background:var(--dsw-alias-bg-layer-1); border:0.5px solid var(--dsw-alias-border-l1); }
.st-card:hover { border-color:var(--dsw-alias-border-l2); }
.st-thumb { flex:none; width:188px; height:112px; padding:0; border-radius:11px; overflow:hidden; cursor:zoom-in;
  background:var(--dsw-alias-bg-layer-2); border:0.5px solid var(--dsw-alias-border-l1); }
.st-thumb img { display:block; width:100%; height:100%; object-fit:cover; }
.st-card-body { display:flex; flex-direction:column; gap:5px; min-width:0; flex:1; }
.st-meta { display:flex; flex-wrap:wrap; align-items:center; gap:8px; font-size:12px; color:var(--dsw-alias-label-secondary); }
.st-app { padding:1px 8px; border-radius:9px; background:var(--dsw-alias-bg-layer-2);
  border:0.5px solid var(--dsw-alias-border-l1); font-size:11.5px; color:var(--dsw-alias-label-primary); }
.st-activity { margin:0; font-size:15px; line-height:23px; font-weight:600; word-break:break-word; }
.st-doc { margin:-2px 0 0; font-size:12.5px; line-height:18px; color:var(--dsw-alias-label-secondary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.st-summary { margin:0; font-size:13px; line-height:20px; color:var(--dsw-alias-label-secondary); }
.st-tags { display:flex; flex-wrap:wrap; gap:6px; }
.st-tag { padding:1px 8px; border-radius:9px; font-size:11.5px; color:var(--dsw-alias-label-secondary);
  background:color-mix(in srgb, var(--dsw-alias-brand-primary) 10%, transparent);
  border:0.5px solid color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
.st-actions { display:flex; align-items:center; gap:14px; margin-top:2px; }
.st-link { padding:4px 0; font:inherit; font-size:12.5px; color:var(--dsw-alias-brand-primary);
  background:none; border:none; cursor:pointer; }
.st-link:hover { text-decoration:underline; }
.st-link.muted { color:var(--dsw-alias-label-secondary); }
.st-details { display:flex; flex-direction:column; gap:8px; margin-top:6px; padding-top:10px;
  border-top:0.5px solid var(--dsw-alias-border-l1); }
.st-section { display:flex; flex-direction:column; gap:4px; }
.st-section h4 { margin:0; font-size:12px; font-weight:500; color:var(--dsw-alias-label-secondary); }
.st-section ul { margin:0; padding-left:18px; font-size:13px; line-height:20px; }
.st-section li { color:var(--dsw-alias-label-primary); }
.st-entity { display:flex; gap:8px; font-size:12.5px; line-height:19px; }
.st-entity b { flex:none; max-width:38%; font-weight:500; color:var(--dsw-alias-label-secondary);
  overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.st-entity span { word-break:break-word; }
.st-note { font-size:12.5px; color:var(--dsw-alias-label-secondary); }
.st-preview { position:fixed; inset:0; z-index:2147483000; display:flex; align-items:center; justify-content:center;
  padding:32px; background:var(--dsw-alias-bg-mask-3); cursor:zoom-out; }
.st-preview img { max-width:92vw; max-height:88vh; border-radius:10px;
  box-shadow:0 18px 60px color-mix(in srgb, var(--dsw-alias-bg-base) 60%, transparent); }
.st-preview-close { position:absolute; top:20px; right:20px; height:32px; padding:0 14px; border-radius:16px;
  font:inherit; font-size:13px; cursor:pointer; color:var(--dsw-alias-label-primary);
  background:var(--dsw-alias-bg-overlay); border:0.5px solid var(--dsw-alias-border-l2); }
.st-confirm { display:flex; align-items:center; gap:8px; font-size:12.5px; color:var(--dsw-alias-label-secondary); }
.st-evidence { display:flex; gap:8px; flex-wrap:wrap; }
.st-evidence button { width:128px; height:82px; }
.st-observations { display:flex; flex-direction:column; gap:10px; }
.st-observations summary { cursor:pointer; color:var(--dsw-alias-label-secondary); font-size:13px; }
@media (max-width:767px) {
  .st-head { padding-inline:20px; }
  .st-inner { padding-inline:20px; }
  .st-card { flex-direction:column; }
  .st-thumb { width:100%; height:160px; }
}
`

    /**
     * Resolve one plugin HTTP path against the page's mount point.
     * @param relative - path below the plugin prefix, query allowed.
     * @returns a same-origin request path with its query string intact.
     */
    function api(relative) {
      const path = `${API}/${String(relative).replace(/^\/+/, '')}`
      if (typeof document === 'undefined') return path
      const resolved = new URL(path.replace(/^\/+/, ''), document.baseURI)
      return resolved.pathname + resolved.search
    }

    /**
     * Clip a raw error for display, keeping the full text in a tooltip.
     * @param value - raw error text.
     * @returns the display text.
     */
    function shortError(value) {
      const text = String(value ?? '').replace(/\s+/g, ' ').trim()
      return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text
    }

    /**
     * Draw the sidebar glyph: a display with a recording dot.
     * @param props - owner-provided size and selection state.
     * @returns the decorative icon.
     */
    function PanelIcon(props) {
      const size = Number(props && props.size) || 20
      const active = Boolean(props && props.active)
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
        stroke: 'currentColor', strokeWidth: active ? 1.9 : 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
        style: { display: 'block' },
      },
        h('rect', { x: 2.6, y: 4.2, width: 18.8, height: 12.6, rx: 2.4 }),
        h('path', { d: 'M8.4 20.3h7.2M12 16.8v3.5' }),
        h('circle', { cx: 12, cy: 10.5, r: 2.35, fill: 'currentColor', stroke: 'none', opacity: active ? 1 : 0.78 }),
      )
    }

    /**
     * Format one timestamp relative to now.
     * @param at - epoch milliseconds.
     * @param locale - BCP 47 tag matching the UI language.
     * @returns the relative phrase.
     */
    function relativeTime(at, locale) {
      const diff = at - Date.now()
      const abs = Math.abs(diff)
      const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
      if (abs < 45_000) return format.format(0, 'second')
      if (abs < 3_600_000) return format.format(Math.round(diff / 60_000), 'minute')
      if (abs < 86_400_000) return format.format(Math.round(diff / 3_600_000), 'hour')
      return format.format(Math.round(diff / 86_400_000), 'day')
    }

    /** @returns the clock label for one capture. */
    function clockTime(at, locale) {
      try {
        return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
      } catch {
        return new Date(at).toISOString().slice(11, 16)
      }
    }

    /**
     * The panel page: header controls plus the digest timeline.
     * @param props - framework locale seat.
     * @returns the rendered page.
     */
    function Panel(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => EN[key] ?? key
      const locale = (typeof document !== 'undefined' && document.documentElement.lang)
        || (typeof navigator !== 'undefined' && navigator.language)
        || 'en'
      const [state, setState] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [pending, setPending] = React.useState(false)
      const [open, setOpen] = React.useState(null)
      const [preview, setPreview] = React.useState(null)
      const [confirming, setConfirming] = React.useState(false)
      const seq = React.useRef(0)
      const previewRef = React.useRef(null)
      const pageRef = React.useRef(null)

      React.useEffect(() => {
        const page = pageRef.current
        let visible = false
        const mark = (active) => {
          visible = active
          const title = document.title.replace(/\s*\[dsh-screen-trail\]/g, '').trim()
          const next = active ? `${title} ${SURFACE_MARKER}` : title
          if (document.title !== next) document.title = next
        }
        // 标记只属于可见的纪事页面；宿主切换到聊天后移除，不能屏蔽整个应用。
        const titles = new MutationObserver(() => { if (visible && !document.title.includes(SURFACE_MARKER)) mark(true) })
        titles.observe(document.head, { childList: true, subtree: true, characterData: true })
        const visibility = new IntersectionObserver(([entry]) => mark(entry.isIntersecting))
        if (page) { visibility.observe(page); mark(page.getClientRects().length > 0) }
        return () => { titles.disconnect(); visibility.disconnect(); mark(false) }
      }, [])

      React.useEffect(() => {
        let alive = true
        let timer
        const poll = async () => {
          const issued = seq.current
          try {
            const response = await fetch(api('state'), {
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const next = await response.json()
            if (!alive || issued !== seq.current) return
            setState(next)
            setError(null)
          } catch (cause) {
            if (alive && issued === seq.current) setError(String((cause && cause.message) || cause))
          } finally {
            if (alive) timer = setTimeout(poll, 3500)
          }
        }
        void poll()
        return () => {
          alive = false
          if (timer) clearTimeout(timer)
        }
      }, [])

      React.useEffect(() => {
        if (!preview) return undefined
        const node = previewRef.current
        if (node && typeof node.focus === 'function') node.focus()
        const onKey = (event) => {
          if (event.key === 'Escape') setPreview(null)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [preview])

      const act = React.useCallback(async (action, extra) => {
        seq.current += 1
        setPending(true)
        try {
          const response = await fetch(api('control'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action, ...(extra || {}) }),
          })
          const next = await response.json()
          if (!next || next.ok !== true) throw new Error((next && next.error) || `HTTP ${response.status}`)
          setState(next)
          setError(null)
          return next
        } catch (cause) {
          setError(String((cause && cause.message) || cause))
          return null
        } finally {
          setPending(false)
        }
      }, [])

      const records = (state && Array.isArray(state.records)) ? state.records : []
      const observations = (state && Array.isArray(state.observations)) ? state.observations : []
      const hasData = records.length > 0 || observations.length > 0
      const running = Boolean(state && state.running)
      const screenWaiting = Boolean(state && state.captureSource === 'waiting')
      const busy = Boolean(state && state.busy)
      const sampling = Boolean(state && state.sampling)
      const analyzing = Boolean(state && state.analyzing)
      const denied = Boolean(state && state.permission === 'denied')
      const started = Boolean(state && (Number(state.captures) > 0 || records.length > 0))
      const intervalSec = (state && state.analysisWindowSec) || 300
      const sampleIntervalSec = state?.sampleIntervalSec ?? 5
      const intervalOptions = Array.from(new Set([30, 60, 120, 300, intervalSec]))
        .sort((left, right) => left - right)

      React.useEffect(() => {
        if (!hasData && confirming) setConfirming(false)
      }, [hasData, confirming])

      const intervalLabel = (value) => {
        if (value < 60) return `${value} ${t('seconds')}`
        const minutes = Math.round(value / 60)
        return `${minutes} ${minutes === 1 ? t('oneMinute') : t('minutes')}`
      }

      const statusText = `${state && state.capturePaused ? t('draining') : screenWaiting ? t('screenWaiting') : state && state.captureSource === 'starting' ? t('eventStarting') : running ? t('recording') : started ? t('paused') : t('idle')}${analyzing ? ` · ${t('working')}` : ''}`

      return h('div', { className: 'st-page', ref: pageRef, 'data-screen-trail-surface': true },
        h('style', { key: 'style' }, CSS),
        h('header', { className: 'st-head' },
          h('div', { className: 'st-headrow' },
            h('div', { className: 'st-titleblock' },
              h('h1', { className: 'st-title' }, t('title')),
              h('p', { className: 'st-intro' }, t('intro')),
            ),
            h('span', { className: 'st-status', role: 'status', 'aria-live': 'polite' },
              h('span', { className: `st-dot${busy ? ' busy' : running && !screenWaiting ? ' live' : ''}` }),
              statusText,
            ),
            h('label', { className: 'st-interval' },
              t('sampling'),
              h('input', {
                key: sampleIntervalSec,
                className: 'st-select', type: 'number', min: 1, step: 1,
                style: { width: '76px' }, defaultValue: String(sampleIntervalSec), disabled: pending || !state,
                'aria-label': t('sampling'),
                onBlur: (event) => {
                  const value = Number(event.target.value)
                  event.target.value = String(sampleIntervalSec)
                  if (value !== sampleIntervalSec) void act('setSampleInterval', { intervalSec: value })
                },
                onKeyDown: (event) => { if (event.key === 'Enter') event.currentTarget.blur() },
              }),
              t('seconds'),
            ),
            h('label', { className: 'st-interval' },
              t('interval'),
              h('select', {
                className: 'st-select',
                value: String(intervalSec),
                disabled: pending,
                'aria-label': t('interval'),
                onChange: (event) => { void act('setInterval', { intervalSec: Number(event.target.value) }) },
              }, intervalOptions.map((value) => h('option', { key: value, value: String(value) },
                intervalLabel(value),
              ))),
            ),
            h('button', {
              className: `st-btn${running ? '' : ' primary'}`,
              type: 'button',
              disabled: pending || Boolean(state && state.ready === false),
              onClick: () => { void act(running ? 'stop' : 'start') },
            }, running ? t('stop') : t('start')),
            h('button', {
              className: 'st-btn',
              type: 'button',
              disabled: pending || analyzing || !observations.some((item) => item.analysisStatus === 'pending') || Boolean(state && state.ready === false),
              onClick: () => { void act('analyzeNow') },
            }, t('capture')),
            hasData && (confirming
              ? h('span', { className: 'st-confirm', key: 'confirm' },
                t('confirmClear'),
                h('button', {
                  className: 'st-btn',
                  type: 'button',
                  onClick: () => { setConfirming(false); void act('clear') },
                }, t('yes')),
                h('button', {
                  className: 'st-btn ghost',
                  type: 'button',
                  onClick: () => setConfirming(false),
                }, t('no')),
              )
              : h('button', {
                key: 'clear',
                className: 'st-btn ghost',
                type: 'button',
                disabled: pending,
                onClick: () => setConfirming(true),
              }, t('clear'))),
          ),
          state && h('div', { className: 'st-stats' },
            h('span', null, `${t('sampling')}: ${sampleIntervalSec} ${t('seconds')}`),
            h('span', null, `${t('samples')}: ${state.captures || 0}`),
            h('span', null, `${t('keyframes')}: ${state.keyframes || 0}`),
            h('span', null, `${t('activities')}: ${records.length}`),
            h('span', null, `${t('queued')}: ${state.queueLength || 0}`),
            h('span', null, `${t('analysed')}: ${state.analyses || 0}`),
            h('span', null, `${t('modelCalls')}: ${state.modelCalls || 0}`),
            h('span', null, `${t('reuse')}: ${state.reusedImages || 0}`),
            h('span', null, `${t('eventSource')}: ${t(({ ready: 'eventReady', waiting: 'screenWaiting', starting: 'eventStarting', failed: 'eventFailed' })[state.captureSource] || 'eventStopped')}`),
          ),
        ),
        h('div', { className: 'st-body' },
          h('div', { className: 'st-inner' },
            state && running && state.selfExcluded && h('section', { className: 'st-banner', role: 'status' }, h('p', null, t('selfExcluded'))),
            state && state.capturePaused && h('section', { className: 'st-banner', role: 'status' },
              h('h2', null, t('backlogTitle')),
              h('p', null, `${t('queued')}: ${state.unfinishedCount} / ${state.pendingCapacity}. ${t('backlogBody')}: ${state.captureResumeAt}`),
            ),
            (denied || (state && state.lastError)) && h('section', {
              className: 'st-banner',
              key: 'banner',
              role: 'alert',
            },
              denied
                ? h(React.Fragment, null,
                  h('h2', null, t('permissionTitle')),
                  h('p', null, t('permissionBody')),
                  h('div', { className: 'st-banner-row' },
                    h('button', {
                      className: 'st-btn primary',
                      type: 'button',
                      onClick: () => { void act('openPermission') },
                    }, t('openSettings')),
                    h('button', {
                      className: 'st-btn',
                      type: 'button',
                      disabled: pending || sampling,
                      onClick: () => { void act('start') },
                    }, t('retry')),
                  ),
                )
                : h(React.Fragment, null,
                  h('h2', null, t('failed')),
                  h('p', { title: String(state.lastError) }, h('code', null, shortError(state.lastError))),
                  state.lastAnalysis && state.lastAnalysis.outcome === 'failed' && h('p', { className: 'st-note' },
                    `${t('analysisRequest')}: ${state.lastAnalysis.requestId} · ${t('analysisFinish')}: ${state.lastAnalysis.finish?.kind || 'missing'} · ${t('analysisUsage')}: ${state.lastAnalysis.usage?.outputTokens ?? '?'} / ${state.lastAnalysis.maxTokens}`,
                  ),
                  h('div', { className: 'st-banner-row' },
                    h('button', {
                      className: 'st-btn',
                      type: 'button',
                      disabled: pending || analyzing,
                      onClick: () => { void act(observations.some((item) => item.analysisStatus === 'failed') ? 'retryAnalysis' : 'start') },
                    }, t('retry')),
                  ),
                ),
            ),
            error && !denied && h('div', { className: 'st-error', key: 'error', role: 'alert' },
              h('code', null, shortError(error))),
            records.length === 0
              ? h('section', { className: 'st-empty', key: 'empty' },
                h('svg', {
                  className: 'st-mark', viewBox: '0 0 24 24', fill: 'none',
                  stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
                  'aria-hidden': true,
                },
                  h('rect', { x: 2.6, y: 4.2, width: 18.8, height: 12.6, rx: 2.4 }),
                  h('path', { d: 'M8.4 20.3h7.2M12 16.8v3.5' }),
                  h('circle', { cx: 12, cy: 10.5, r: 2.2, fill: 'currentColor', stroke: 'none' }),
                ),
                h('h2', null, t(observations.length ? 'waitingTitle' : 'emptyTitle')),
                h('p', null, t(observations.length ? 'waitingBody' : 'emptyBody')),
                h('button', {
                  className: 'st-btn primary',
                  type: 'button',
                  disabled: pending || running || Boolean(state && state.ready === false),
                  onClick: () => { void act('start') },
                }, screenWaiting ? t('screenWaiting') : busy ? t('working') : running ? t('recording') : t('start')),
                h('p', { className: 'st-note' }, t('emptyNote')),
              )
              : records.map((record) => renderRecord(record, {
                key: record.id,
                t,
                locale,
                expanded: open === record.id,
                onToggle: () => setOpen(open === record.id ? null : record.id),
                onPreview: () => setPreview(record.id),
                onEvidence: (id) => setPreview(id),
                onDelete: () => { void act('delete', { id: record.id }) },
              })),
            observations.length > 0 && h('details', { className: 'st-observations' },
              h('summary', null, `${t('observations')} (${observations.length})`),
              observations.map((record) => renderRecord(record, { key: record.id, t, locale, expanded: false,
                onPreview: () => setPreview(record.id), onDelete: () => { void act('delete', { id: record.id }) } }))),
          ),
        ),
        preview && h('div', {
          className: 'st-preview',
          key: 'preview',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': t('openImage'),
          tabIndex: -1,
          ref: previewRef,
          onClick: () => setPreview(null),
        },
          h('img', { src: api(`image?id=${encodeURIComponent(preview)}`), alt: t('openImage') }),
          h('button', {
            className: 'st-preview-close',
            type: 'button',
            onClick: (event) => { event.stopPropagation(); setPreview(null) },
          }, t('closeImage')),
        ),
      )
    }

    /**
     * Render one digest entry.
     * @param record - stored digest record.
     * @param options - locale, expansion, and callbacks.
     * @returns the card element.
     */
    function renderRecord(record, options) {
      const { t, locale, expanded, onToggle, onPreview } = options
      const analysis = record.analysis || null
      const reasons = { first: 'firstFrame', change: 'changedFrame', change_start: 'changedFrame', change_end: 'resultFrame',
        change_return: 'returnFrame', context: 'contextFrame', click: 'clickFrame', submit: 'submitFrame', typing_pause: 'typingFrame',
        scroll_stop: 'scrollFrame', result: 'resultFrame', motion: 'motionFrame', heartbeat: 'heartbeatFrame', manual: 'manualFrame' }
      const context = record.context || {}
      const heading = (analysis && (analysis.activity || analysis.title)) || context.title || t('untitled')
      const documentTitle = context.title || (analysis && analysis.title)
      const title = documentTitle && documentTitle !== heading ? documentTitle : ''
      const appName = context.app || (analysis && analysis.app)
      const hasDetails = Boolean(analysis
        && ((analysis.details && analysis.details.length)
          || (analysis.entities && analysis.entities.length)
          || (analysis.todos && analysis.todos.length)
          || analysis.model || (record.evidence && record.evidence.length)))
      return h('article', { className: 'st-card', key: options.key },
        h('button', {
          className: 'st-thumb',
          type: 'button',
          title: t('openImage'),
          'aria-label': `${t('openImage')} ${heading}`,
          onClick: onPreview,
        }, h('img', {
          src: api(`image?id=${encodeURIComponent(record.id)}`),
          alt: heading,
          loading: 'lazy',
        })),
        h('div', { className: 'st-card-body' },
          h('div', { className: 'st-meta' },
            h('span', null, clockTime(record.at, locale)),
            h('span', null, relativeTime(record.at, locale)),
            record.lastSeenAt > record.at ? h('span', null, `${t('observedUntil')} ${clockTime(record.lastSeenAt, locale)}`) : null,
            record.imageReused ? h('span', null, t('reuse')) : null,
            record.reason && reasons[record.reason] ? h('span', null, t(reasons[record.reason])) : null,
            appName ? h('span', { className: 'st-app' }, appName) : null,
          ),
          h('h3', { className: 'st-activity' }, heading),
          title ? h('p', { className: 'st-doc', title }, title) : null,
          context.url ? h('p', { className: 'st-doc', title: context.url }, context.url) : null,
          analysis && analysis.summary ? h('p', { className: 'st-summary' }, analysis.summary) : null,
          analysis && analysis.change ? h('p', { className: 'st-summary' }, `${t('change')}: ${analysis.change}`) : null,
          analysis && analysis.tags && analysis.tags.length
            ? h('div', { className: 'st-tags' }, analysis.tags.map((tag) => h('span', { className: 'st-tag', key: tag }, tag)))
            : null,
          record.analysisError
            ? h('p', { className: 'st-note', title: String(record.analysisError) },
              `${t('analysisFailed')} · ${shortError(record.analysisError)}`)
            : !analysis ? h('p', { className: 'st-note' },
              record.analysisStatus === 'complete' ? t(record.selectedForAnalysis ? 'evidenceAnalysed' : 'evidenceSampledOut')
                : record.analysisStatus === 'analyzing' ? t('working')
                : record.analysisStatus === 'pending' ? t('pendingAnalysis') : t('noAnalysis')) : null,
          h('div', { className: 'st-actions' },
            hasDetails
              ? h('button', {
                className: 'st-link',
                type: 'button',
                'aria-expanded': expanded,
                onClick: onToggle,
              }, expanded ? t('hideDetails') : t('details'))
              : null,
            h('button', {
              className: 'st-link muted',
              type: 'button',
              'aria-label': `${t('delete')} · ${heading}`,
              onClick: options.onDelete,
            }, t('deleteOne')),
          ),
          expanded && hasDetails && h('div', { className: 'st-details' },
            record.evidence && record.evidence.length ? h('div', { className: 'st-section' },
              h('h4', null, `${t('evidence')} (${record.evidence.length})`),
              h('div', { className: 'st-evidence' }, record.evidence.map((frame) => h('button', { key: frame.id, className: 'st-thumb', type: 'button',
                title: clockTime(frame.at, locale), 'aria-label': `${t('openImage')} ${clockTime(frame.at, locale)}`,
                onClick: () => options.onEvidence(frame.id) }, h('img', { src: api(`image?id=${encodeURIComponent(frame.id)}`), alt: clockTime(frame.at, locale), loading: 'lazy' }))))) : null,
            analysis.details && analysis.details.length
              ? h('div', { className: 'st-section' },
                h('ul', null, analysis.details.map((line, index) => h('li', { key: index }, line))))
              : null,
            analysis.entities && analysis.entities.length
              ? h('div', { className: 'st-section' },
                h('h4', null, t('entities')),
                analysis.entities.map((entity, index) => h('div', { className: 'st-entity', key: index },
                  entity.label ? h('b', null, entity.label) : null,
                  h('span', null, entity.value),
                )))
              : null,
            analysis.todos && analysis.todos.length
              ? h('div', { className: 'st-section' },
                h('h4', null, t('todos')),
                h('ul', null, analysis.todos.map((line, index) => h('li', { key: index }, line))))
              : null,
            analysis.model
              ? h('p', { className: 'st-note' }, `${t('model')} ${analysis.model}`)
              : null,
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, 'en', EN))
        ctx.effect(() => ctx.locale.register(NS, 'zh', ZH))
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 20,
          locale: NS,
          label: () => t('panel'),
        }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
          locale: NS,
        }, Panel))
      },
    }
  },
})
