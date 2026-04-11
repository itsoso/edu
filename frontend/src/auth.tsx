import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { api, User } from './api'

type BoundStudent = { id: number; display_name: string; stage: string | null } | null

type AuthState = {
  user: User | null
  boundStudent: BoundStudent
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [boundStudent, setBoundStudent] = useState<BoundStudent>(null)
  const [loading, setLoading] = useState(true)

  async function refresh() {
    try {
      const res = await api.me()
      setUser(res.user)
      setBoundStudent(res.bound_student || null)
    } catch {
      setUser(null)
      setBoundStudent(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const login = async (username: string, password: string) => {
    await api.login(username, password)
    await refresh()
  }

  const register = async (data: any) => {
    await api.register(data)
    await refresh()
  }

  const logout = async () => {
    await api.logout()
    setUser(null)
    setBoundStudent(null)
  }

  return (
    <AuthCtx.Provider value={{ user, boundStudent, loading, login, register, logout }}>
      {children}
    </AuthCtx.Provider>
  )
}

export function useAuth() {
  const v = useContext(AuthCtx)
  if (!v) throw new Error('useAuth must be used within AuthProvider')
  return v
}
