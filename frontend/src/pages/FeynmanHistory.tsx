import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError, FeynmanSessionSummary, FeynmanUnderstood } from '../api'
import EmptyState from '../components/EmptyState'

const DOT: Record<FeynmanUnderstood, string> = {
  understood: 'bg-green-500',
  mechanical: 'bg-amber-500',
  confused: 'bg-rose-500',
}

const STATUS_LABEL: Record<string, string> = {
  in_progress: '进行中',
  finished: '已完成',
  abandoned: '中途结束',
}

function fmtDate(s: string | null): string {
  if (!s) return ''
  return s.slice(0, 16).replace('T', ' ')
}

export default function FeynmanHistory() {
  const [sessions, setSessions] = useState<FeynmanSessionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [removingId, setRemovingId] = useState<number | null>(null)

  async function reload() {
    setLoading(true)
    setErr('')
    try {
      const data = await api.listFeynmanSessions(50)
      setSessions(data)
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  async function remove(id: number) {
    if (!confirm('删除这次讲解记录? 不可恢复.')) return
    setRemovingId(id)
    try {
      await api.deleteFeynmanSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
    } catch (e: any) {
      alert('删除失败: ' + (e?.message || e))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🎓 你讲过的</h1>
          <p className="mt-1 text-sm text-slate-500">
            反向教学的记录. 你讲给 AI 同学听过的题, 都在这里.
          </p>
        </div>
        <Link
          to="/feynman/new"
          className="shrink-0 rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          + 讲一个新知识点
        </Link>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      {loading ? (
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-500">
          加载中...
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          icon="🎓"
          title="还没有讲过题"
          description={
            <>
              把新学的知识点<b className="text-slate-700">讲给 AI 同学听</b>, 或者在做对的
              <Link to="/mistakes" className="text-brand-600 underline">错题</Link>之后试着讲一遍.
              讲清楚 = 真懂了.
            </>
          }
          ctaLabel="主动讲一个新知识点"
          ctaTo="/feynman/new"
        />
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => {
            const understood = s.assessment?.understood
            const dotClass = understood ? DOT[understood] : 'bg-slate-300'
            const statusLabel = STATUS_LABEL[s.status] || s.status
            return (
              <li
                key={s.id}
                className="rounded-lg border border-slate-200 bg-white p-4 hover:border-brand-300"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link to={`/feynman/${s.id}`} className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
                      <div className="truncate text-sm font-medium text-slate-800">
                        {s.topic_seed || '(未命名讲解)'}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5">{statusLabel}</span>
                      <span>{s.turn_count} 轮</span>
                      {s.assessment?.topic && <span>· {s.assessment.topic}</span>}
                      <span className="ml-auto">{fmtDate(s.created_at)}</span>
                    </div>
                  </Link>
                  <button
                    onClick={() => remove(s.id)}
                    disabled={removingId === s.id}
                    className="text-xs text-red-500 hover:text-red-700 disabled:opacity-50"
                  >
                    删除
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
