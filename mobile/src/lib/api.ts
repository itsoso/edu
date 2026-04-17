/**
 * API 客户端 — Bearer token 认证 (Mobile).
 *
 * Token 存储:
 * - 真机: expo-secure-store (Keychain on iOS, EncryptedSharedPreferences on Android)
 * - Expo Go 环境 fallback 到内存变量 (开发时每次启动要重登)
 */
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

const TOKEN_KEY = 'edu_auth_token'
const BASE_URL: string =
  (Constants.expoConfig?.extra as any)?.apiBaseUrl || 'https://YOUR_DOMAIN'

let memoryToken: string | null = null

export async function saveToken(token: string): Promise<void> {
  memoryToken = token
  try {
    await SecureStore.setItemAsync(TOKEN_KEY, token)
  } catch {
    // Expo Go on iOS/Android simulator sometimes can't use SecureStore.
    // Memory fallback is fine for dev.
  }
}

export async function loadToken(): Promise<string | null> {
  if (memoryToken) return memoryToken
  try {
    const t = await SecureStore.getItemAsync(TOKEN_KEY)
    memoryToken = t
    return t
  } catch {
    return null
  }
}

export async function clearToken(): Promise<void> {
  memoryToken = null
  try {
    await SecureStore.deleteItemAsync(TOKEN_KEY)
  } catch {}
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
  const res = await fetch(BASE_URL + path, { ...fetchOpts, headers })
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
  // Auth
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

  // Tasks / Checkins
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
