/**
 * AuthContext — 管理登录态 + token 持久化.
 *
 * 启动时从 Keychain 拿 token, 调 /me 验证是否还有效.
 * 家长账号会拿到 bound_student (挂靠的孩子), 学生为 null.
 */
import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, loadToken, User, BoundStudent } from './api'

type AuthState = {
  user: User | null
  boundStudent: BoundStudent | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  register: (data: {
    role: 'student' | 'parent'
    username: string
    password: string
    display_name: string
    stage?: string
    join_code?: string
  }) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [boundStudent, setBoundStudent] = useState<BoundStudent | null>(null)
  const [loading, setLoading] = useState(true)

  async function bootstrap() {
    try {
      const token = await loadToken()
      if (!token) {
        setLoading(false)
        return
      }
      const r = await api.me()
      setUser(r.user)
      setBoundStudent(r.bound_student || null)
    } catch {
      /* token invalid */
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
  }, [])

  const refresh = async () => {
    try {
      const r = await api.me()
      setUser(r.user)
      setBoundStudent(r.bound_student || null)
    } catch {
      /* ignore */
    }
  }

  const login = async (username: string, password: string) => {
    const r = await api.tokenLogin(username, password)
    setUser(r.user)
    // me() 返回更丰富的数据 (bound_student)
    try {
      const m = await api.me()
      setBoundStudent(m.bound_student || null)
    } catch {}
  }

  const register = async (data: any) => {
    const r = await api.tokenRegister(data)
    setUser(r.user)
    try {
      const m = await api.me()
      setBoundStudent(m.bound_student || null)
    } catch {}
  }

  const logout = async () => {
    await api.logout()
    setUser(null)
    setBoundStudent(null)
  }

  return (
    <AuthCtx.Provider
      value={{ user, boundStudent, loading, login, register, logout, refresh }}
    >
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}
