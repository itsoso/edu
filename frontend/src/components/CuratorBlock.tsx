/**
 * CuratorBlock — "今天值得做的" (Web).
 *
 * 浅黄绿背景 (区分于 TutorCard 的紫蓝). 内部 fetch /api/curator/today.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, CuratedItem } from '../api'
import MathText from './MathText'

const KIND_EMOJI: Record<CuratedItem['kind'], string> = {
  review_mistake: '🔁',
  pattern_drill: '🎯',
  goal_aligned: '🎪',
  challenge: '🚀',
  rest_recommended: '🌿',
}

function safeRationale(item: CuratedItem): string | null {
  const r = item.rationale
  if (!r) return null
  if (r.length >= 100) return null
  if (/[\u0000-\u0008\u000b-\u001f]/.test(r)) return null
  return r
}

function routeFromSource(table: string | null, sourceId: number | null): string | null {
  if (!table) return null
  switch (table) {
    case 'mistakes':
      return '/mistakes'
    case 'practice_sets':
      return sourceId ? `/practice?openSetId=${sourceId}` : '/practice'
    case 'weekly_goals':
      return '/plan'
    default:
      return null
  }
}

export default function CuratorBlock() {
  const navigate = useNavigate()
  const [items, setItems] = useState<CuratedItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(true)
  const [completedCount, setCompletedCount] = useState(0)
  const [dismissedCount, setDismissedCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getCuratedToday()
      const all = r.items || []
      setItems(all)
      setCompletedCount(all.filter((i) => i.status === 'completed').length)
      setDismissedCount(all.filter((i) => i.status === 'dismissed').length)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const pending = useMemo(
    () => (items || []).filter((i) => i.status === 'pending'),
    [items]
  )

  useEffect(() => {
    if (
      items !== null &&
      pending.length === 0 &&
      completedCount + dismissedCount > 0
    ) {
      setOpen(false)
    }
  }, [pending.length, items, completedCount, dismissedCount])

  if (items === null && loading) {
    return (
      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 text-sm text-slate-500">
        加载中…
      </div>
    )
  }
  if (items === null || (items.length === 0 && !loading)) {
    return null
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await api.refreshCuratedToday()
      await load()
      setOpen(true)
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDo(item: CuratedItem) {
    try {
      await api.completeCuratedItem(item.id)
    } catch {
      /* ignore */
    }
    if (item.kind !== 'rest_recommended') {
      const route = routeFromSource(item.source_table, item.source_id)
      if (route) navigate(route)
    }
    setItems((prev) =>
      prev
        ? prev.map((x) => (x.id === item.id ? { ...x, status: 'completed' } : x))
        : prev
    )
    setCompletedCount((c) => c + 1)
  }

  async function handleSkip(item: CuratedItem) {
    try {
      await api.dismissCuratedItem(item.id)
    } catch {
      /* ignore */
    }
    setItems((prev) =>
      prev
        ? prev.map((x) => (x.id === item.id ? { ...x, status: 'dismissed' } : x))
        : prev
    )
    setDismissedCount((d) => d + 1)
  }

  return (
    <details
      className="bg-emerald-50 border border-emerald-200 rounded-lg"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="px-4 py-3 cursor-pointer select-none flex items-center justify-between">
        <span className="text-base font-bold text-emerald-900">
          💡 今天值得做的
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            handleRefresh()
          }}
          disabled={refreshing}
          className="text-xs px-2 py-1 border border-emerald-300 rounded text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"
        >
          {refreshing ? '换中…' : '换一批'}
        </button>
      </summary>
      <div className="px-4 pb-4 space-y-3">
        {(completedCount > 0 || dismissedCount > 0) && (
          <div className="text-xs text-slate-500">
            今天已完成 {completedCount} · 跳过 {dismissedCount}
          </div>
        )}
        {pending.length === 0 ? (
          <div className="text-sm text-slate-500 py-2">
            {completedCount + dismissedCount > 0
              ? '今天的小任务都处理完了, 休息一下.'
              : '今天暂无推荐.'}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {pending.map((item) => {
              const isRest = item.kind === 'rest_recommended'
              const rationale = safeRationale(item)
              return (
                <div
                  key={item.id}
                  className="bg-white border border-emerald-100 rounded-lg p-3 flex flex-col gap-1.5"
                >
                  <div className="flex items-start gap-2">
                    <span className="text-lg leading-none">
                      {KIND_EMOJI[item.kind] || '✨'}
                    </span>
                    <div className="flex-1 font-bold text-slate-900 text-[15px] leading-snug">
                      <MathText text={item.title} />
                    </div>
                  </div>
                  {item.description && (
                    <div className="text-xs text-slate-500 leading-relaxed">
                      <MathText text={item.description} />
                    </div>
                  )}
                  {rationale && (
                    <div className="text-xs italic text-purple-600 leading-relaxed">
                      💭 {rationale}
                    </div>
                  )}
                  {item.estimated_minutes != null && (
                    <div>
                      <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-lime-100 text-lime-800 font-medium">
                        ~{item.estimated_minutes} 分
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2 mt-1">
                    {isRest ? (
                      <button
                        type="button"
                        onClick={() => handleDo(item)}
                        className="px-3 py-1 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700"
                      >
                        知道了
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleDo(item)}
                          className="px-3 py-1 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 font-medium"
                        >
                          去做
                        </button>
                        <button
                          type="button"
                          onClick={() => handleSkip(item)}
                          className="px-3 py-1 text-sm border border-slate-200 text-slate-500 rounded hover:bg-slate-50"
                        >
                          跳过
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </details>
  )
}
