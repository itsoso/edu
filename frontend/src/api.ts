// Fetch wrapper for edu backend - multi-tenant session auth

const BASE = '/api'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    credentials: 'include',
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    // 一些 fetch 实现不允许 body 被读两次, 先 text() 再尝试解析 JSON.
    let text = ''
    try {
      text = await res.text()
    } catch {
      /* ignore */
    }
    let msg = text
    if (text) {
      try {
        const j = JSON.parse(text)
        msg = j.error || j.message || text
      } catch {
        /* not JSON */
      }
    }
    throw new ApiError(res.status, msg || `HTTP ${res.status}`)
  }
  // 204 no-content
  if (res.status === 204) return undefined as any
  return res.json()
}

// ---------- Types ----------
export type User = {
  id: number
  username: string
  display_name: string
  role: 'student' | 'parent'
  student_id: number | null
  join_code: string | null
  stage: string | null
}

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
  // 阶段 3: 如果请求带了 week_start, 这些字段会填充
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
  status:
    | 'uploaded'
    | 'extracting'
    | 'extracted'
    | 'analyzing'
    | 'analyzed'
    | 'failed'
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
  tags: string[]
  created_at: string
  items: PracticeItem[]
}

export type ReflectionKind = 'mistake_note' | 'weekly_note' | 'free_write' | 'exam_feeling'

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
  file_urls?: string[]
  essay_type: string | null
  topic: string | null
  word_count: number
  status: 'uploaded' | 'ocr_processing' | 'ocr_done' | 'analyzing' | 'analyzed' | 'failed'
  ocr_result: any | null
  analysis: EssayAnalysis | null
  error_message: string | null
  created_at: string
  updated_at: string
}

