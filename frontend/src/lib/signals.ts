/**
 * 用户行为信号收集 (P0) — Web 客户端.
 *
 * 设计:
 * - 模块级 queue, 满 10 条或 5 秒 flush 一次.
 * - POST /api/signals, credentials: 'include', client: 'web'.
 * - best-effort: 失败丢弃, 401 静默, 不阻塞任何业务调用, 永不 throw.
 * - session_id: 模块加载时 crypto.randomUUID(), 整个会话复用.
 * - opt-out: setEnabled(false) 后所有 track 都是 noop.
 *
 * 与 backend/routes/signals.py ALLOWED_EVENT_TYPES + PAYLOAD_SCHEMA 严格对齐.
 * payload 永远只能是元数据 — 题目/答案/反思内容禁止入参.
 */
export type SignalEventType =
  | 'session.start'
  | 'session.end'
  | 'task.checkin.toggle'
  | 'task.override.skip'
  | 'task.override.replace'
  | 'weekly_goal.set'
  | 'mistake.create'
  | 'mistake.view_detail'
  | 'mistake.mark_mastered'
  | 'practice.item.start'
  | 'practice.item.input_pause'
  | 'practice.item.hint_used'
  | 'practice.item.submit'
  | 'practice.item.skip'
  | 'essay.create'
  | 'journal.write'
  | 'agent.suggestion.shown'
  | 'agent.suggestion.accepted'
  | 'agent.suggestion.dismissed'

type Payload = Record<string, string | number | boolean | null | undefined>

type QueuedEvent = {
  event_type: SignalEventType
  related_table?: string
  related_id?: number
  payload?: Payload
  session_id: string
  client: 'web'
  ts: number
}

type TrackOpts = {
  related_table?: string
  related_id?: number
  payload?: Payload
}

const ENDPOINT = '/api/signals'
const PROFILE_ENDPOINT = '/api/me/profile-settings'
const FLUSH_THRESHOLD = 10
const FLUSH_INTERVAL_MS = 5_000

let queue: QueuedEvent[] = []
let flushTimer: number | null = null
let enabled = true
let sessionId = generateSessionId()
let sessionStartMs = Date.now()

function generateSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID()
    }
  } catch {
    // fallthrough
  }
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function scheduleFlush() {
  if (flushTimer != null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
}

function clearTimer() {
  if (flushTimer != null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return
  const events = queue
  queue = []
  clearTimer()
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    })
    // 401 / 其它错误一律静默 — signals 是 best-effort
    if (!res.ok) return
  } catch {
    // 网络失败也丢弃, 不重试 (避免回灌)
  }
}

/** 用 sendBeacon 同步发出 (适合 unload). */
function flushBeacon(): void {
  if (queue.length === 0) return
  const events = queue
  queue = []
  clearTimer()
  try {
    const blob = new Blob([JSON.stringify({ events })], { type: 'application/json' })
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(ENDPOINT, blob)
      return
    }
  } catch {
    // ignore
  }
  // fallback (尽力而为, unload 可能跑不完)
  try {
    void fetch(ENDPOINT, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
      keepalive: true,
    })
  } catch {
    // swallow
  }
}

function track(eventType: SignalEventType, opts: TrackOpts = {}): void {
  if (!enabled) return
  try {
    queue.push({
      event_type: eventType,
      related_table: opts.related_table,
      related_id: opts.related_id,
      payload: opts.payload,
      session_id: sessionId,
      client: 'web',
      ts: Date.now(),
    })
    if (queue.length >= FLUSH_THRESHOLD) {
      void flush()
    } else {
      scheduleFlush()
    }
  } catch {
    // 永不抛异常打断业务
  }
}

function setEnabled(value: boolean): void {
  enabled = !!value
  if (!enabled) {
    queue = []
    clearTimer()
  }
}

function isEnabled(): boolean {
  return enabled
}

async function refreshSettings(): Promise<{
  signals_enabled: boolean
  profile_enabled: boolean
  journal_volume_in_profile: boolean
} | null> {
  try {
    const res = await fetch(PROFILE_ENDPOINT, { credentials: 'include' })
    if (!res.ok) return null
    const j = await res.json()
    setEnabled(!!j.signals_enabled)
    return {
      signals_enabled: !!j.signals_enabled,
      profile_enabled: !!j.profile_enabled,
      journal_volume_in_profile: !!j.journal_volume_in_profile,
    }
  } catch {
    return null
  }
}

function startSession(opts: { platform?: string; version?: string; device_model?: string } = {}): void {
  sessionStartMs = Date.now()
  // 每次 startSession 重置 sessionId — 与 mobile 一致, 应用恢复到前台算新会话
  sessionId = generateSessionId()
  const payload: Payload = {
    platform: opts.platform || 'web',
    version: opts.version || resolveVersion(),
  }
  if (opts.device_model) payload.device_model = opts.device_model
  track('session.start', { payload })
}

function endSession(useBeacon = false): void {
  if (!enabled) return
  const durationSecs = Math.round((Date.now() - sessionStartMs) / 1000)
  // 直接入队 + 立即 flush. unload 场景用 beacon.
  try {
    queue.push({
      event_type: 'session.end',
      payload: { duration_secs: durationSecs },
      session_id: sessionId,
      client: 'web',
      ts: Date.now(),
    })
  } catch {
    return
  }
  if (useBeacon) {
    flushBeacon()
  } else {
    void flush()
  }
}

function flushNow(useBeacon = false): void {
  if (useBeacon) flushBeacon()
  else void flush()
}

function resolveVersion(): string {
  try {
    const v = (import.meta as any)?.env?.PACKAGE_VERSION
    if (typeof v === 'string' && v) return v
  } catch {
    // ignore
  }
  return 'web'
}

export const signals = {
  track,
  setEnabled,
  isEnabled,
  refreshSettings,
  startSession,
  endSession,
  flushNow,
}

export default signals
