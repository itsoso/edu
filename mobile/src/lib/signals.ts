/**
 * 用户行为信号收集 (P0).
 *
 * 设计:
 *   - 模块级 in-memory 队列 (失败丢弃, 不持久化)
 *   - track() 同步入队, 不阻塞 UI, 永不 throw
 *   - 满 10 条 / 5 秒触发 flush, 失败重试 1 次
 *   - 401 静默 (可能未登录)
 *   - setEnabled(false) 后 track 直接 noop
 *
 * 后端契约:
 *   POST /api/signals  body: { events: [ ... ] }
 *   GET/PUT /api/me/profile-settings
 */
import { API_BASE_URL } from './config'
import { loadToken } from './api'

const APP_VERSION = '0.0.1' // 与 package.json 同步
const BATCH_SIZE = 10
const FLUSH_INTERVAL_MS = 5000

type EventType =
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

type EventPayload = Record<string, unknown>

type QueuedEvent = {
  event_type: EventType
  related_table?: string
  related_id?: number
  payload?: EventPayload
  session_id: string
  client: string
}

type TrackOpts = {
  related_table?: string
  related_id?: number
  payload?: EventPayload
}

// --- module state ---
let enabled = true
let queue: QueuedEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let sessionStartedAt: number | null = null

// 简易 uuidv4 (无依赖)
function uuidv4(): string {
  // RFC4122-ish, 不要求强随机
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

const sessionId = uuidv4()

function scheduleFlush() {
  if (flushTimer) return
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flush()
  }, FLUSH_INTERVAL_MS)
}

async function postEvents(events: QueuedEvent[]): Promise<boolean> {
  try {
    const token = await loadToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(API_BASE_URL + '/api/signals', {
      method: 'POST',
      headers,
      body: JSON.stringify({ events }),
    })
    if (res.status === 401) return true // 静默丢弃
    return res.ok
  } catch {
    return false
  }
}

async function flush(): Promise<void> {
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  const ok = await postEvents(batch)
  if (!ok) {
    // 重试一次
    const retry = await postEvents(batch)
    if (!retry) {
      // 丢弃
    }
  }
}

function track(eventType: EventType, opts: TrackOpts = {}): void {
  if (!enabled) return
  try {
    queue.push({
      event_type: eventType,
      related_table: opts.related_table,
      related_id: opts.related_id,
      payload: opts.payload,
      session_id: sessionId,
      client: 'ios',
    })
    if (queue.length >= BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      void flush()
    } else {
      scheduleFlush()
    }
  } catch {
    /* never throw */
  }
}

function setEnabled(v: boolean): void {
  enabled = v
  if (!v) queue = []
}

async function refreshSettings(): Promise<void> {
  try {
    const token = await loadToken()
    if (!token) return
    const res = await fetch(API_BASE_URL + '/api/me/profile-settings', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    if (typeof data.signals_enabled === 'boolean') {
      enabled = data.signals_enabled
    }
  } catch {
    /* ignore */
  }
}

type SessionStartOpts = {
  platform: 'ios'
  version: string
  device_model?: string
}

function startSession(opts?: SessionStartOpts): void {
  sessionStartedAt = Date.now()
  track('session.start', {
    payload: opts || { platform: 'ios', version: APP_VERSION },
  })
}

function endSession(): void {
  if (sessionStartedAt == null) return
  const duration_secs = Math.max(
    0,
    Math.round((Date.now() - sessionStartedAt) / 1000)
  )
  sessionStartedAt = null
  track('session.end', { payload: { duration_secs } })
}

export const signals = {
  track,
  flush,
  setEnabled,
  refreshSettings,
  startSession,
  endSession,
}

export type { EventType, SessionStartOpts }
