import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, Course } from '../api'

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']

function todayDow() {
  const js = new Date().getDay()
  return js === 0 ? 7 : js
}

/** 首页周末课程卡片 — 今天是周几, 就看今天 + 接下来 2 天, 覆盖周五-周日. */
export default function WeekendCoursesCard() {
  const [courses, setCourses] = useState<Course[] | null>(null)

  useEffect(() => {
    api.listCourses({ weekend: true }).then(setCourses).catch(() => setCourses([]))
  }, [])

  if (!courses) return null
  if (courses.length === 0) return null

  const today = todayDow()
  // 只挑今天/明天/后天三天的课 (家长关心的接送窗口)
  const upcomingDays = new Set([today, (today % 7) + 1, ((today + 1) % 7) + 1])
  const upcoming = courses.filter((c) => upcomingDays.has(c.weekday))
  if (upcoming.length === 0) {
    return (
      <Link
        to="/schedule"
        className="block rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-600 hover:bg-slate-50"
      >
        <div className="flex items-center justify-between">
          <span>🗓️ 周末课表（本周无课或已结束）</span>
          <span className="text-xs text-slate-400">查看全部 →</span>
        </div>
      </Link>
    )
  }

  // 按 (weekday, start_time) 排
  upcoming.sort((a, b) =>
    a.weekday !== b.weekday ? a.weekday - b.weekday : a.start_time.localeCompare(b.start_time)
  )

  const byDay = new Map<number, Course[]>()
  for (const c of upcoming) {
    if (!byDay.has(c.weekday)) byDay.set(c.weekday, [])
    byDay.get(c.weekday)!.push(c)
  }

  return (
    <Link
      to="/schedule"
      className="block rounded-lg border border-rose-200 bg-rose-50 p-4 hover:bg-rose-100 transition"
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold text-rose-900">🗓️ 周末接送安排</div>
        <span className="text-xs text-rose-700">查看全部 →</span>
      </div>
      <div className="space-y-2 text-sm">
        {Array.from(byDay.entries()).map(([d, list]) => (
          <div key={d}>
            <div className="text-xs font-medium text-rose-700">
              {WEEKDAY_LABELS[d]}{d === today ? ' · 今天' : ''}
            </div>
            <ul className="mt-1 space-y-0.5 text-slate-700">
              {list.map((c) => (
                <li key={c.id} className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-slate-500">
                    {c.start_time}-{c.end_time}
                  </span>
                  <span className="font-medium">{c.child_name}</span>
                  <span>· {c.course_name}</span>
                  {c.location && <span className="text-xs text-slate-500">@ {c.location}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Link>
  )
}
