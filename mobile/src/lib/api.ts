/**
 * API 客户端 — Bearer token 认证 (bare React Native, 无 Expo).
 *
 * Token 存储:
 * - 生产: react-native-keychain (iOS Keychain / Android Keystore)
 * - 降级: 内存变量 (防止 keychain 权限问题 crash)
 */
import Keychain from 'react-native-keychain'
import { API_BASE_URL } from './config'

const TOKEN_KEY = 'edu_auth_token'
const TOKEN_SERVICE = 'life.executor.edu'

let memoryToken: string | null = null

export async function saveToken(token: string): Promise<void> {
  memoryToken = token
  try {
    await Keychain.setGenericPassword('edu', token, {
      service: TOKEN_SERVICE,
    })
  } catch {
    // Keychain 权限问题时降级到内存 (重启失效)
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
    // ignore
  }
  return null
}

export async function clearToken(): Promise<void> {
  memoryToken = null
  try {
    await Keychain.resetGenericPassword({ service: TOKEN_SERVICE })
  } catch {
    // ignore
  }
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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

  const { skipAuth, ...fetchOpts } = opts
  const res = await fetch(API_BASE_URL + path, { ...fetchOpts, headers })
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
  return res.json()
}

// -------- Types --------
export type User = {
  id: number
  username: string
  display_name: string
  role: 'student' | 'parent'
  student_id: number | null
  join_code: string | null
  stage: string | null
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
}

// -------- API methods --------
export const api = {
  tokenLogin: async (username: string, password: string) => {
    const data = await request<{ user: User; token: string }>('/api/auth/token-login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      skipAuth: true,
    })
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
    const data = await request<{ user: User; token: string }>('/api/auth/token-register', {
      method: 'POST',
      body: JSON.stringify(payload),
      skipAuth: true,
    })
    await saveToken(data.token)
    return data
  },
  me: () => request<{ user: User | null }>('/api/auth/me'),
  logout: async () => {
    await clearToken()
  },
  listTasks: (week?: number, day?: number) => {
    const qs = new URLSearchParams()
    if (week) qs.set('week', String(week))
    if (day) qs.set('day', String(day))
    return request<Task[]>(`/api/tasks${qs.toString() ? '?' + qs : ''}`)
  },
  listCheckins: (date: string) => request<Checkin[]>(`/api/checkins?date=${date}`),
  upsertCheckin: (data: { task_id: number; checkin_date: string; completed: boolean }) =>
    request<{ ok: boolean }>('/api/checkins', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
}
