import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

export default function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    setLoading(true)
    try {
      await login(username.trim().toLowerCase(), password)
      nav('/', { replace: true })
    } catch (e: any) {
      const msg = String(e.message || e)
      if (msg.includes('invalid_credentials')) setErr('用户名或密码错误')
      else setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 to-slate-100">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg shadow-lg border border-slate-200 w-full max-w-sm p-8 space-y-5"
      >
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-700">学习系统登录</div>
          <div className="text-sm text-slate-500 mt-1">学生 / 家长 登录</div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">用户名</label>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="demo"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">密码</label>
          <input
            type="password"
            className="w-full border border-slate-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">{err}</div>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-brand-600 text-white rounded font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? '登录中...' : '登录'}
        </button>

        <div className="text-center text-sm text-slate-500">
          没有账号？
          <Link to="/register" className="text-brand-600 hover:underline ml-1">
            注册
          </Link>
        </div>
      </form>
    </div>
  )
}