export type Assignment = {
  id: number
  student_id: number
  assigner_user_id: number
  assigner_name?: string | null
  kind: 'practice' | 'essay' | 'reading' | 'custom'
  title: string
  description: string | null
  due_date: string | null
  status: 'pending' | 'completed' | 'cancelled'
  completed_at: string | null
  created_at: string
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

// ---------- API ----------
export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  register: (data: {
    role: 'student' | 'parent'
    username: string
    password: string
    display_name: string
    stage?: string
    join_code?: string
  }) =>
    request<{ user: User }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  logout: () => request<{ ok: boolean }>('/auth/logout', { method: 'POST' }),
  me: () =>
    request<{ user: User | null; bound_student?: { id: number; display_name: string; stage: string | null } }>(
      '/auth/me'
    ),
  deleteMe: (password: string) =>
    request<{ ok: boolean }>('/auth/me', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    }),

  // Exams
  listExams: () => request<Exam[]>('/exams'),
  createExam: (data: any) =>
    request<{ id: number }>('/exams', { method: 'POST', body: JSON.stringify(data) }),
  deleteExam: (id: number) =>
    request<{ ok: boolean }>(`/exams/${id}`, { method: 'DELETE' }),
  scoresTrend: () => request<any[]>('/scores/trend'),

  // Tasks + checkins
  listTasks: (week?: number, day?: number, weekStart?: string) => {
    const qs = new URLSearchParams()
    if (week) qs.set('week', String(week))
    if (day) qs.set('day', String(day))
    if (weekStart) qs.set('week_start', weekStart)
    return request<Task[]>(`/tasks${qs.toString() ? '?' + qs : ''}`)
  },

  // 阶段 3: task overrides
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
    request<{ ok: boolean }>(`/tasks/${taskId}/override`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  clearTaskOverride: (taskId: number, weekStart: string) =>
    request<{ ok: boolean }>(
      `/tasks/${taskId}/override?week_start=${encodeURIComponent(weekStart)}`,
      { method: 'DELETE' }
    ),

  // 阶段 3: weekly goals
  listWeeklyGoals: (limit?: number) =>
    request<WeeklyGoal[]>(`/goals/weekly${limit ? '?limit=' + limit : ''}`),
  getWeeklyGoal: (weekStart: string) =>
    request<{ exists: boolean; week_start: string } & Partial<WeeklyGoal>>(
      `/goals/weekly/${weekStart}`
    ),
  upsertWeeklyGoal: (data: {
    week_start: string
    goal_text: string
    focus_type?: 'redo_mistakes' | 'learn_new' | 'challenge' | 'custom'
  }) =>
    request<WeeklyGoal>('/goals/weekly', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteWeeklyGoal: (weekStart: string) =>
    request<{ ok: boolean }>(`/goals/weekly/${weekStart}`, { method: 'DELETE' }),
  listCheckins: (date?: string) =>
    request<Checkin[]>(`/checkins${date ? '?date=' + date : ''}`),
  upsertCheckin: (data: any) =>
    request<{ ok: boolean }>('/checkins', { method: 'POST', body: JSON.stringify(data) }),
  checkinStats: () => request<{ date: string; done: number; minutes: number }[]>('/checkins/stats'),

  // Mistakes
  listMistakes: (subject?: string, mastered?: 0 | 1) => {
    const qs = new URLSearchParams()
    if (subject) qs.set('subject', subject)
    if (mastered !== undefined) qs.set('mastered', String(mastered))
    return request<Mistake[]>(`/mistakes${qs.toString() ? '?' + qs : ''}`)
  },
  /** 分页版. 返回 { items, total }. */
  listMistakesPaged: async (params: {
    subject?: string
    mastered?: 0 | 1
    limit?: number
    offset?: number
  }) => {
    const qs = new URLSearchParams()
    if (params.subject) qs.set('subject', params.subject)
    if (params.mastered !== undefined) qs.set('mastered', String(params.mastered))
    qs.set('limit', String(params.limit ?? 50))
    qs.set('offset', String(params.offset ?? 0))
    const res = await fetch(`/api/mistakes?${qs}`, { credentials: 'include' })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    const items: Mistake[] = await res.json()
    const total = parseInt(res.headers.get('X-Total-Count') || '0', 10)
    return { items, total }
  },
  createMistake: (data: any) =>
    request<{ id: number }>('/mistakes', { method: 'POST', body: JSON.stringify(data) }),
  scanSolveMistake: async (file: File, saveAsMistake: boolean) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('save_as_mistake', saveAsMistake ? '1' : '0')
    const res = await fetch('/api/mistakes/scan-solve', {
      method: 'POST', credentials: 'include', body: fd,
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json() as Promise<{
      question_text: string
      subject: string
      knowledge_point: string | null
      difficulty: string
      answer: string
      solution_steps: string
      common_mistakes: string
      mistake_id?: number
    }>
  },
  updateMistake: (id: number, data: any) =>
    request<{ ok: boolean }>(`/mistakes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMistake: (id: number) =>
    request<{ ok: boolean }>(`/mistakes/${id}`, { method: 'DELETE' }),
  mistakeStats: () =>
    request<{ by_reason: any[]; by_subject: any[] }>('/mistakes/stats'),
  knowledgeGraph: () =>
    request<{ nodes: Array<{
      subject: string
      knowledge_point: string
      total: number
      mastered: number
      mastery: number
      weakness_score: number
      last_seen: string | null
    }> }>('/mistakes/knowledge-graph'),

  // Journal Media (音频/视频)
  uploadJournalMedia: async (
    file: File,
    mediaType: 'audio' | 'video',
    opts?: { durationSecs?: number; reflectionId?: number }
  ) => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('media_type', mediaType)
    if (opts?.durationSecs) fd.append('duration_secs', String(opts.durationSecs))
    if (opts?.reflectionId) fd.append('reflection_id', String(opts.reflectionId))
    const res = await fetch('/api/journal/media', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json() as Promise<JournalMedia>
  },
  listJournalMedia: (reflectionId?: number) =>
    request<JournalMedia[]>(
      `/journal/media${reflectionId ? '?reflection_id=' + reflectionId : ''}`
    ),
  getJournalMedia: (id: number) =>
    request<JournalMedia>(`/journal/media/${id}`),
  deleteJournalMedia: (id: number) =>
    request<{ ok: boolean }>(`/journal/media/${id}`, { method: 'DELETE' }),
  analyzeJournalMedia: (id: number, prompt: string) =>
    request<JournalMedia>(`/journal/media/${id}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    }),

  // 作文管理
  listEssays: async (params: {
    essay_type?: string; topic?: string; q?: string
    limit?: number; offset?: number
  } = {}) => {
    const qs = new URLSearchParams()
    if (params.essay_type) qs.set('essay_type', params.essay_type)
    if (params.topic) qs.set('topic', params.topic)
    if (params.q) qs.set('q', params.q)
    qs.set('limit', String(params.limit ?? 50))
    qs.set('offset', String(params.offset ?? 0))
    const res = await fetch(`/api/essays?${qs}`, { credentials: 'include' })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    const items: Essay[] = await res.json()
    const total = parseInt(res.headers.get('X-Total-Count') || '0', 10)
    return { items, total }
  },
  getEssay: (id: number) => request<Essay>(`/essays/${id}`),
  createEssayFromText: (data: {
    content: string; title?: string; essay_type?: string; topic?: string
  }) =>
    request<Essay>('/essays', { method: 'POST', body: JSON.stringify(data) }),
  uploadEssayFile: async (
    file: File | File[],
    sourceType: 'photo' | 'document',
    opts?: { title?: string; essay_type?: string; topic?: string }
  ) => {
    const fd = new FormData()
    const files = Array.isArray(file) ? file : [file]
    if (files.length === 1) {
      fd.append('file', files[0])
    } else {
      for (const f of files) fd.append('files', f)
    }
    fd.append('source_type', sourceType)
    if (opts?.title) fd.append('title', opts.title)
    if (opts?.essay_type) fd.append('essay_type', opts.essay_type)
    if (opts?.topic) fd.append('topic', opts.topic)
    const res = await fetch('/api/essays', {
      method: 'POST', credentials: 'include', body: fd,
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json() as Promise<Essay>
  },
  updateEssay: (id: number, data: Partial<Pick<Essay, 'title' | 'essay_type' | 'topic' | 'content'>>) =>
    request<Essay>(`/essays/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEssay: (id: number) =>
    request<{ ok: boolean }>(`/essays/${id}`, { method: 'DELETE' }),
  triggerEssayOcr: (id: number) =>
    request<Essay>(`/essays/${id}/ocr`, { method: 'POST' }),
  triggerEssayAnalysis: (id: number) =>
    request<Essay>(`/essays/${id}/analyze`, { method: 'POST' }),
  generateEssayModel: (id: number) =>
    request<{
      title: string
      content: string
      highlights: string[]
      structure_note: string
    }>(`/essays/${id}/model-essay`, { method: 'POST' }),
  listEssayTopics: () => request<string[]>('/essays/topics'),

  // Assignments (家长布置任务)
  listAssignments: (params: { status?: string; mine_assigned?: boolean } = {}) => {
    const qs = new URLSearchParams()
    if (params.status) qs.set('status', params.status)
    if (params.mine_assigned) qs.set('mine_assigned', '1')
    const q = qs.toString()
    return request<Assignment[]>(`/assignments${q ? `?${q}` : ''}`)
  },
  createAssignment: (data: {
    title: string
    description?: string
    kind?: string
    due_date?: string
  }) =>
    request<Assignment>('/assignments', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateAssignment: (
    id: number,
    data: Partial<{
      status: 'pending' | 'completed' | 'cancelled'
      title: string
      description: string | null
      due_date: string | null
    }>
  ) =>
    request<Assignment>(`/assignments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  deleteAssignment: (id: number) =>
    request<{ ok: boolean }>(`/assignments/${id}`, { method: 'DELETE' }),

  // Reflections (她的声音 — 永远不喂给 AI)
  listReflections: (params: {
    kind?: ReflectionKind
    related_id?: number
    related_key?: string
    limit?: number
    offset?: number
  } = {}) => {
    const qs = new URLSearchParams()
    if (params.kind) qs.set('kind', params.kind)
    if (params.related_id !== undefined) qs.set('related_id', String(params.related_id))
    if (params.related_key) qs.set('related_key', params.related_key)
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    if (params.offset !== undefined) qs.set('offset', String(params.offset))
    return request<Reflection[]>(`/reflections${qs.toString() ? '?' + qs : ''}`)
  },
  upsertReflection: (data: {
    kind: ReflectionKind
    related_id?: number | null
    related_key?: string | null
    content: string
  }) =>
    request<Reflection>('/reflections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  deleteReflection: (id: number) =>
    request<{ ok: boolean }>(`/reflections/${id}`, { method: 'DELETE' }),
  reflectionsStats: () =>
    request<{ kind: ReflectionKind; count: number; total_chars: number }[]>(
      '/reflections/stats'
    ),

  // Content
  getContent: (name: string) =>
    request<{ name: string; content: string }>(`/content/${name}`),
  listContent: () => request<{ name: string; title: string }[]>('/content'),

  // LLM
  llmStatus: () => request<{ configured: boolean; model: string }>('/llm/status'),

  // LLM 用量统计
  llmUsage: () =>
    request<{
      recent_7d: { date: string; calls: number; prompt_chars: number; response_chars: number; avg_latency_ms: number }[]
      by_endpoint: { endpoint: string; calls: number; avg_latency_ms: number; total_chars: number }[]
      totals: {
        calls: number
        ok: number
        errors: number
        total_prompt_chars: number
        total_response_chars: number
      }
    }>('/stats/llm/usage'),

  // 每日一句话建议
  dailyTip: () =>
    request<{
      id?: number
      tip_date?: string
      content?: string
      status?: 'generating' | 'done' | 'failed'
      error_message?: string | null
      exists?: boolean
      skipped?: boolean
      reason?: string
    }>('/dashboard/daily-tip'),

  // Dashboard summary (streak/训练/错题 等)
  dashboardSummary: () =>
    request<{
      streak_days: number
      month_checkins: number
      month_distinct_days: number
      practice: { total: number; graded: number; correct: number }
      mistakes: { total: number; mastered: number }
      calendar_14d: { date: string; done: number }[]
      today: string
    }>('/dashboard/summary'),

  // Uploads (试卷照片)
  listUploads: () => request<ExamUpload[]>('/uploads'),
  getUpload: (id: number) => request<ExamUpload>(`/uploads/${id}`),
  uploadExamImage: async (file: File, examName?: string) => {
    const fd = new FormData()
    fd.append('file', file)
    if (examName) fd.append('exam_name', examName)
    const res = await fetch('/api/uploads', {
      method: 'POST',
      credentials: 'include',
      body: fd,
    })
    if (!res.ok) throw new ApiError(res.status, await res.text())
    return res.json() as Promise<ExamUpload>
  },
  deleteUpload: (id: number) =>
    request<{ ok: boolean }>(`/uploads/${id}`, { method: 'DELETE' }),
  extractMistakes: (uploadId: number) =>
    request<ExamUpload>(`/uploads/${uploadId}/extract`, { method: 'POST' }),
  analyzeUpload: (uploadId: number) =>
    request<ExamUpload>(`/uploads/${uploadId}/analyze`, { method: 'POST' }),
  saveExtractedMistakes: (uploadId: number, indices: number[]) =>
    request<{ saved: number; ids: number[] }>(`/uploads/${uploadId}/save-mistakes`, {
      method: 'POST',
      body: JSON.stringify({ indices }),
    }),

  // Monthly reports (月度复盘)
  listMonthlyReports: () =>
    request<{ id: number; month: string; created_at: string }[]>('/reports/monthly'),
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
    }>(`/reports/monthly/${month}`),
  generateMonthlyReport: (month: string, force: boolean = false) =>
    request<{
      id: number
      month: string
      content_md: string
      metrics: any
      status?: 'generating' | 'done' | 'failed'
      error_message?: string | null
    }>(`/reports/monthly/${month}/generate`, {
      method: 'POST',
      body: JSON.stringify({ force }),
    }),
  deleteMonthlyReport: (month: string) =>
    request<{ ok: boolean }>(`/reports/monthly/${month}`, { method: 'DELETE' }),

  // Practice (二次训练)
  listPracticeSets: (tag?: string) => {
    const qs = tag ? `?tag=${encodeURIComponent(tag)}` : ''
    return request<PracticeSet[]>(`/practice${qs}`)
  },
  listPracticeTags: () =>
    request<Array<{ tag: string; count: number }>>('/practice/tags'),
  updatePracticeSetTags: (id: number, tags: string[]) =>
    request<PracticeSet>(`/practice/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ tags }),
    }),
  getPracticeSet: (id: number) => request<PracticeSet>(`/practice/${id}`),
  generatePractice: (mistakeId: number, count: number = 3) =>
    request<PracticeSet>(`/mistakes/${mistakeId}/generate-practice`, {
      method: 'POST',
      body: JSON.stringify({ count }),
    }),
  gradePracticeItem: (itemId: number, studentAnswer: string) =>
    request<PracticeItem>(`/practice/items/${itemId}/grade`, {
      method: 'POST',
      body: JSON.stringify({ student_answer: studentAnswer }),
    }),
  deletePracticeSet: (id: number) =>
    request<{ ok: boolean }>(`/practice/${id}`, { method: 'DELETE' }),

  // 用户行为信号 / 画像 设置 (P0)
  getProfileSettings: () =>
    request<{
      signals_enabled: boolean
      profile_enabled: boolean
      journal_volume_in_profile: boolean
      agent_enabled?: boolean
      snoozed_until?: string | null
    }>('/me/profile-settings'),
  updateProfileSettings: (data: Partial<{
    signals_enabled: boolean
    profile_enabled: boolean
    journal_volume_in_profile: boolean
    agent_enabled: boolean
  }>) =>
    request<{ ok: boolean }>('/me/profile-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  // Tutor Agent (P2 主动建议)
  getNextAction: () =>
    request<{ exists: boolean; action?: NextAction }>('/agent/next-action'),
  getTodaySuggestion: () =>
    request<{ exists: boolean; suggestion?: AgentSuggestion }>(
      '/agent/suggestion/today'
    ),
  refreshSuggestion: () =>
    request<{
      generated: boolean
      reason?: string
      suggestion?: AgentSuggestion
    }>('/agent/suggestion/refresh', { method: 'POST' }),
  acceptSuggestion: (id: number) =>
    request<{ ok: boolean; action: any; result: any }>(
      `/agent/suggestion/${id}/accept`,
      { method: 'POST' }
    ),
  dismissSuggestion: (id: number, reason?: string) =>
    request<{ ok: boolean }>(`/agent/suggestion/${id}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || '' }),
    }),
  snoozeAgent: (days: number) =>
    request<{ ok: boolean; snoozed_until: string | null }>('/agent/snooze', {
      method: 'POST',
      body: JSON.stringify({ days }),
    }),
  listAgentActions: () => request<AgentAction[]>('/agent/actions'),
  wipeMySignals: () =>
    request<{ ok: boolean; deleted: number }>('/me/signals', { method: 'DELETE' }),

  // 学生画像 (P1 元认知镜子)
  getMyProfile: () => request<MyProfileResponse>('/me/profile'),
  getMyProfileHistory: () => request<ProfileHistoryItem[]>('/me/profile/history'),
  getMyProfileVersion: (v: number) => request<ProfileVersionResponse>(`/me/profile/version/${v}`),
  correctMyProfile: (body: ProfileCorrectionInput) =>
    request<{ ok: boolean; rebuild?: any }>('/me/profile/correct', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  listMyCorrections: () => request<ProfileCorrection[]>('/me/profile/corrections'),
  deleteMyCorrection: (id: number) =>
    request<{ ok: boolean }>(`/me/profile/corrections/${id}`, { method: 'DELETE' }),
  rebuildMyProfile: () =>
    request<{ ok: boolean; result?: any }>('/me/profile/rebuild', { method: 'POST' }),
  wipeMyProfile: () =>
    request<{ ok: boolean; deleted_profiles: number; deleted_corrections: number }>(
      '/me/profile',
      { method: 'DELETE' }
    ),

  // Feynman (P3 反向教学 — 学生教 AI)
  startFeynman: (
    data: {
      source_table?: FeynmanSourceTable
      source_id?: number
      subject?: string
      knowledge_point?: string
      learned_from?: string
    } = {},
  ) =>
    request<FeynmanStartResponse>('/feynman/start', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  feynmanTurn: (sessionId: number, studentAnswer: string) =>
    request<FeynmanTurnResponse>(`/feynman/${sessionId}/turn`, {
      method: 'POST',
      body: JSON.stringify({ student_answer: studentAnswer }),
    }),
  feynmanFinish: (sessionId: number) =>
    request<FeynmanFinishResponse>(`/feynman/${sessionId}/finish`, {
      method: 'POST',
    }),
  // Reflector (P4 元认知伙伴 — "想想看")
  reflectorQuestion: (data: { source_table: 'mistakes' | 'practice_items'; source_id: number }) =>
    request<ReflectorQuestion>('/reflector/question', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  listFeynmanSessions: (limit?: number) =>
    request<FeynmanSessionSummary[]>(
      `/feynman/sessions${limit ? '?limit=' + limit : ''}`
    ),

  listRecentFeynmanKps: (limit = 12) =>
    request<RecentFeynmanKp[]>(`/feynman/recent-kps?limit=${limit}`),

  // Curator (今天值得做的)
  getCuratedToday: () =>
    request<{ date: string; items: CuratedItem[] }>('/curator/today'),
  refreshCuratedToday: () =>
    request<{ generated: number; date: string; ids: number[] }>(
      '/curator/today/refresh',
      { method: 'POST' }
    ),
  completeCuratedItem: (id: number) =>
    request<{ ok: boolean }>(`/curator/items/${id}/complete`, {
      method: 'POST',
    }),
  dismissCuratedItem: (id: number) =>
    request<{ ok: boolean }>(`/curator/items/${id}/dismiss`, {
      method: 'POST',
    }),
  getCuratorHistory: () => request<any[]>('/curator/history'),
  getFeynmanSession: (id: number) =>
    request<FeynmanSessionDetail>(`/feynman/${id}`),
  deleteFeynmanSession: (id: number) =>
    request<{ ok: boolean }>(`/feynman/${id}`, { method: 'DELETE' }),

  // Coach (P6 周日复盘)
  getCoachThisWeek: () => request<CoachReview>('/coach/this-week'),
  getCoachWeek: (week_start: string) =>
    request<CoachReview>(`/coach/week/${week_start}`),
  listCoachHistory: () => request<CoachHistoryEntry[]>('/coach/history'),
  regenerateCoachThisWeek: () =>
    request<{ ok: boolean }>('/coach/this-week/regenerate', {
      method: 'POST',
    }),
  deleteCoachWeek: (week_start: string) =>
    request<{ ok: boolean }>(`/coach/week/${week_start}`, {
      method: 'DELETE',
    }),

  // Guardian (P7 异常监控)
  getGuardianAlerts: () => request<GuardianAlert[]>('/guardian/alerts'),
  acknowledgeGuardianAlert: (id: number) =>
    request<{ ok: boolean }>(`/guardian/alerts/${id}/acknowledge`, {
      method: 'POST',
    }),
  scanGuardian: () =>
    request<{ written: any[]; count: number }>('/guardian/scan', {
      method: 'POST',
    }),

  // 课程日历 (家长接送)
  listCourses: (opts?: { child?: string; weekend?: boolean }) => {
    const q = new URLSearchParams()
    if (opts?.child) q.set('child', opts.child)
    if (opts?.weekend) q.set('weekend', '1')
    const qs = q.toString()
    return request<Course[]>(`/schedule/courses${qs ? `?${qs}` : ''}`)
  },
  listCourseChildren: () =>
    request<{ name: string; count: number }[]>('/schedule/children'),
  createCourse: (payload: CourseInput) =>
    request<Course>('/schedule/courses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCourse: (id: number, payload: CourseInput) =>
    request<Course>(`/schedule/courses/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
  deleteCourse: (id: number) =>
    request<{ ok: boolean }>(`/schedule/courses/${id}`, { method: 'DELETE' }),
  seedFamilyCourses: () =>
    request<{ inserted: number; skipped: number }>('/schedule/seed-family', {
      method: 'POST',
    }),
}

// ---------- Coach (P6) types ----------
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

// ---------- Guardian (P7) types ----------
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

// ---------- Reflector types ----------
export type ReflectorQuestion = {
  question: string
  trigger: string
  source_table: string
  source_id: number
  llm: 'llm' | 'fallback'
}

// ---------- Feynman types ----------
export type FeynmanSourceTable = 'mistakes' | 'practice_items' | 'manual'

export type FeynmanUnderstood = 'understood' | 'mechanical' | 'confused'

export type FeynmanAssessment = {
  understood: FeynmanUnderstood
  weak_points: string[]
  confidence: number
  topic: string
}

export type FeynmanMessage = {
  role: 'ai' | 'student'
  content: string
  ts?: string
}

export type FeynmanStartResponse = {
  session_id: number
  opening_question: string
  topic_seed: string
  max_turns: number
}

export type FeynmanTurnResponse = {
  session_id: number
  next_question: string | null
  finished: boolean
  turn_count: number
  assessment: FeynmanAssessment | null
}

export type FeynmanFinishResponse = {
  finished: true
  abandoned?: boolean
  assessment?: FeynmanAssessment
}

export type FeynmanSessionSummary = {
  id: number
  source_table: FeynmanSourceTable | null
  source_id: number | null
  topic_seed: string | null
  status: 'in_progress' | 'finished' | 'abandoned' | string
  turn_count: number
  assessment: FeynmanAssessment | null
  created_at: string
  finished_at: string | null
  manual_subject: string | null
  manual_knowledge_point: string | null
}

export type FeynmanSessionDetail = FeynmanSessionSummary & {
  conversation: FeynmanMessage[]
}

export type RecentFeynmanKp = {
  subject: string
  knowledge_point: string
  session_count: number
  last_spoken_at: string
  last_understood: boolean
}

// ---------- Profile types ----------
export type KnowledgePoint = {
  mastery: number
  confidence: number
  last_practiced_at: string | null
  practice_count: number
  locked_by_user?: boolean
}

export type ErrorPattern = {
  id?: string
  subject?: string | null
  description?: string
  occurrences?: number
  confidence?: number
  trend?: 'new' | 'rising' | 'stable' | 'weakening' | string
  first_seen?: string | null
  last_seen?: string | null
}

export type CognitiveStyle = {
  best_time_window?: string | null
  hint_usage_pattern?: string | null
  ideal_session_length?: string | null
  [k: string]: any
}

export type Engagement = {
  score_7d?: number
  checkin_rate_7d?: number
  avg_session_minutes_7d?: number
  active_days_7d?: number
  trend?: string
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

export type StudentProfile = {
  schema_version?: number | string
  computed_at?: string
  data_window_days?: number
  knowledge?: Record<string, Record<string, KnowledgePoint>>
  error_patterns?: ErrorPattern[]
  cognitive_style?: CognitiveStyle
  engagement?: Engagement
  self_narrative?: string
  user_corrections_count?: number
  agent_strategies?: AgentStrategies
}

export type MyProfileResponse =
  | {
      exists: false
      message?: string
    }
  | {
      exists: true
      version: number
      computed_at: string | null
      source_summary: string | null
      build_method: string | null
      build_cost_usd: number | null
      is_monthly_snapshot: boolean
      profile: StudentProfile
      viewer_role: 'self' | 'parent'
      can_edit: boolean
    }

export type ProfileHistoryItem = {
  version: number
  source_summary: string | null
  build_method: string | null
  is_monthly_snapshot: boolean
  created_at: string
}

export type ProfileVersionResponse = {
  version: number
  source_summary: string | null
  is_monthly_snapshot: boolean
  created_at: string
  profile: StudentProfile
}

export type ProfileCorrection = {
  id: number
  field_path: string
  action: 'dismiss' | 'lock_value' | 'reset'
  value_json: string | null
  reason: string | null
  created_at: string
}

export type ProfileCorrectionInput =
  | { field_path: string; action: 'dismiss'; reason?: string }
  | { field_path: string; action: 'lock_value'; value: number; reason?: string }
  | { field_path: string; action: 'reset' }

// ---------- Curator types ----------
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

// ---------- Tutor Agent types ----------
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

export type AgentAction = {
  id: number
  suggestion_id?: number | string
  kind?: string
  wording?: string
  response?: string
  created_at: string
  [k: string]: any
}

export type NextAction = {
  kind: 'mistake' | 'practice' | 'task' | string
  title: string
  description: string
  cta_label: string
  cta_path: string
  subject?: string | null
  knowledge_point?: string | null
  source_mistake_id?: number | null
  practice_set_id?: number | null
  task_id?: number | null
}
