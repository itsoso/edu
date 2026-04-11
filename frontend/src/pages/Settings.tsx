import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'

export default function Settings() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [usage, setUsage] = useState<any>(null)

  useEffect(() => {
    api.llmUsage().then(setUsage).catch(() => {})
  }, [])

  async function handleLogout() {
    await logout()
    nav('/login', { replace: true })
  }

  async function handleDelete() {
    if (!pw) {
      setErr('请输入密码二次确认')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await api.deleteMe(pw)
      // 成功后 session 已被清, 直接跳登录页
      nav('/login', { replace: true })
      // 强制 reload 让 AuthProvider 清空 user
      setTimeout(() => window.location.reload(), 100)
    } catch (e: any) {
      const msg = String(e.message || e)
      if (msg.includes('wrong_password')) setErr('密码不正确')
      else setErr(msg)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-bold">账号设置</h1>
        <p className="text-slate-500 mt-1 text-sm">管理你的账号与数据</p>
      </div>

      {/* 账号信息 */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-2">
        <div className="font-semibold">账号信息</div>
        <div className="text-sm space-y-1 text-slate-700">
          <div>用户名: <code className="bg-slate-100 px-1 rounded">{user?.username}</code></div>
          <div>昵称: {user?.display_name}</div>
          <div>角色: {user?.role === 'student' ? '🎓 学生' : '👨‍👩‍👧 家长'}</div>
          {user?.stage && <div>阶段: {user.stage}</div>}
          {user?.join_code && (
            <div>
              绑定码:{' '}
              <code className="bg-amber-50 border border-amber-200 px-2 py-0.5 rounded font-mono tracking-widest">
                {user.join_code}
              </code>{' '}
              <span className="text-xs text-slate-500">(家长注册时需要这个码)</span>
            </div>
          )}
        </div>
      </div>

      {/* AI 用量统计 */}
      {usage && usage.totals.calls > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="font-semibold">AI 用量</div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-2xl font-bold">{usage.totals.calls}</div>
              <div className="text-xs text-slate-500">总调用</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-green-600">{usage.totals.ok}</div>
              <div className="text-xs text-slate-500">成功</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-red-500">{usage.totals.errors}</div>
              <div className="text-xs text-slate-500">失败</div>
            </div>
          </div>
          {usage.by_endpoint.length > 0 && (
            <div className="text-xs text-slate-600 space-y-1 pt-2 border-t border-slate-100">
              <div className="font-medium mb-1">按端点</div>
              {usage.by_endpoint.slice(0, 5).map((e: any) => (
                <div key={e.endpoint} className="flex justify-between">
                  <span className="truncate mr-2">{e.endpoint}</span>
                  <span className="text-slate-500">
                    {e.calls} 次 · 平均 {Math.round(e.avg_latency_ms / 1000)}s
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="text-xs text-slate-400">
            累计字符数 (prompt + response): {(
              (usage.totals.total_prompt_chars + usage.totals.total_response_chars) / 1000
            ).toFixed(1)}K
          </div>
        </div>
      )}

      {/* 退出登录 */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex items-center justify-between">
        <div>
          <div className="font-semibold">退出登录</div>
          <div className="text-xs text-slate-500 mt-0.5">当前浏览器会话结束, 数据不会删除</div>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50"
        >
          退出
        </button>
      </div>

      {/* 危险区: 删除账号 */}
      <div className="bg-red-50 border border-red-200 rounded-lg p-5 space-y-3">
        <div>
          <div className="font-semibold text-red-700">⚠️ 删除账号</div>
          <div className="text-xs text-slate-600 mt-1">
            这将<b className="text-red-600">永久删除</b>你的全部数据: 考试成绩、任务打卡、错题本、
            上传的试卷、训练题、月度报告。
            {user?.role === 'student' && (
              <> 绑定你的家长账号将失去关联 (但家长账号本身保留)。</>
            )}
            <br />
            此操作<b>不可恢复</b>。
          </div>
        </div>

        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
          >
            我要删除账号
          </button>
        ) : (
          <div className="space-y-2">
            <label className="text-sm font-medium">请输入密码二次确认</label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="当前密码"
              autoFocus
            />
            {err && <div className="text-sm text-red-600">{err}</div>}
            <div className="flex gap-2">
              <button
                onClick={handleDelete}
                disabled={busy}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
              >
                {busy ? '删除中...' : '确认永久删除'}
              </button>
              <button
                onClick={() => {
                  setConfirming(false)
                  setPw('')
                  setErr('')
                }}
                disabled={busy}
                className="px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50"
              >
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
