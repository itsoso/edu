/**
 * AuthContext — 管理登录态 + token 持久化.
 *
 * 启动时从 Keychain 拿 token, 调 /me 验证是否还有效.
 * 家长账号会拿到 bound_student (挂靠的孩子), 学生为 null.
 */
import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, clearToken, loadToken, User, BoundStudent } from './api'
import { clearCache, setCacheOwner } from './offlineCache'

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
        setCacheOwner(null)
        return
      }
      const r = await api.me()
      setUser(r.user)
      setBoundStudent(r.bound_student || null)
      setCacheOwner(r.user?.id ?? null)
    } catch (error) {
      await clearToken()
      setUser(null)
      setBoundStudent(null)
      setCacheOwner(null)
      console.warn('Stored login is no longer valid', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
  }, [])

  const refresh = async () => {
    const r = await api.me()
    setUser(r.user)
    setBoundStudent(r.bound_student || null)
    setCacheOwner(r.user?.id ?? null)
  }

  const login = async (username: string, password: string) => {
    await clearCache()
    setCacheOwner(null)
    const r = await api.tokenLogin(username, password)
    const m = await api.me()
    setUser(r.user)
    setBoundStudent(m.bound_student || null)
    setCacheOwner(r.user.id)
  }

  const register = async (data: any) => {
    await clearCache()
    setCacheOwner(null)
    const r = await api.tokenRegister(data)
    const m = await api.me()
    setUser(r.user)
    setBoundStudent(m.bound_student || null)
    setCacheOwner(r.user.id)
  }

  const logout = async () => {
    await clearCache()
    setCacheOwner(null)
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
