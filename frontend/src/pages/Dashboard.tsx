import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Exam, Task, Checkin } from '../api'
import { useAuth } from '../auth'

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

export default function Dashboard() {
  const { user, boundStudent } = useAuth()
  const [exams, setExams] = useState<Exam[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [week, setWeek] = useState(1)

  const today = todayStr()
  const dow = dowFromDate(new Date())
  const isParent = user?.role === 'parent'
  const displayName = isParent ? boundStudent?.display_name : user?.display_name

  useEffect(() => {
    api.listExams().then(setExams)
  }, [])

  useEffect(() => {
    api.listTasks(week, dow).then(setTasks)
    api.listCheckins(today).then(setCheckins)
  }, [week, dow, today])

  const latest = exams[exams.length - 1]
  const prev = exams[exams.length - 2]
  const bestRank = useMemo(
    () =>
      exams.reduce<number | null>(
        (m, e) => (e.grade_rank != null && (m == null || e.grade_rank < m) ? e.grade_rank : m),
        null
      ),
    [exams]
  )

  async function toggle(task: Task) {
    const done = checkins.some((c) => c.task_id === task.id)
    await api.upsertCheckin({
      task_id: task.id,
      checkin_date: today,
      completed: !done,
    })
    const updated = await api.listCheckins(today)
    setCheckins(updated)
  }

  const doneCount = tasks.filter((t) => checkins.some((c) => c.task_id === t.id)).length
  const totalMins = tasks.reduce((s, t) => s + t.minutes, 0)
  const doneMins = tasks
    .filter((t) => checkins.some((c) => c.task_id === t.id))
    .reduce((s, t) => s + t.minutes, 0)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">今日 · {today}</h1>
        <p className="text-slate-500 mt-1">
          {isParent ? (
            <>正在查看 <span className="font-semibold text-brand-700">{displayName}</span> 的学习进度</>
          ) : (
            <>{displayName}，今天是 <span className="font-semibold text-brand-700">第 {week} 周 · 周{'一二三四五六日'[dow - 1]}</span></>
          )}
        </p>
      </div>

      {/* 学生显示自己的 join_code, 家长扫码绑定用 */}
      {user?.role === 'student' && user.join_code && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <span className="text-lg">👨‍👩‍👧</span>
          <div className="flex-1 text-sm">
            <div className="text-slate-700">
              让家长注册账号时输入你的绑定码：
            </div>
            <div className="font-mono text-xl font-bold text-amber-700 tracking-widest mt-1">
              {user.join_code}
            </div>
          </div>
        </div>
      )}

      {/* 成绩卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="最近总分"
          value={latest?.total?.toFixed(1) ?? '-'}
          trend={latest && prev && latest.total && prev.total ? latest.total - prev.total : undefined}
        />
        <StatCard
          label="最近年排"
          value={latest?.grade_rank ?? '-'}
          trend={
            latest && prev && latest.grade_rank != null && prev.grade_rank != null
              ? prev.grade_rank - latest.grade_rank
              : undefined
          }
          trendUnit="名"
          reverseTrendColor
        />
        <StatCard label="历史最佳" value={bestRank ?? '-'} suffix="名" />
        <StatCard label="累计考试" value={exams.length} suffix="次" />
      </div>

      {/* 今日进度 */}
      <div className="bg-white rounded-lg border border-slate-200 p-5">
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

      {/* 快捷入口 */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <QuickLink to="/trends" icon="📈" title="查看成绩趋势" desc="看看各科走势与排名变化" />
        <QuickLink to="/mistakes" icon="📓" title="记录错题" desc="今天的错题别忘了整理" />
        <QuickLink to="/methods" icon="🎯" title="学习方法" desc="卡住了？看看对应的方法卡" />
        <QuickLink to="/analysis" icon="📄" title="完整分析" desc="回顾全局诊断与 4 周策略" />
        <QuickLink to="/plan" icon="📅" title="4 周计划" desc="浏览所有周任务" />
      </div>
    </div>
  )
}

function StatCard({
  label,
  value,
  trend,
  trendUnit = '分',
  suffix,
  reverseTrendColor,
}: {
  label: string
  value: string | number
  trend?: number
  trendUnit?: string
  suffix?: string
  reverseTrendColor?: boolean
}) {
  const hasTrend = trend !== undefined && !isNaN(trend as number)
  const positive = (trend ?? 0) > 0
  const goodColor = reverseTrendColor ? (positive ? 'text-green-600' : 'text-red-500') : positive ? 'text-green-600' : 'text-red-500'
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-2xl font-bold mt-1">
        {value}
        {suffix && <span className="text-sm text-slate-400 ml-1">{suffix}</span>}
      </div>
      {hasTrend && trend !== 0 && (
        <div className={`text-xs mt-0.5 ${goodColor}`}>
          {positive ? '↑' : '↓'} {Math.abs(trend as number).toFixed(1)} {trendUnit}
        </div>
      )}
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
