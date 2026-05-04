/**
 * API 客户端 — Bearer token 认证 (bare React Native, 无 Expo).
 *
 * 一一对应 web 的 frontend/src/api.ts (credentials: include → Authorization: Bearer).
 */
import Keychain from 'react-native-keychain'
import { API_BASE_URL } from './config'

const TOKEN_SERVICE = 'life.executor.edu'

let memoryToken: string | null = null

export async function saveToken(token: string): Promise<void> {
  memoryToken = token
  try {
    await Keychain.setGenericPassword('edu', token, { service: TOKEN_SERVICE })
  } catch {
    /* fall back to memory */
  }
}

export async function loadToken(): Promise<string | null> {
  if (memoryToken) return memoryToken
  try {
    const creds = await Keychain.getGenericPassword({ service: TOKEN_SERVICE })
    if (creds) {
      memoryToken = creds.password
      return creds.password
    }
  } catch {
    /* ignore */
  }
  return null
}

export async function clearToken(): Promise<void> {
  memoryToken = null
  try {
    await Keychain.resetGenericPassword({ service: TOKEN_SERVICE })
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * 手写 query string — RN 的 URLSearchParams polyfill 没实现 .set(),
 * 用 native URL 会报 "URL.searchParams.set is not implemented".
 */
function toQs(
  obj: Record<string, string | number | boolean | undefined | null>
): string {
  const parts: string[] = []
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === '') continue
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)))
  }
  return parts.length ? '?' + parts.join('&') : ''
}

async function request<T>(
  path: string,
  opts: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((opts.headers as Record<string, string>) || {}),
  }
  if (!opts.skipAuth) {
    const token = await loadToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }
  const { skipAuth, ...rest } = opts
  const res = await fetch(API_BASE_URL + path, { ...rest, headers })
  if (!res.ok) {
    let msg = ''
    try {
      const j = await res.json()
      msg = j.error || j.message || JSON.stringify(j)
    } catch {
      msg = await res.text()
    }
    throw new ApiError(res.status, msg)
  }
  if (res.status === 204) return undefined as any
  const text = await res.text()
  if (!text) return undefined as any
  try {
    return JSON.parse(text)
  } catch {
    return text as any
  }
}

// --- multipart ---
async function requestForm<T>(path: string, form: FormData): Promise<T> {
  const headers: Record<string, string> = {}
  const token = await loadToken()
  if (token) headers['Authorization'] = `Bearer ${token}`
  // 不要手动设 Content-Type, fetch 会自动带 boundary
  const res = await fetch(API_BASE_URL + path, {
    method: 'POST',
    headers,
    body: form as any,
  })
  if (!res.ok) {
    let msg = ''
    try {
      const j = await res.json()
      msg = j.error || j.message || JSON.stringify(j)
    } catch {
      msg = await res.text()
    }
    throw new ApiError(res.status, msg)
  }
  return res.json()
}

// -------- Types (与 web frontend/src/api.ts 完全一致) --------
export type User = {
  id: number
  username: string
  display_name: string
  role: 'student' | 'parent'
  student_id: number | null
  join_code: string | null
  stage: string | null
}

export type BoundStudent = { id: number; display_name: string; stage: string | null }

export type Exam = {
  id: number
  exam_name: string
  exam_date: string | null
  stage: string | null
  total: number | null
  class_rank: number | null
  grade_rank: number | null
  notes: string | null
  sort_order: number
  scores: Record<string, number>
}

export type Task = {
  id: number
  week: number
  day_of_week: number
  subject: string | null
  title: string
  description: string | null
  minutes: number
  override_action?: 'skip' | 'replace' | null
  override_title?: string | null
  override_description?: string | null
  override_minutes?: number | null
  effective_title?: string
  effective_description?: string | null
  effective_minutes?: number
}

export type WeeklyGoal = {
  id: number
  owner_user_id: number
  week_start: string
  goal_text: string
  focus_type: 'redo_mistakes' | 'learn_new' | 'challenge' | 'custom' | null
  created_at: string
}

export type Checkin = {
  id: number
  task_id: number
  checkin_date: string
  completed: number
  duration_minutes: number | null
  note: string | null
}

