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
    let msg = ''
    try {
      const j = await res.json()
      msg = j.error || j.message || JSON.stringify(j)
    } catch {
      msg = await res.text()
    }
    throw new ApiError(res.status, msg)
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
  status: 'uploaded' | 'extracted' | 'analyzed' | 'failed'
  image_url: string
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
  created_at: string
  items: PracticeItem[]
}

export type Mistake = {
  id: number
  subject: string
  exam_name: string | null
  question_text: string | null
  wrong_answer: string | null
  correct_answer: string | null
  reason: string
  knowledge_point: string | null
  mastered: number
  created_at: string
  mastered_at: string | null
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

  // Exams
  listExams: () => request<Exam[]>('/exams'),
  createExam: (data: any) =>
    request<{ id: number }>('/exams', { method: 'POST', body: JSON.stringify(data) }),
  deleteExam: (id: number) =>
    request<{ ok: boolean }>(`/exams/${id}`, { method: 'DELETE' }),
  scoresTrend: () => request<any[]>('/scores/trend'),

  // Tasks + checkins
  listTasks: (week?: number, day?: number) => {
    const qs = new URLSearchParams()
    if (week) qs.set('week', String(week))
    if (day) qs.set('day', String(day))
    return request<Task[]>(`/tasks${qs.toString() ? '?' + qs : ''}`)
  },
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
  createMistake: (data: any) =>
    request<{ id: number }>('/mistakes', { method: 'POST', body: JSON.stringify(data) }),
  updateMistake: (id: number, data: any) =>
    request<{ ok: boolean }>(`/mistakes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMistake: (id: number) =>
    request<{ ok: boolean }>(`/mistakes/${id}`, { method: 'DELETE' }),
  mistakeStats: () =>
    request<{ by_reason: any[]; by_subject: any[] }>('/mistakes/stats'),

  // Content
  getContent: (name: string) =>
    request<{ name: string; content: string }>(`/content/${name}`),
  listContent: () => request<{ name: string; title: string }[]>('/content'),

  // LLM
  llmStatus: () => request<{ configured: boolean; model: string }>('/llm/status'),

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

  // Practice (二次训练)
  listPracticeSets: () => request<PracticeSet[]>('/practice'),
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
}
