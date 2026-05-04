import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../auth'
import signals from '../lib/signals'

type ProfileSettings = {
  signals_enabled: boolean
  profile_enabled: boolean
  journal_volume_in_profile: boolean
  agent_enabled?: boolean
  snoozed_until?: string | null
}

type AgentAction = {
  id: number
  suggestion_id?: number | string
  kind?: string
  wording?: string
  response?: string
  created_at: string
}

const COLLECTED_ITEMS: { code: string; desc: string }[] = [
  { code: 'session.start / session.end', desc: '会话开始/结束 (平台 + 时长)' },
  { code: 'task.checkin.toggle', desc: '今日任务打卡 (是否完成 + 时段)' },
  { code: 'task.override.skip', desc: '跳过本周任务 (周序号)' },
  { code: 'task.override.replace', desc: '把任务换成你自己的版本 (仅事件)' },
  { code: 'weekly_goal.set', desc: '设定周目标 (focus 类型 + 周起始日)' },
  { code: 'mistake.create', desc: '新增错题 (科目 + 失分原因 + 来源)' },
  { code: 'mistake.view_detail', desc: '展开错题参考思路 (科目)' },
  { code: 'mistake.mark_mastered', desc: '标记错题已掌握 (距创建天数)' },
  { code: 'practice.item.start', desc: '进入一道训练题 (科目 + 难度)' },
  { code: 'practice.item.input_pause', desc: '答题时停顿 (停顿次数 + 秒数)' },
  { code: 'practice.item.hint_used', desc: '看了思路提示 (用时秒)' },
  { code: 'practice.item.submit', desc: '提交作答 (用时 + 答案长度 + 是否看过提示)' },
  { code: 'practice.item.skip', desc: '没提交就离开 (用时秒)' },
  { code: 'essay.create', desc: '新建作文 (来源 + 字数)' },
  { code: 'journal.write', desc: '写日记 (字数, 永远不传内容)' },
  { code: 'agent.suggestion.shown / accepted / dismissed', desc: 'AI 建议被展示/采纳/忽略 (建议 ID)' },
]

