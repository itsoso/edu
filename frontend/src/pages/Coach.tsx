/**
 * Coach (/coach) — P6 周日复盘完整页 (web).
 *
 * 当前周 markdown + highlights, 学生本人可重新生成 / 删除, 历史时间轴.
 */
import { useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api, CoachHistoryEntry, CoachReview } from '../api'
import { useAuth } from '../auth'

export default function Coach() {
  const { user } = useAuth()
  const isStudent = user?.role === 'student'

  const [review, setReview] = useState<CoachReview | null>(null)
  const [history, setHistory] = useState<CoachHistoryEntry[]>([])
  const [activeWeek, setActiveWeek] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const loadReview = useCallback(async (week?: string | null) => {
    setErr('')
    try {
      const r = week
        ? await api.getCoachWeek(week)
        : await api.getCoachThisWeek()
      setReview(r)
    } catch (e: any) {
      setErr(e?.message || String(e))
      setReview(null)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.listCoachHistory()
      setHistory(Array.isArray(data) ? data : [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadReview(null)
    loadHistory()
  }, [loadReview, loadHistory])

  async function regenerate() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      await api.regenerateCoachThisWeek()
      setActiveWeek(null)
      await loadReview(null)
      await loadHistory()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeWeek() {
    const ws = review?.week_start
    if (!ws) return
    if (!confirm(`删除 ${ws} 这周的复盘?`)) return
    try {
      await api.deleteCoachWeek(ws)
      setReview({ exists: false, week_start: ws })
      await loadHistory()
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  function pickWeek(ws: string) {
    setActiveWeek(ws)
    loadReview(ws)
  }

  const isCurrent = !activeWeek
  const isDone = review?.exists && review?.status === 'done'
  const isGenerating = review?.exists && review?.status === 'generating'
  const isFailed = review?.exists && review?.status === 'failed'

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">📅 周日复盘</h1>
        <p className="text-slate-500 mt-1 text-sm">
          {review?.week_start
            ? `本周起始 ${review.week_start}`
            : 'AI 教练每周回顾 + 下周方向'}
        </p>
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {err}
        </div>
      )}

      {!review?.exists && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3">
          <p className="text-sm text-slate-600 leading-relaxed">
            本周还没有复盘. 等到周日 AI 会自动生成, 你也可以现在手动生成.
          </p>
          {isStudent && isCurrent && (
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="px-4 py-2 bg-brand-600 text-white text-sm rounded hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? '生成中...' : '生成本周复盘'}
            </button>
          )}
        </div>
      )}

      {isGenerating && (
        <div className="bg-slate-50 border border-slate-200 rounded p-4 text-sm text-slate-600">
          AI 正在写本周复盘, 一会儿来看.
        </div>
      )}

      {isFailed && (
        <div className="bg-red-50 border border-red-200 rounded p-4 space-y-2">
          <div className="text-sm font-semibold text-red-900">生成失败</div>
          {review?.error_message && (
            <div className="text-sm text-slate-700">{review.error_message}</div>
          )}
          {isStudent && isCurrent && (
            <button
              type="button"
              onClick={regenerate}
              disabled={busy}
              className="px-3 py-1.5 bg-brand-600 text-white text-sm rounded disabled:opacity-50"
            >
              {busy ? '...' : '重新生成'}
            </button>
          )}
        </div>
      )}

      {isDone && review?.highlights && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <HighlightBlock
            label="做得好的"
            items={review.highlights.strengths}
          />
          <HighlightBlock
            label="值得注意的"
            items={review.highlights.watchouts}
          />
          <HighlightBlock
            label="下周可以试试"
            items={
              review.highlights.focus_for_next_week
                ? [review.highlights.focus_for_next_week]
                : []
            }
          />
        </div>
      )}

      {isDone && (
        <div className="bg-white border border-slate-200 rounded-lg p-6 md:p-8 md-content">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {review?.content_md || ''}
          </ReactMarkdown>
        </div>
      )}

      {isDone && isStudent && isCurrent && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={regenerate}
            disabled={busy}
            className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? '...' : '🔄 重新生成'}
          </button>
          <button
            type="button"
            onClick={removeWeek}
            className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded hover:bg-red-50"
          >
            删除本周
          </button>
        </div>
      )}

      {/* 历史时间轴 */}
      <details
        className="bg-white border border-slate-200 rounded-lg"
        open={historyOpen}
        onToggle={(e) => setHistoryOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="px-4 py-3 cursor-pointer text-sm text-slate-600 select-none">
          历史复盘 · 共 {history.length} 周
        </summary>
        <div className="px-3 pb-3 pt-1 space-y-1">
          {history.length === 0 && (
            <div className="text-sm text-slate-400 px-2 py-2">
              还没有历史复盘.
            </div>
          )}
          {history.map((h) => {
            const active = activeWeek === h.week_start
            return (
              <button
                key={h.week_start}
                type="button"
                onClick={() => pickWeek(h.week_start)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded text-left text-sm ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'hover:bg-slate-50 text-slate-800'
                }`}
              >
                <span>{h.week_start}</span>
                <span className="text-xs text-slate-500">
                  {h.status === 'done'
                    ? '已完成'
                    : h.status === 'generating'
                    ? '生成中'
                    : '失败'}
                </span>
              </button>
            )
          })}
          {activeWeek && (
            <button
              type="button"
              onClick={() => {
                setActiveWeek(null)
                loadReview(null)
              }}
              className="text-xs text-brand-600 px-3 py-1"
            >
              ← 回到本周
            </button>
          )}
        </div>
      </details>
    </div>
  )
}

function HighlightBlock({
  label,
  items,
}: {
  label: string
  items: string[]
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs font-semibold text-slate-500 mb-2">{label}</div>
      {items.length === 0 ? (
        <div className="text-sm text-slate-400">—</div>
      ) : (
        <ul className="text-sm text-slate-800 space-y-1 leading-relaxed">
          {items.map((s, i) => (
            <li key={i}>• {s}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
