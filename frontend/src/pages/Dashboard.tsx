import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Task, Checkin } from '../api'
import { useAuth } from '../auth'
import { usePolling } from '../hooks/usePolling'

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dowFromDate(d: Date) {
  // JS: 0=Sun ... 6=Sat  →  我们的: 1=Mon ... 7=Sun
  const js = d.getDay()
  return js === 0 ? 7 : js
}

type Summary = {
  streak_days: number
  month_checkins: number
  month_distinct_days: number
  practice: { total: number; graded: number; correct: number }
  mistakes: { total: number; mastered: number }
  calendar_14d: { date: string; done: number }[]
}

type DailyTip = {
  id?: number
  content?: string
  status?: 'generating' | 'done' | 'failed'
  exists?: boolean
  skipped?: boolean
}

// 本周学习笔记的 localStorage key 按用户 id 隔离
function noteKey(userId: number | undefined, weekOf: string) {
  return `edu.weekNote.${userId || 'anon'}.${weekOf}`
}

// 返回本周的 "YYYY-MM-DD (周一)" 作为 key
function currentWeekStart(): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Dashboard() {
  const { user, boundStudent } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [tip, setTip] = useState<DailyTip | null>(null)
  const [tipOpen, setTipOpen] = useState(false)
  const [week, setWeek] = useState(1)
  const [weekNote, setWeekNote] = useState('')
  const [weekNoteSaved, setWeekNoteSaved] = useState(false)

  const today = todayStr()
  const dow = dowFromDate(new Date())
  const isParent = user?.role === 'parent'
  const displayName = isParent ? boundStudent?.display_name : user?.display_name
  const weekOf = currentWeekStart()
  const nKey = noteKey(user?.id, weekOf)

  useEffect(() => {
    api.dashboardSummary().then(setSummary).catch(() => {})
    api.dailyTip().then(setTip).catch(() => {})
  }, [])

  // 加载本周笔记
  useEffect(() => {
    if (!user?.id) return
    try {
      setWeekNote(localStorage.getItem(nKey) || '')
    } catch {}
  }, [nKey, user?.id])

  // debounce 保存到 localStorage
  useEffect(() => {
    if (!user?.id || isParent) return
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(nKey, weekNote)
        setWeekNoteSaved(true)
        window.setTimeout(() => setWeekNoteSaved(false), 1500)
      } catch {}
    }, 600)
    return () => window.clearTimeout(t)
  }, [weekNote, nKey, user?.id, isParent])

  // Tip 生成中时自动轮询
  const tipGenerating = tip?.status === 'generating'
  usePolling(
    async () => {
      const t = await api.dailyTip()
      setTip(t)
      return t
    },
    (t: any) => t?.status === 'generating',
    { interval: 3000, enabled: tipGenerating }
  )

  useEffect(() => {
    api.listTasks(week, dow).then(setTasks)
    api.listCheckins(today).then(setCheckins)
  }, [week, dow, today])

  async function refreshSummary() {
    try {
      const s = await api.dashboardSummary()
      setSummary(s)
    } catch {}
  }

  async function toggle(task: Task) {
    const done = checkins.some((c) => c.task_id === task.id)
    await api.upsertCheckin({
      task_id: task.id,
      checkin_date: today,
      completed: !done,
    })
    const updated = await api.listCheckins(today)
    setCheckins(updated)
    refreshSummary()
  }

  const doneCount = tasks.filter((t) => checkins.some((c) => c.task_id === t.id)).length
  const totalMins = tasks.reduce((s, t) => s + t.minutes, 0)
  const doneMins = tasks
    .filter((t) => checkins.some((c) => c.task_id === t.id))
    .reduce((s, t) => s + t.minutes, 0)

  // 家长视图: 默认不显示孩子的数据, 要主动展开
  if (isParent) {
    return <ParentHome displayName={displayName || '孩子'} today={today} />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">今日 · {today}</h1>
        <p className="text-slate-500 mt-1">
          {displayName}，今天是 <span className="font-semibold text-brand-700">第 {week} 周 · 周{'一二三四五六日'[dow - 1]}</span>
        </p>
      </div>

      {/* 🆕 本周我学到了什么 — 她自己的空间 */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-2">
          <label className="text-sm font-semibold">本周我学到了什么</label>
          <span className="text-xs text-slate-400">
            {weekNoteSaved ? '已保存 ✓' : '只有你自己看得到 · 不会分析'}
          </span>
        </div>
        <textarea
          value={weekNote}
          onChange={(e) => setWeekNote(e.target.value)}
          placeholder="一句话、几个词、一段话都行。周五回头看会很有意思。"
          className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          rows={3}
          maxLength={500}
        />
        <div className="text-xs text-slate-400 mt-1 text-right">
          {weekNote.length} / 500
        </div>
      </div>

      {/* 今日任务 — 立言每天真正要做的事, 现在是头号主角 */}
      <div className="bg-white rounded-lg border border-slate-200 p-5" id="today-tasks">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">今日任务</h2>
          <div className="flex items-center gap-2">
            <label className="text-sm text-slate-500">第</label>
            <select
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
              className="border border-slate-300 rounded px-2 py-1 text-sm"
            >
              {[1, 2, 3, 4].map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
            <label className="text-sm text-slate-500">周</label>
          </div>
        </div>

        {tasks.length === 0 ? (
          <p className="text-slate-400 text-sm">没有任务（可能是周末补习日，去 计划 页面查看）</p>
        ) : (
          <>
            <div className="mb-3 text-sm text-slate-600">
              完成 <span className="font-bold text-brand-700">{doneCount}</span> / {tasks.length}{' '}
              · 用时 {doneMins} / {totalMins} 分钟
            </div>
            <div className="w-full bg-slate-100 rounded-full h-2 mb-4">
              <div
                className="bg-brand-600 h-2 rounded-full transition-all"
                style={{ width: `${tasks.length ? (doneCount / tasks.length) * 100 : 0}%` }}
              />
            </div>
            <ul className="space-y-2">
              {tasks.map((t) => {
                const done = checkins.some((c) => c.task_id === t.id)
                return (
                  <li
                    key={t.id}
                    className={`flex items-start gap-3 p-3 rounded border ${
                      done ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={done}
                      onChange={() => toggle(t)}
                      className="mt-1 w-5 h-5 accent-brand-600"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {t.subject && (
                          <span className="text-xs px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded">
                            {t.subject}
                          </span>
                        )}
                        <span className={`font-medium ${done ? 'line-through text-slate-400' : ''}`}>
                          {t.title}
                        </span>
                        <span className="text-xs text-slate-400">{t.minutes} 分钟</span>
                      </div>
                      {t.description && (
                        <p className={`text-sm mt-1 ${done ? 'text-slate-400' : 'text-slate-600'}`}>
                          {t.description}
                        </p>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>

      {/* 近 14 天打卡 (中性展示, 去掉 streak 数字和 🔥) */}
      {summary && (
        <div className="bg-white rounded-lg border border-slate-200 p-4">
          <div className="text-xs text-slate-500 mb-2">
            {describeRecent(summary)}
          </div>
          <CalendarStrip days={summary.calendar_14d} today={today} />
        </div>
      )}

      {/* 需要的时候再看: AI 建议 + Join code */}
      <div className="space-y-2">
          {/* AI 建议: 折叠, 需要才看 */}
          {tip && !tip.skipped && (
            <details
              className="bg-slate-50 border border-slate-200 rounded-lg text-sm"
              open={tipOpen}
              onToggle={(e) => setTipOpen((e.target as HTMLDetailsElement).open)}
            >
              <summary className="px-4 py-2 cursor-pointer text-slate-600 select-none">
                💭 如果你想听 AI 说一句 (可选)
              </summary>
              <div className="px-4 pb-3 pt-1 text-slate-700 leading-relaxed">
                {tip.status === 'generating' && (
                  <span className="text-slate-500 animate-pulse">AI 正在写...</span>
                )}
                {tip.status === 'done' && tip.content}
                {tip.status === 'failed' && (
                  <span className="text-slate-400">AI 暂时没话说, 明天见</span>
                )}
              </div>
            </details>
          )}

          {/* Join code: 折叠, 家长注册时才需要 */}
          {user?.role === 'student' && user.join_code && (
            <details className="bg-slate-50 border border-slate-200 rounded-lg text-sm">
              <summary className="px-4 py-2 cursor-pointer text-slate-600 select-none">
                👨‍👩‍👧 家长绑定码
              </summary>
              <div className="px-4 pb-3 pt-1">
                <div className="text-xs text-slate-500 mb-1">让家长注册时输入这 6 位码:</div>
                <code className="font-mono text-lg font-bold text-amber-700 tracking-widest">
                  {user.join_code}
                </code>
              </div>
            </details>
          )}
        </div>

      {/* 次要入口 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <QuickLink to="/mistakes" icon="📓" title="错题本" desc="记录 + 归因 + 巩固" />
        <QuickLink to="/scan" icon="📸" title="扫试卷" desc="AI 识别错题" />
        <QuickLink to="/practice" icon="🏋️" title="训练" desc="基于错题的类题练习" />
        <QuickLink to="/trends" icon="📈" title="成绩趋势" desc="考试数据和走势" />
        <QuickLink to="/methods" icon="🎯" title="学习方法" desc="各科速查卡" />
        <QuickLink to="/analysis" icon="📄" title="完整分析" desc="学业诊断与方案" />
      </div>
    </div>
  )
}

/** 中性描述最近 14 天的打卡状态 — 没有 "连续 X 天" 的心理绑架. */
function describeRecent(summary: Summary): string {
  const { calendar_14d, month_distinct_days } = summary
  const days14 = calendar_14d.filter((d) => d.done > 0).length
  const total14 = calendar_14d.reduce((s, d) => s + d.done, 0)
  if (days14 === 0) {
    return '最近两周还没打卡. 任何时候开始都不算晚.'
  }
  const avg = total14 / Math.max(1, days14)
  return `最近两周你在 ${days14} 天里打卡, 平均每天 ${avg.toFixed(1)} 项. 本月共 ${month_distinct_days} 天.`
}

function CalendarStrip({
  days,
  today,
}: {
  days: { date: string; done: number }[]
  today: string
}) {
  return (
    <div>
      <div className="flex gap-1 items-end">
        {days.map((d) => {
          const level = d.done === 0 ? 0 : d.done <= 2 ? 1 : d.done <= 4 ? 2 : 3
          // 中性色阶 — 不用激励色 (红/金), 用冷静的青灰色
          const bg = [
            'bg-slate-100',
            'bg-slate-300',
            'bg-slate-500',
            'bg-slate-700',
          ][level]
          const isToday = d.date === today
          const dayNum = d.date.slice(8)
          return (
            <div
              key={d.date}
              className="flex-1 flex flex-col items-center gap-1"
              title={`${d.date}: ${d.done} 项`}
            >
              <div
                className={`w-full rounded ${bg} ${
                  isToday ? 'ring-2 ring-brand-500 ring-offset-1' : ''
                }`}
                style={{ height: `${12 + level * 6}px` }}
              />
              <div className="text-[10px] text-slate-400">{dayNum}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function QuickLink({ to, icon, title, desc }: { to: string; icon: string; title: string; desc: string }) {
  return (
    <Link
      to={to}
      className="block bg-white rounded-lg border border-slate-200 p-4 hover:border-brand-500 hover:shadow-sm transition"
    >
      <div className="text-2xl mb-1">{icon}</div>
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
    </Link>
  )
}

/**
 * 家长首页. 默认不显示孩子任何数据.
 *
 * 设计原则 (来自改进计划阶段 1):
 * - 家长视图不是监控后台
 * - 如果想看数据必须主动点开 (自己会意识到"我又在查了")
 * - 首页鼓励家长做"自省"而非"观察"
 *
 * 展开次数可以通过 localStorage 计数 (本地, 不上传), 月底给家长一个轻量反馈回路.
 */
function ParentHome({ displayName, today }: { displayName: string; today: string }) {
  const monthKey = `edu.parentPeeks.${today.slice(0, 7)}`
  const [peeks, setPeeks] = useState(() => {
    try {
      return parseInt(localStorage.getItem(monthKey) || '0', 10)
    } catch {
      return 0
    }
  })

  function recordPeek() {
    const n = peeks + 1
    setPeeks(n)
    try {
      localStorage.setItem(monthKey, String(n))
    } catch {}
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">今天 · {today}</h1>
        <p className="text-slate-500 mt-1 text-sm">
          你是 <span className="font-medium">{displayName}</span> 的家长视图
        </p>
      </div>

      {/* 默认状态: 一段安静的话, 不显示任何数据 */}
      <div className="bg-gradient-to-br from-slate-50 to-blue-50 border border-slate-200 rounded-lg p-6 md:p-8 space-y-4">
        <div className="text-lg text-slate-800 leading-relaxed">
          今天她没主动找你, 说明一切在她自己掌握中。
        </div>
        <div className="text-sm text-slate-600 leading-relaxed space-y-2">
          <p>
            学习最重要的那部分, 数据从来看不出来——
            她在一道题卡住时皱的眉, 做对时轻微的得意, 这些数据都不知道。
          </p>
          <p>
            你真正该观察的, 是她聊起学习时的表情, 不是她的打卡次数。
          </p>
        </div>
      </div>

      {/* 自省小清单 */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="text-sm font-semibold mb-3">今天, 你可以问问自己:</div>
        <ul className="text-sm text-slate-700 space-y-2 list-disc pl-5 leading-relaxed">
          <li>她这个月有没有提到过某件让她<b>兴奋</b>的事?</li>
          <li>你最近一次和她聊"学习以外"的话题, 是什么时候?</li>
          <li>如果她今天考砸了, 你会先问原因, 还是先听她感受?</li>
          <li>这周你有没有<b>没被问</b>就给她建议?</li>
        </ul>
      </div>

      {/* 如果确实想看数据, 必须主动展开 */}
      <details
        className="bg-white border border-slate-200 rounded-lg"
        onToggle={(e) => {
          if ((e.target as HTMLDetailsElement).open) recordPeek()
        }}
      >
        <summary className="px-5 py-4 cursor-pointer text-sm text-slate-600 select-none flex items-center justify-between">
          <span>🔍 如果你真的想看她的数据</span>
          <span className="text-xs text-slate-400">
            本月已展开 {peeks} 次
          </span>
        </summary>
        <div className="px-5 pb-5 pt-2 text-sm space-y-3">
          <div className="text-xs text-slate-500 leading-relaxed">
            以下链接会跳到她的学习数据. 你可以看, 但每次看都会累计到上面的计数里——
            不是为了羞辱, 是为了让你自己意识到"我又想查了".
          </div>
          <div className="grid grid-cols-2 gap-3 pt-2">
            <Link to="/trends" className="border border-slate-200 rounded p-3 hover:border-brand-500 text-sm">
              📈 成绩趋势
            </Link>
            <Link to="/mistakes" className="border border-slate-200 rounded p-3 hover:border-brand-500 text-sm">
              📓 错题本
            </Link>
            <Link to="/reports" className="border border-slate-200 rounded p-3 hover:border-brand-500 text-sm">
              🧠 月度复盘
            </Link>
            <Link to="/plan" className="border border-slate-200 rounded p-3 hover:border-brand-500 text-sm">
              📅 计划
            </Link>
          </div>
        </div>
      </details>
    </div>
  )
}