export type ExtractedMistake = {
  question_number?: string
  question_text?: string
  wrong_answer?: string
  correct_answer?: string
  reason_guess?: string
  knowledge_point?: string
  confidence?: number
}

export type ExamAnalysis = {
  subject?: string
  exam_estimate?: string
  estimated_score?: string
  strengths?: string[]
  weaknesses?: string[]
  knowledge_gaps?: string[]
  advice?: string
  priority_focus?: string
}

export type ExamUpload = {
  id: number
  owner_user_id: number
  file_path: string
  file_name: string
  subject: string | null
  exam_name: string | null
  status: 'uploaded' | 'extracting' | 'extracted' | 'analyzing' | 'analyzed' | 'failed'
  image_url: string
  preview_url?: string
  created_at: string
  error_message: string | null
  extracted?: { subject?: string; mistakes?: ExtractedMistake[] } | null
  analysis?: ExamAnalysis | null
}

export type PracticeItem = {
  id: number
  set_id: number
  question_text: string
  expected_answer: string | null
  solution_steps: string | null
  difficulty: string | null
  student_answer: string | null
  is_correct: number | null
  score: number | null
  feedback: string | null
  graded_at: string | null
}

export type PracticeSet = {
  id: number
  source_mistake_id: number | null
  title: string
  subject: string | null
  knowledge_point: string | null
  item_count?: number
  graded_count?: number
  correct_count?: number
  status?: 'generating' | 'done' | 'failed'
  error_message?: string | null
  created_at: string
  items: PracticeItem[]
}

export type ReflectionKind =
  | 'mistake_note'
  | 'weekly_note'
  | 'free_write'
  | 'exam_feeling'

export type Reflection = {
  id: number
  owner_user_id: number
  kind: ReflectionKind
  related_id: number | null
  related_key: string | null
  content: string
  created_at: string
  updated_at: string
}

export type JournalMedia = {
  id: number
  owner_user_id: number
  reflection_id: number | null
  media_type: 'audio' | 'video'
  file_url: string
  file_name: string | null
  mime_type: string | null
  duration_secs: number | null
  file_size_bytes: number | null
  ai_opt_in: boolean
  analysis_status: 'none' | 'extracting_frames' | 'analyzing' | 'done' | 'failed'
  analysis: any | null
  analysis_prompt: string | null
  error_message: string | null
  created_at: string
}

export type EssayAnalysis = {
  score: number
  grade: string
  strengths: string[]
  weaknesses: string[]
  structure_analysis: string
  language_analysis: string
  content_analysis: string
  improvement_suggestions: string[]
  model_sentences: { original: string; improved: string; reason: string }[]
  overall_comment: string
}

