import { useEffect, useMemo, useState } from 'react'
import { api, Task, Checkin } from '../api'

const WEEK_THEMES: Record<number, { title: string; goal: string }> = {
  1: { title: '第 1 周 · 摸底与修复', goal: '找到数学失分规律' },
  2: { title: '第 2 周 · 数学稳基 + 社会框架', goal: '把该拿的分拿稳' },
  3: { title: '第 3 周 · 语文止下滑 + 英语精进', goal: '语文答题模板 + 英语句型库' },
  4: { title: '第 4 周 · 综合模考 + 查漏', goal: '全真模考并制定下阶段目标' },
}

const DOW_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Plan() {
  const [week, setWeek] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])

  async function reload() {
    const [ts, cks] = await Promise.all([api.listTasks(week), api.listCheckins(todayStr())])
    setTasks(ts)
    setCheckins(cks)
  }

  useEffect(() => {
    reload()
  }, [week])

  const grouped = useMemo(() => {
    const out: Record<number, Task[]> = {}
    for (const t of tasks) {
      ;(out[t.day_of_week] ||= []).push(t)
    }
    return out
  }, [tasks])

  const doneSet = new Set(checkins.map((c) => c.task_id))

  async function toggle(t: Task) {
    await api.upsertCheckin({
      task_id: t.id,
      checkin_date: todayStr(),
      completed: !doneSet.has(t.id),
    })
    const cks = await api.listCheckins(todayStr())
    setCheckins(cks)
  }

  const theme = WEEK_THEMES[week]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">4 周执行计划</h1>
        <p className="text-slate-500 mt-1">每天打卡 · 周末是弯道超车的关键</p>
      </div>

      {/* 周选择 */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((w) => (
          <button
            key={w}
            onClick={() => setWeek(w)}
            className={`px-4 py-2 rounded font-medium text-sm ${
              week === w ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            第 {w} 周
          </button>
        ))}
      </div>

      <div className="bg-brand-50 border border-brand-100 rounded-lg p-4">
        <div className="font-semibold text-brand-700">{theme.title}</div>
        <div className="text-sm text-slate-600 mt-1">核心目标：{theme.goal}</div>
      </div>

      {/* 分天任务 */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const dayTasks = grouped[d] || []
          if (dayTasks.length === 0) return null
          const doneOfDay = dayTasks.filter((t) => doneSet.has(t.id)).length
          return (
            <div key={d} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
                <div className="font-semibold">{DOW_LABEL[d - 1]}</div>
                <div className="text-xs text-slate-500">
                  {doneOfDay} / {dayTasks.length} · {dayTasks.reduce((s, t) => s + t.minutes, 0)} 分钟
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {dayTasks.map((t) => {
                  const done = doneSet.has(t.id)
                  return (
                    <li key={t.id} className="px-4 py-3 flex items-start gap-3">
                      <input
                        type="checkbox"
                        checked={done}
                        onChange={() => toggle(t)}
                        className="mt-1 w-5 h-5 accent-brand-600"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
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
            </div>
          )
        })}
      </div>
    </div>
  )
}
