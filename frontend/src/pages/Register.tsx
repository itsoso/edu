import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth'

const STAGES = ['初一上', '初一下', '初二上', '初二下', '初三上', '初三下', '高一上', '高一下', '高二上', '高二下', '高三上', '高三下']

export default function Register() {
  const { register } = useAuth()
  const nav = useNavigate()
  const [role, setRole] = useState<'student' | 'parent'>('student')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [stage, setStage] = useState('初二下')
  const [joinCode, setJoinCode] = useState('')
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    if (password.length < 6) {
      setErr('密码至少 6 位')
      return
    }
    setLoading(true)
    try {
      await register({
        role,
        username: username.trim().toLowerCase(),
        password,
        display_name: displayName.trim(),
        stage: role === 'student' ? stage : undefined,
        join_code: role === 'parent' ? joinCode.trim().toUpperCase() : undefined,
      })
      nav('/', { replace: true })
    } catch (e: any) {
      const msg = String(e.message || e)
      if (msg.includes('username_taken')) setErr('用户名已被占用')
      else if (msg.includes('invalid_join_code')) setErr('绑定码无效或不存在')
      else if (msg.includes('password_too_short')) setErr('密码至少 6 位')
      else setErr(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-brand-50 to-slate-100">
      <form
        onSubmit={submit}
        className="bg-white rounded-lg shadow-lg border border-slate-200 w-full max-w-md p-8 space-y-4"
      >
        <div className="text-center">
          <div className="text-2xl font-bold text-brand-700">注册账号</div>
        </div>

        {/* 角色选择 */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setRole('student')}
            className={`py-3 rounded border text-sm font-medium ${
              role === 'student'
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            🎓 我是学生
          </button>
          <button
            type="button"
            onClick={() => setRole('parent')}
            className={`py-3 rounded border text-sm font-medium ${
              role === 'parent'
                ? 'bg-brand-600 text-white border-brand-600'
                : 'bg-white text-slate-600 border-slate-300'
            }`}
          >
            👨‍👩‍👧 我是家长
          </button>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">用户名</label>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={role === 'student' ? '如: zhangsan' : '如: zhangsan_mom'}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">昵称 (显示名)</label>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={role === 'student' ? '张三' : '张三妈妈'}
          />
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium text-slate-700">密码 (至少 6 位)</label>
          <input
            type="password"
            className="w-full border border-slate-300 rounded px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {role === 'student' ? (
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">当前阶段</label>
            <select
              className="w-full border border-slate-300 rounded px-3 py-2"
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {STAGES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <p className="text-xs text-slate-500">注册后会自动获得 4 周计划模板</p>
          </div>
        ) : (
          <div className="space-y-1">
            <label className="text-sm font-medium text-slate-700">绑定码 (学生的 Join Code)</label>
            <input
              className="w-full border border-slate-300 rounded px-3 py-2 font-mono uppercase tracking-widest"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="6 位码"
              maxLength={6}
            />
            <p className="text-xs text-slate-500">向孩子索取 6 位绑定码，她在自己的"今日"页面可以看到</p>
          </div>
        )}

        {err && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded">{err}</div>}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 bg-brand-600 text-white rounded font-medium hover:bg-brand-700 disabled:opacity-50"
        >
          {loading ? '注册中...' : '注册并登录'}
        </button>

        <div className="text-center text-sm text-slate-500">
          已有账号？
          <Link to="/login" className="text-brand-600 hover:underline ml-1">
            登录
          </Link>
        </div>
      </form>
    </div>
  )
}
