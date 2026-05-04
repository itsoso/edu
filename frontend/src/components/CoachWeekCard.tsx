/**
 * CoachWeekCard — Dashboard 的本周复盘预览卡 (web).
 *
 * 不存在 → 不渲染.
 * generating → 灰色等待卡.
 * done → 显示 focus_for_next_week + 跳转 /coach.
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, CoachReview } from '../api'

export default function CoachWeekCard() {
  const [review, setReview] = useState<CoachReview | null>(null)

  useEffect(() => {
    let cancelled = false
    api
      .getCoachThisWeek()
      .then((r) => {
        if (cancelled) return
        setReview(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!review || !review.exists) return null

  if (review.status === 'generating') {
    return (
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-sm text-slate-500">
        本周复盘 AI 写作中, 一会儿来看
      </div>
    )
  }

  if (review.status !== 'done') return null

  const focus = review.highlights?.focus_for_next_week || ''

  return (
    <Link
      to="/coach"
      className="block bg-white rounded-lg border border-slate-200 p-5 hover:border-brand-500 hover:shadow-sm transition"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm font-semibold text-slate-900">📅 本周回顾</div>
        <div className="text-xs text-slate-400">{review.week_start}</div>
      </div>
      {focus ? (
        <div className="text-base text-slate-800 leading-relaxed font-medium">
          {focus}
        </div>
      ) : (
        <div className="text-sm text-slate-500">本周复盘已生成</div>
      )}
      <div className="text-xs text-brand-600 mt-3">看完整复盘 →</div>
    </Link>
  )
}
