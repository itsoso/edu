import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Course } from '../api'

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function isoDate(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function isoWeekday(d: Date) {
  const js = d.getDay()
  return js === 0 ? 7 : js
}

/** 首页周末课程卡片 — 展示今天 + 接下来 2 天的课. specific_date 覆盖 weekday 默认. */
export default function WeekendCoursesCard() {
  const [courses, setCourses] = useState<Course[] | null>(null)

  useEffect(() => {
    api.listCourses().then(setCourses).catch(() => setCourses([]))
  }, [])

  if (!courses) return null
  if (courses.length === 0) return null

  // 今天 + 接下来 2 天的具体日期
  const today = new Date()
  const days: { date: Date; iso: string; weekday: number }[] = []
  for (let i = 0; i < 3; i++) {
    const d = new Date(today)
    d.setDate(today.getDate() + i)
    days.push({ date: d, iso: isoDate(d), weekday: isoWeekday(d) })
  }

  // 每一天 = 该日的 specific_date 条目 + 匹配 weekday 的 recurring 条目
  const byDay = days.map(({ iso, weekday, date }) => {
    const specific = courses.filter((c) => c.specific_date === iso)
    const recurring = courses.filter((c) => !c.specific_date && c.weekday === weekday)
    const items = [...specific, ...recurring].sort((a, b) =>
      a.start_time.localeCompare(b.start_time)
    )
    return { iso, weekday, date, items, hasOverride: specific.length > 0 }
  })

  const hasAny = byDay.some((d) => d.items.length > 0)
  if (!hasAny) {
    return (
      <Link
        to="/schedule"
        className="block rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 hover:bg-slate-50"
      >
        <div className="flex items-center justify-between">
          <span>🗓️ 最近三天没有课</span>
          <span className="text-xs text-slate-400">查看全部 →</span>
        </div>
      </Link>
    )
  }

  const todayIso = isoDate(today)

  return (
    <Link
      to="/schedule"
      className="block rounded-lg border border-rose-200 bg-rose-50 p-4 hover:bg-rose-100 transition"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold text-rose-900">🗓️ 接送安排</div>
        <span className="text-xs text-rose-700">查看全部 →</span>
      </div>
      <div className="space-y-2 text-sm">
        {byDay.map(({ iso, weekday, items, hasOverride }) => {
          if (items.length === 0) return null
          const isToday = iso === todayIso
          return (
            <div key={iso}>
              <div className="flex items-center gap-2 text-xs font-medium text-rose-700">
                <span>
                  {iso.slice(5)} {WEEKDAY_LABELS[weekday]}
                  {isToday ? ' · 今天' : ''}
                </span>
                {hasOverride && (
                  <span className="rounded bg-amber-200 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                    临时调课
                  </span>
                )}
              </div>
              <ul className="mt-1 space-y-0.5 text-slate-700">
                {items.map((c) => (
                  <li key={c.id} className="flex items-baseline gap-2">
                    <span className="font-mono text-xs text-slate-500">
                      {c.start_time}-{c.end_time}
                    </span>
                    <span className="font-medium">{c.child_name}</span>
                    <span>· {c.course_name}</span>
                    {c.location && (
                      <span className="text-xs text-slate-500">@ {c.location}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </Link>
  )
}