export type Essay = {
  id: number
  owner_user_id: number
  title: string | null
  content: string
  source_type: 'photo' | 'document' | 'text'
  file_path: string | null
  file_name: string | null
  file_url: string | null
  essay_type: string | null
  topic: string | null
  word_count: number
  status:
    | 'uploaded'
    | 'ocr_processing'
    | 'ocr_done'
    | 'analyzing'
    | 'analyzed'
    | 'failed'
  ocr_result: any | null
  analysis: EssayAnalysis | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export type Mistake = {
  id: number
  subject: string
  exam_name: string | null
  question_text: string | null
  wrong_answer: string | null
  correct_answer: string | null
  solution_steps: string | null
  reason: string
  knowledge_point: string | null
  mastered: number
  created_at: string
  mastered_at: string | null
}

export type DashboardSummary = {
  streak_days: number
  month_checkins: number
  month_distinct_days: number
  practice: { total: number; graded: number; correct: number }
  mistakes: { total: number; mastered: number }
  calendar_14d: { date: string; done: number }[]
  today: string
}

export type Course = {
  id: number
  owner_user_id: number
  child_name: string
  course_name: string
  weekday: number
  start_time: string
  end_time: string
  location: string | null
  pickup_note: string | null
  notes: string | null
  sort_order: number
  specific_date: string | null
  created_at: string
  updated_at: string
}

export type CourseInput = {
  child_name: string
  course_name: string
  weekday: number
  start_time: string
  end_time: string
  location?: string | null
  pickup_note?: string | null
  notes?: string | null
  sort_order?: number
  specific_date?: string | null
}

export type DailyTip = {
  id?: number
  tip_date?: string
  content?: string
  status?: 'generating' | 'done' | 'failed'
  error_message?: string | null
  exists?: boolean
  skipped?: boolean
  reason?: string
}

// -------- API --------
export const api = {
  // Auth
  tokenLogin: async (username: string, password: string) => {
    const data = await request<{ user: User; token: string }>(
      '/api/auth/token-login',
      { method: 'POST', body: JSON.stringify({ username, password }), skipAuth: true }
    )
    await saveToken(data.token)
    return data
  },
  tokenRegister: async (payload: {
    role: 'student' | 'parent'
    username: string
    password: string
    display_name: string
    stage?: string
    join_code?: string
  }) => {
    const data = await request<{ user: User; token: string }>(
      '/api/auth/token-register',
      { method: 'POST', body: JSON.stringify(payload), skipAuth: true }
    )
    await saveToken(data.token)
    return data
  },
  me: () =>
    request<{ user: User | null; bound_student?: BoundStudent }>('/api/auth/me'),
  logout: async () => {
    await clearToken()
  },
  deleteMe: (password: string) =>
    request<{ ok: boolean }>('/api/auth/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),

  // Exams
  listExams: () => request<Exam[]>('/api/exams'),
  createExam: (data: any) =>
    request<{ id: number }>('/api/exams', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteExam: (id: number) =>
    request<{ ok: boolean }>(`/api/exams/${id}`, { method: 'DELETE' }),
  scoresTrend: () => request<any[]>('/api/scores/trend'),

  // Tasks + checkins
  listTasks: (week?: number, day?: number, weekStart?: string) =>
    request<Task[]>(
      `/api/tasks${toQs({ week, day, week_start: weekStart })}`
    ),
  overrideTask: (
    taskId: number,
    data: {
      week_start: string
      action: 'skip' | 'replace'
      custom_title?: string
      custom_description?: string
      custom_minutes?: number
    }
  ) =>
    request<{ ok: boolean }>(`/api/tasks/${taskId}/override`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  clearTaskOverride: (taskId: number, weekStart: string) =>
    request<{ ok: boolean }>(
      `/api/tasks/${taskId}/override?week_start=${encodeURIComponent(weekStart)}`,
      { method: 'DELETE' }
    ),

  // Weekly goals
  listWeeklyGoals: (limit?: number) =>
    request<WeeklyGoal[]>(`/api/goals/weekly${limit ? '?limit=' + limit : ''}`),
  getWeeklyGoal: (weekStart: string) =>
    request<{ exists: boolean; week_start: string } & Partial<WeeklyGoal>>(
      `/api/goals/weekly/${weekStart}`
    ),
  upsertWeeklyGoal: (data: {
    week_start: string
    goal_text: string
    focus_type?: 'redo_mistakes' | 'learn_new' | 'challenge' | 'custom'
  }) =>
    request<WeeklyGoal>('/api/goals/weekly', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteWeeklyGoal: (weekStart: string) =>
    request<{ ok: boolean }>(`/api/goals/weekly/${weekStart}`, { method: 'DELETE' }),

  listCheckins: (date?: string) =>
    request<Checkin[]>(`/api/checkins${date ? '?date=' + date : ''}`),
  upsertCheckin: (data: {
    task_id: number
    checkin_date: string
    completed: boolean
    duration_minutes?: number
    note?: string
  }) =>
    request<{ ok: boolean }>('/api/checkins', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  checkinStats: () =>
    request<{ date: string; done: number; minutes: number }[]>('/api/checkins/stats'),

  // Mistakes
  listMistakes: (subject?: string, mastered?: 0 | 1) =>
    request<Mistake[]>(
      `/api/mistakes${toQs({ subject, mastered })}`
    ),
  listMistakesPaged: async (params: {
    subject?: string
    mastered?: 0 | 1
    limit?: number
    offset?: number
  }) => {
    const qs = toQs({
      subject: params.subject,
      mastered: params.mastered,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    })
    const token = await loadToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE_URL}/api/mistakes${qs}`, { headers })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    const items: Mistake[] = await res.json()
    const total = parseInt(res.headers.get('X-Total-Count') || '0', 10)
    return { items, total }
  },
  createMistake: (data: any) =>
    request<{ id: number }>('/api/mistakes', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateMistake: (id: number, data: any) =>
    request<{ ok: boolean }>(`/api/mistakes/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteMistake: (id: number) =>
    request<{ ok: boolean }>(`/api/mistakes/${id}`, { method: 'DELETE' }),
  mistakeStats: () =>
    request<{ by_reason: any[]; by_subject: any[] }>('/api/mistakes/stats'),

  // Uploads (扫试卷)
  listUploads: () => request<ExamUpload[]>('/api/uploads'),
  getUpload: (id: number) => request<ExamUpload>(`/api/uploads/${id}`),
  uploadExamImage: async (
    uri: string,
    name: string,
    mime: string,
    examName?: string
  ) => {
    const fd = new FormData()
    fd.append('file', { uri, name, type: mime } as any)
    if (examName) fd.append('exam_name', examName)
    return requestForm<ExamUpload>('/api/uploads', fd)
  },
  deleteUpload: (id: number) =>
    request<{ ok: boolean }>(`/api/uploads/${id}`, { method: 'DELETE' }),
  extractMistakes: (uploadId: number) =>
    request<ExamUpload>(`/api/uploads/${uploadId}/extract`, { method: 'POST' }),
  analyzeUpload: (uploadId: number) =>
    request<ExamUpload>(`/api/uploads/${uploadId}/analyze`, { method: 'POST' }),
  saveExtractedMistakes: (uploadId: number, indices: number[]) =>
    request<{ saved: number; ids: number[] }>(
      `/api/uploads/${uploadId}/save-mistakes`,
      { method: 'POST', body: JSON.stringify({ indices }) }
    ),

  // Journal media
  uploadJournalMedia: async (
    uri: string,
    name: string,
    mime: string,
    mediaType: 'audio' | 'video',
    opts?: { durationSecs?: number; reflectionId?: number }
  ) => {
    const fd = new FormData()
    fd.append('file', { uri, name, type: mime } as any)
    fd.append('media_type', mediaType)
    if (opts?.durationSecs) fd.append('duration_secs', String(opts.durationSecs))
    if (opts?.reflectionId) fd.append('reflection_id', String(opts.reflectionId))
    return requestForm<JournalMedia>('/api/journal/media', fd)
  },
  listJournalMedia: (reflectionId?: number) =>
    request<JournalMedia[]>(
      `/api/journal/media${reflectionId ? '?reflection_id=' + reflectionId : ''}`
    ),
  getJournalMedia: (id: number) => request<JournalMedia>(`/api/journal/media/${id}`),
  deleteJournalMedia: (id: number) =>
    request<{ ok: boolean }>(`/api/journal/media/${id}`, { method: 'DELETE' }),
  analyzeJournalMedia: (id: number, prompt: string) =>
    request<JournalMedia>(`/api/journal/media/${id}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // Essays
  listEssays: async (
    params: { essay_type?: string; topic?: string; q?: string; limit?: number; offset?: number } = {}
  ) => {
    const qs = toQs({
      essay_type: params.essay_type,
      topic: params.topic,
      q: params.q,
      limit: params.limit ?? 50,
      offset: params.offset ?? 0,
    })
    const token = await loadToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${API_BASE_URL}/api/essays${qs}`, { headers })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    const items: Essay[] = await res.json()
    const total = parseInt(res.headers.get('X-Total-Count') || '0', 10)
    return { items, total }
  },
  getEssay: (id: number) => request<Essay>(`/api/essays/${id}`),
  createEssayFromText: (data: {
    content: string
    title?: string
    essay_type?: string
    topic?: string
  }) =>
    request<Essay>('/api/essays', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  uploadEssayFile: async (
    uri: string,
    name: string,
    mime: string,
    sourceType: 'photo' | 'document',
    opts?: { title?: string; essay_type?: string; topic?: string }
  ) => {
    const fd = new FormData()
    fd.append('file', { uri, name, type: mime } as any)
    fd.append('source_type', sourceType)
    if (opts?.title) fd.append('title', opts.title)
    if (opts?.essay_type) fd.append('essay_type', opts.essay_type)
    if (opts?.topic) fd.append('topic', opts.topic)
    return requestForm<Essay>('/api/essays', fd)
  },
  updateEssay: (
    id: number,
    data: Partial<Pick<Essay, 'title' | 'essay_type' | 'topic' | 'content'>>
  ) =>
    request<Essay>(`/api/essays/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  deleteEssay: (id: number) =>
    request<{ ok: boolean }>(`/api/essays/${id}`, { method: 'DELETE' }),
  triggerEssayOcr: (id: number) =>
    request<Essay>(`/api/essays/${id}/ocr`, { method: 'POST' }),
  triggerEssayAnalysis: (id: number) =>
    request<Essay>(`/api/essays/${id}/analyze`, { method: 'POST' }),
  listEssayTopics: () => request<string[]>('/api/essays/topics'),

  // Reflections
  listReflections: (
    params: {
      kind?: ReflectionKind
      related_id?: number
      related_key?: string
      limit?: number
      offset?: number
    } = {}
  ) =>
    request<Reflection[]>(
      `/api/reflections${toQs({
        kind: params.kind,
        related_id: params.related_id,
        related_key: params.related_key,
        limit: params.limit,
        offset: params.offset,
      })}`
    ),
  upsertReflection: (data: {
    kind: ReflectionKind
    related_id?: number | null
    related_key?: string | null
    content: string
  }) =>
    request<Reflection>('/api/reflections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteReflection: (id: number) =>
    request<{ ok: boolean }>(`/api/reflections/${id}`, { method: 'DELETE' }),
  reflectionsStats: () =>
    request<{ kind: ReflectionKind; count: number; total_chars: number }[]>(
      '/api/reflections/stats'
    ),

  // Content
  getContent: (name: string) =>
    request<{ name: string; content: string }>(`/api/content/${name}`),
  listContent: () =>
    request<{ name: string; title: string }[]>('/api/content'),

  // LLM + stats
  llmStatus: () =>
    request<{ configured: boolean; model: string }>('/api/llm/status'),
  llmUsage: () =>
    request<{
      recent_7d: {
        date: string
        calls: number
        prompt_chars: number
        response_chars: number
        avg_latency_ms: number
      }[]
      by_endpoint: {
        endpoint: string
        calls: number
        avg_latency_ms: number
        total_chars: number
      }[]
      totals: {
        calls: number
        ok: number
        errors: number
        total_prompt_chars: number
        total_response_chars: number
      }
    }>('/api/stats/llm/usage'),

  dailyTip: () => request<DailyTip>('/api/dashboard/daily-tip'),
  dashboardSummary: () => request<DashboardSummary>('/api/dashboard/summary'),

  // Monthly reports
  listMonthlyReports: () =>
    request<{ id: number; month: string; created_at: string }[]>(
      '/api/reports/monthly'
    ),
  getMonthlyReport: (month: string) =>
    request<{
      exists: boolean
      month: string
      id?: number
      content_md?: string
      metrics?: any
      status?: 'generating' | 'done' | 'failed'
      error_message?: string | null
      created_at?: string
    }>(`/api/reports/monthly/${month}`),
  generateMonthlyReport: (month: string, force = false) =>
    request<{
      id: number
      month: string
      content_md: string
      metrics: any
      status?: 'generating' | 'done' | 'failed'
      error_message?: string | null
    }>(`/api/reports/monthly/${month}/generate`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  deleteMonthlyReport: (month: string) =>
    request<{ ok: boolean }>(`/api/reports/monthly/${month}`, { method: 'DELETE' }),

  // Practice
  listPracticeSets: () => request<PracticeSet[]>('/api/practice'),
  getPracticeSet: (id: number) => request<PracticeSet>(`/api/practice/${id}`),
  generatePractice: (mistakeId: number, count = 3) =>
    request<PracticeSet>(`/api/mistakes/${mistakeId}/generate-practice`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),
  gradePracticeItem: (itemId: number, studentAnswer: string) =>
    request<PracticeItem>(`/api/practice/items/${itemId}/grade`, {
      method: 'POST',
      body: JSON.stringify({ student_answer: studentAnswer }),
    }),
  deletePracticeSet: (id: number) =>
    request<{ ok: boolean }>(`/api/practice/${id}`, { method: 'DELETE' }),

  // Profile settings (signals / 画像 opt-out)
  getProfileSettings: () =>
    request<ProfileSettings>('/api/me/profile-settings'),
  updateProfileSettings: (data: Partial<ProfileSettings>) =>
    request<ProfileSettings>('/api/me/profile-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  wipeMySignals: () =>
    request<{ ok: boolean }>('/api/me/signals', { method: 'DELETE' }),

  // Me / Profile (元认知镜子 — "看见自己")
  getMyProfile: () => request<MyProfileResponse>('/api/me/profile'),
  getMyProfileHistory: () =>
    request<MyProfileHistoryEntry[]>('/api/me/profile/history'),
  getMyProfileVersion: (v: number) =>
    request<{ version: number; profile: MyProfile }>(
      `/api/me/profile/version/${v}`
    ),
  correctMyProfile: (body: {
    field_path: string
    action: 'dismiss' | 'lock_value' | 'reset'
    reason?: string
    value?: any
  }) =>
    request<{ ok: boolean }>('/api/me/profile/correct', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMyCorrections: () =>
    request<MyProfileCorrection[]>('/api/me/profile/corrections'),
  deleteMyCorrection: (id: number) =>
    request<{ ok: boolean }>(`/api/me/profile/corrections/${id}`, {
      method: 'DELETE',
    }),
  rebuildMyProfile: () =>
    request<{ ok: boolean } & Partial<MyProfileResponse>>(
      '/api/me/profile/rebuild',
      { method: 'POST' }
    ),
  wipeMyProfile: () =>
    request<{ ok: boolean }>('/api/me/profile', { method: 'DELETE' }),

  // Tutor Agent
  getTodaySuggestion: () =>
    request<{ exists: boolean; suggestion?: AgentSuggestion }>(
      '/api/agent/suggestion/today'
    ),
  refreshSuggestion: () =>
    request<{
      generated: boolean
      reason?: string
      suggestion?: AgentSuggestion
    }>('/api/agent/suggestion/refresh', { method: 'POST' }),
  acceptSuggestion: (id: number) =>
    request<{ ok: boolean; action: any; result: any }>(
      `/api/agent/suggestion/${id}/accept`,
      { method: 'POST' }
    ),
  dismissSuggestion: (id: number, reason?: string) =>
    request<{ ok: boolean }>(`/api/agent/suggestion/${id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || '' }),
    }),
  snoozeAgent: (days: number) =>
    request<{ ok: boolean; snoozed_until: string | null }>(
      '/api/agent/snooze',
      { method: 'POST', body: JSON.stringify({ days }) }
    ),
  listAgentActions: () => request<AgentAction[]>('/api/agent/actions'),

  // Reflector (元认知伙伴 — "想想看")
  reflectorQuestion: (data: {
    source_table: 'mistakes' | 'practice_items'
    source_id: number
  }) =>
    request<ReflectorQuestion>('/api/reflector/question', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Feynman (反向教学 — 学生教 AI)
  startFeynman: (data: {
    source_table?: string
    source_id?: number
    subject?: string
    knowledge_point?: string
    learned_from?: string
  }) =>
    request<{
      session_id: number
      opening_question: string
      topic_seed: string
      max_turns: number
    }>('/api/feynman/start', { method: 'POST', body: JSON.stringify(data) }),
  feynmanTurn: (id: number, student_answer: string) =>
    request<{
      session_id: number
      next_question?: string
      finished: boolean
      turn_count: number
      assessment?: FeynmanAssessment
    }>(`/api/feynman/${id}/turn`, {
      method: 'POST',
      body: JSON.stringify({ student_answer }),
    }),
  feynmanFinish: (id: number) =>
    request<{
      finished: boolean
      assessment?: FeynmanAssessment
      abandoned?: boolean
    }>(`/api/feynman/${id}/finish`, { method: 'POST' }),
  listFeynmanSessions: (limit?: number) =>
    request<FeynmanSessionSummary[]>(
      `/api/feynman/sessions${limit ? `?limit=${limit}` : ''}`
    ),
  listRecentFeynmanKps: (limit = 12) =>
    request<RecentFeynmanKp[]>(`/api/feynman/recent-kps?limit=${limit}`),

  // Curator (今天值得做的)
  getCuratedToday: () =>
    request<{ date: string; items: CuratedItem[] }>('/api/curator/today'),
  refreshCuratedToday: () =>
    request<{ generated: number; date: string; ids: number[] }>(
      '/api/curator/today/refresh',
      { method: 'POST' }
    ),
  completeCuratedItem: (id: number) =>
    request<{ ok: boolean }>(`/api/curator/items/${id}/complete`, {
      method: 'POST',
    }),
  dismissCuratedItem: (id: number) =>
    request<{ ok: boolean }>(`/api/curator/items/${id}/dismiss`, {
      method: 'POST',
    }),
  getCuratorHistory: () => request<any[]>('/api/curator/history'),
  getFeynmanSession: (id: number) =>
    request<FeynmanSessionFull>(`/api/feynman/${id}`),
  deleteFeynmanSession: (id: number) =>
    request<{ ok: boolean }>(`/api/feynman/${id}`, { method: 'DELETE' }),

  // Coach (P6 周日复盘)
  getCoachThisWeek: () => request<CoachReview>('/api/coach/this-week'),
  getCoachWeek: (week_start: string) =>
    request<CoachReview>(`/api/coach/week/${week_start}`),
  listCoachHistory: () => request<CoachHistoryEntry[]>('/api/coach/history'),
  regenerateCoachThisWeek: () =>
    request<{ ok: boolean }>('/api/coach/this-week/regenerate', {
      method: 'POST',
    }),
  deleteCoachWeek: (week_start: string) =>
    request<{ ok: boolean }>(`/api/coach/week/${week_start}`, {
      method: 'DELETE',
    }),

  // Guardian (P7 异常监控)
  getGuardianAlerts: () => request<GuardianAlert[]>('/api/guardian/alerts'),
  acknowledgeGuardianAlert: (id: number) =>
    request<{ ok: boolean }>(`/api/guardian/alerts/${id}/acknowledge`, {
      method: 'POST',
    }),
  scanGuardian: () =>
    request<{ written: any[]; count: number }>('/api/guardian/scan', {
      method: 'POST',
    }),

  // 课程日历 (家长接送)
  listCourses: (opts?: { child?: string; weekend?: boolean }) => {
    const q = new URLSearchParams()
    if (opts?.child) q.set('child', opts.child)
    if (opts?.weekend) q.set('weekend', '1')
    const qs = q.toString()
    return request<Course[]>(`/api/schedule/courses${qs ? `?${qs}` : ''}`)
  },
  listCourseChildren: () =>
    request<{ name: string; count: number }[]>('/api/schedule/children'),
  createCourse: (payload: CourseInput) =>
    request<Course>('/api/schedule/courses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCourse: (id: number, payload: CourseInput) =>
    request<Course>(`/api/schedule/courses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCourse: (id: number) =>
    request<{ ok: boolean }>(`/api/schedule/courses/${id}`, { method: 'DELETE' }),
  seedFamilyCourses: () =>
    request<{ inserted: number; skipped: number }>('/api/schedule/seed-family', {
      method: 'POST',
    }),
}

// -------- Coach (P6) types --------
export type CoachHighlights = {
  strengths: string[]
  watchouts: string[]
  focus_for_next_week: string
}

export type CoachReview = {
  exists: boolean
  week_start: string
  status?: 'generating' | 'done' | 'failed'
  content_md?: string
  highlights?: CoachHighlights
  metrics?: any
  error_message?: string | null
  build_method?: string
  build_cost_usd?: number
  created_at?: string
}

export type CoachHistoryEntry = {
  week_start: string
  status: 'generating' | 'done' | 'failed'
  build_method?: string
  build_cost_usd?: number
  created_at: string
}

// -------- Guardian (P7) types --------
export type GuardianSeverity = 'low' | 'medium' | 'high'
export type GuardianCategory =
  | 'engagement_drop'
  | 'give_up_pattern'
  | 'pace_too_high'
  | 'reflection_drop'
  | 'goal_drift'

export type GuardianAlert = {
  id: number
  severity: GuardianSeverity
  category: GuardianCategory
  title: string
  message: string | null
  evidence: any
  audience: 'student' | 'parent'
  expires_at: string | null
  created_at: string
}

// -------- Reflector types --------
export type ReflectorQuestion = {
  question: string
  trigger: string
  source_table: string
  source_id: number
  llm: 'llm' | 'fallback'
}

// -------- Feynman types --------
export type FeynmanAssessment = {
  understood: 'understood' | 'mechanical' | 'confused'
  weak_points: string[]
  confidence: number
  topic: string
}

export type FeynmanSessionSummary = {
  id: number
  source_table: string | null
  source_id: number | null
  topic_seed: string | null
  status: 'in_progress' | 'finished' | 'abandoned'
  turn_count: number
  assessment: FeynmanAssessment | null
  created_at: string
  finished_at: string | null
  manual_subject?: string | null
  manual_knowledge_point?: string | null
}

export type FeynmanTurn = { role: 'ai' | 'student'; content: string; ts: string }

export type FeynmanSessionFull = FeynmanSessionSummary & {
  conversation: FeynmanTurn[]
}

export type RecentFeynmanKp = {
  subject: string
  knowledge_point: string
  session_count: number
  last_spoken_at: string
  last_understood: boolean
}

// -------- Me Profile types --------
export type KnowledgePoint = {
  mastery: number
  confidence?: number
  last_practiced_at?: string | null
  practice_count?: number
  correct_count?: number
  wrong_count?: number
}

export type ErrorPattern = {
  id: string | number
  subject: string
  description: string
  evidence_mistake_ids?: number[]
  occurrences?: number
  confidence?: number
  trend?: 'new' | 'rising' | 'weakening' | 'stable' | string
}

export type CognitiveStyle = {
  best_time_window?: string
  hint_usage_pattern?: 'tries_first' | 'looks_first' | 'rarely_used' | string
  ideal_session_length_min?: number
}

export type Engagement = {
  score_7d?: number
  checkin_rate_7d?: number
  avg_session_minutes_7d?: number
  active_days_7d?: number
  trend?: 'rising' | 'falling' | 'stable' | string
}

export type AgentStrategies = {
  tutor: Record<
    string,
    { accept_rate: number; dismiss_rate: number; sample_size: number }
  >
  curator: Record<
    string,
    { completion_rate: number; dismiss_rate: number; sample_size: number }
  >
  feynman: { completion_rate?: number; sample_size?: number }
  guardian: { ack_rate?: number; sample_size?: number }
  preferred_action_hours: number[]
  learned_at: string
}

export type MyProfile = {
  schema_version?: number
  knowledge?: Record<string, Record<string, KnowledgePoint>>
  error_patterns?: ErrorPattern[]
  cognitive_style?: CognitiveStyle
  engagement?: Engagement
  self_narrative?: string
  computed_at?: string
  agent_strategies?: AgentStrategies
  [k: string]: any
}

export type MyProfileResponse = {
  exists: boolean
  version?: number
  source_summary?: string
  profile?: MyProfile
  computed_at?: string
}

export type MyProfileHistoryEntry = {
  version: number
  source_summary?: string
  build_method?: string
  is_monthly_snapshot?: boolean
  created_at: string
}

export type MyProfileCorrection = {
  id: number
  field_path: string
  action: 'dismiss' | 'lock_value' | 'reset' | string
  reason?: string | null
  value?: any
  created_at: string
}

export type ProfileSettings = {
  signals_enabled: boolean
  profile_enabled: boolean
  journal_volume_in_profile: boolean
  agent_enabled?: boolean
  snoozed_until?: string | null
}

export type AgentSuggestion = {
  id: number
  suggestion_id: string
  kind:
    | 'pattern_drill'
    | 'knowledge_refresh'
    | 'goal_followup'
    | 'subject_review'
    | string
  wording: string
  rationale: string
  evidence_refs: any
  accept_action: any
  profile_version: number
  created_at: string
}

export type CuratedItem = {
  id: number
  kind:
    | 'review_mistake'
    | 'pattern_drill'
    | 'goal_aligned'
    | 'challenge'
    | 'rest_recommended'
  source_table: string | null
  source_id: number | null
  title: string
  description: string | null
  rationale: string | null
  estimated_minutes: number | null
  priority: number
  status: 'pending' | 'completed' | 'dismissed' | 'expired'
  completed_at: string | null
  created_at: string
}

export type AgentAction = {
  id: number
  suggestion_id?: number | string
  kind?: string
  wording?: string
  response?: string
  created_at: string
  [k: string]: any
}
