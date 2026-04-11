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
}