export default function Settings() {
  const { user, logout } = useAuth()
  const nav = useNavigate()
  const [pw, setPw] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [usage, setUsage] = useState<any>(null)

  // 数据收集设置
  const [profileSettings, setProfileSettings] = useState<ProfileSettings | null>(null)
  const [savingPref, setSavingPref] = useState<string | null>(null)
  const [wipeBusy, setWipeBusy] = useState(false)
  const [wipeMsg, setWipeMsg] = useState('')

  // AI 建议
  const [snoozeBusy, setSnoozeBusy] = useState(false)
  const [agentActions, setAgentActions] = useState<AgentAction[] | null>(null)
  const [actionsLoaded, setActionsLoaded] = useState(false)

  useEffect(() => {
    api.llmUsage().then(setUsage).catch(() => {})
    api.getProfileSettings().then(setProfileSettings).catch(() => {})
  }, [])

  async function togglePref(key: keyof ProfileSettings) {
    if (!profileSettings) return
    const cur = profileSettings[key] as boolean | undefined
    const next = { ...profileSettings, [key]: !cur } as ProfileSettings
    setProfileSettings(next)
    setSavingPref(key)
    try {
      await api.updateProfileSettings({ [key]: !cur } as any)
      if (key === 'signals_enabled') {
        signals.setEnabled(next.signals_enabled)
      }
    } catch (e: any) {
      setProfileSettings(profileSettings)
      alert('保存失败: ' + (e.message || e))
    } finally {
      setSavingPref(null)
    }
  }

  async function setSnooze(days: number) {
    if (!profileSettings) return
    setSnoozeBusy(true)
    try {
      const r = await api.snoozeAgent(days)
      setProfileSettings({ ...profileSettings, snoozed_until: r.snoozed_until })
    } catch (e: any) {
      alert('操作失败: ' + (e.message || e))
    } finally {
      setSnoozeBusy(false)
    }
  }

  async function loadAgentActions() {
    if (actionsLoaded) return
    try {
      const items = await api.listAgentActions()
      setAgentActions(items)
    } catch {
      setAgentActions([])
    } finally {
      setActionsLoaded(true)
    }
  }

  async function handleWipeSignals() {
    if (!confirm('确认清除你的全部行为数据? 此操作不可恢复.')) return
    setWipeBusy(true)
    setWipeMsg('')
    try {
      const r = await api.wipeMySignals()
      setWipeMsg(`已清除 ${r.deleted} 条行为记录`)
    } catch (e: any) {
      setWipeMsg('失败: ' + (e.message || e))
    } finally {
      setWipeBusy(false)
    }
  }

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

      {/* 看见自己 入口 */}
      <Link
        to="/insights"
        className="block bg-white border border-slate-200 rounded-lg p-5 hover:border-brand-300 hover:bg-brand-50/30 transition"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-800">🪞 看见自己</div>
            <div className="text-xs text-slate-500 mt-1">
              AI 对你最近学习的观察. 你可以看, 可以改, 可以删.
            </div>
          </div>
          <span className="text-slate-400 text-sm">›</span>
        </div>
      </Link>

      {/* 你讲过的 入口 (费曼模式) */}
      <Link
        to="/feynman-history"
        className="block bg-white border border-slate-200 rounded-lg p-5 hover:border-brand-300 hover:bg-brand-50/30 transition"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-800">🎓 你讲过的</div>
            <div className="text-xs text-slate-500 mt-1">
              反向教学的历史: 你讲给 AI 同学听的题, 都在这里.
            </div>
          </div>
          <span className="text-slate-400 text-sm">›</span>
        </div>
      </Link>

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

      {/* 数据收集与画像 */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div>
          <div className="font-semibold">数据收集与画像</div>
          <div className="text-xs text-slate-500 mt-0.5">
            只收集元数据 (科目/字数/用时/时段), 永远不收集你写的内容. 关掉后立刻生效.
          </div>
        </div>

        {profileSettings ? (
          <div className="space-y-3">
            <PrefRow
              label="收集行为信号"
              hint="支撑'看见自己'与 AI 建议. 关掉后端会全部丢弃, 不保存."
              checked={profileSettings.signals_enabled}
              busy={savingPref === 'signals_enabled'}
              onToggle={() => togglePref('signals_enabled')}
            />
            <PrefRow
              label="生成学生画像"
              hint="基于行为信号汇总成可读的画像 (科目偏好/打卡习惯). 关掉则只存原始事件, 不汇总."
              checked={profileSettings.profile_enabled}
              busy={savingPref === 'profile_enabled'}
              onToggle={() => togglePref('profile_enabled')}
            />
            <PrefRow
              label="把日记字数纳入画像"
              hint="只统计字数, 不读内容. 关掉后画像里完全不出现日记相关字段."
              checked={profileSettings.journal_volume_in_profile}
              busy={savingPref === 'journal_volume_in_profile'}
              onToggle={() => togglePref('journal_volume_in_profile')}
            />
          </div>
        ) : (
          <div className="text-xs text-slate-400">加载偏好...</div>
        )}

        <details className="text-sm">
          <summary className="cursor-pointer text-brand-700 font-medium select-none">
            看看具体收集了什么 (共 {COLLECTED_ITEMS.length} 条)
          </summary>
          <ul className="mt-3 space-y-2 text-xs text-slate-600">
            {COLLECTED_ITEMS.map((it) => (
              <li key={it.code} className="flex flex-col gap-0.5 border-l-2 border-slate-200 pl-3">
                <code className="font-mono text-[11px] text-slate-500">{it.code}</code>
                <span>{it.desc}</span>
              </li>
            ))}
          </ul>
        </details>

        <div className="border-t border-slate-100 pt-3 space-y-2">
          <button
            onClick={handleWipeSignals}
            disabled={wipeBusy}
            className="px-4 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {wipeBusy ? '清除中...' : '清除我所有的行为数据'}
          </button>
          {wipeMsg && <div className="text-xs text-slate-500">{wipeMsg}</div>}
          <div className="text-xs text-slate-400">
            只删除行为信号 (interaction_signals). 错题/作文/日记等内容数据不受影响.
          </div>
        </div>
      </div>

      {/* AI 建议 (Tutor Agent) */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
        <div>
          <div className="font-semibold">AI 建议</div>
          <div className="text-xs text-slate-500 mt-0.5">
            每天最多一条主动建议, 基于你的画像生成. 你随时可以暂停或关闭.
          </div>
        </div>

        {profileSettings ? (
          <>
            <PrefRow
              label="接收 AI 主动建议"
              hint="关掉后首页不再显示建议卡片, 也不再生成."
              checked={profileSettings.agent_enabled !== false}
              busy={savingPref === 'agent_enabled'}
              onToggle={() => togglePref('agent_enabled')}
            />

            <div className="border-t border-slate-100 pt-3">
              <div className="text-sm font-medium mb-1">暂停一段时间</div>
              <div className="text-xs text-slate-500 mb-2">
                {profileSettings.snoozed_until
                  ? `已暂停至 ${profileSettings.snoozed_until}`
                  : '当前未暂停'}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setSnooze(7)}
                  disabled={snoozeBusy}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  暂停 7 天
                </button>
                <button
                  onClick={() => setSnooze(14)}
                  disabled={snoozeBusy}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  暂停 14 天
                </button>
                <button
                  onClick={() => setSnooze(0)}
                  disabled={snoozeBusy || !profileSettings.snoozed_until}
                  className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
                >
                  取消暂停
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-400">加载偏好...</div>
        )}

        <details
          className="text-sm border-t border-slate-100 pt-3"
          onToggle={(e) => {
            if ((e.target as HTMLDetailsElement).open) loadAgentActions()
          }}
        >
          <summary className="cursor-pointer text-brand-700 font-medium select-none">
            查看建议历史
          </summary>
          <div className="mt-3">
            {!actionsLoaded ? (
              <div className="text-xs text-slate-400">加载中...</div>
            ) : agentActions && agentActions.length > 0 ? (
              <ul className="space-y-2 text-xs">
                {agentActions.map((a) => (
                  <li
                    key={a.id}
                    className="border-l-2 border-slate-200 pl-3 py-1"
                  >
                    <div className="flex items-center gap-2 text-slate-500">
                      <span>{a.created_at?.slice(0, 16).replace('T', ' ')}</span>
                      {a.kind && (
                        <span className="px-1.5 py-0.5 bg-slate-100 rounded">
                          {a.kind}
                        </span>
                      )}
                      {a.response && (
                        <span
                          className={
                            a.response === 'accepted'
                              ? 'text-green-600'
                              : 'text-slate-500'
                          }
                        >
                          {a.response}
                        </span>
                      )}
                    </div>
                    {a.wording && (
                      <div className="text-slate-700 mt-0.5">{a.wording}</div>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-slate-400">还没有建议历史</div>
            )}
          </div>
        </details>
      </div>

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

function PrefRow({
  label,
  hint,
  checked,
  busy,
  onToggle,
}: {
  label: string
  hint: string
  checked: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-slate-500 mt-0.5 leading-relaxed">{hint}</div>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-pressed={checked}
        className={`relative shrink-0 inline-flex h-6 w-11 items-center rounded-full transition disabled:opacity-50 ${
          checked ? 'bg-brand-600' : 'bg-slate-300'
        }`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition ${
            checked ? 'translate-x-5' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  )
}
