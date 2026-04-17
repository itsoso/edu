/**
 * AuthContext — 管理登录态 + token 持久化.
 *
 * 启动时从 SecureStore 拿 token, 调 /me 验证是否还有效.
 * Login/Register 后刷新 user 状态.
 */
import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, loadToken, User } from './api'

type AuthState = {
  user: User | null
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
}

const AuthCtx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
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
    } catch {
      // Token 无效 / 过期, 保持 user=null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    bootstrap()
  }, [])

  const login = async (username: string, password: string) => {
    const r = await api.tokenLogin(username, password)
    setUser(r.user)
  }

  const register = async (data: any) => {
    const r = await api.tokenRegister(data)
    setUser(r.user)
  }

  const logout = async () => {
    await api.logout()
    setUser(null)
  }

  return (
    <AuthCtx.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx)
  if (!ctx) throw new Error('useAuth must be inside <AuthProvider>')
  return ctx
}
