import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  api,
  ApiError,
  FeynmanAssessment,
  FeynmanMessage,
  FeynmanSourceTable,
  FeynmanUnderstood,
} from '../api'
import MathText from '../components/MathText'

const MAX_TURNS_FALLBACK = 4

const VALID_SOURCES: FeynmanSourceTable[] = ['mistakes', 'practice_items', 'manual']

function sourceBackPath(table: FeynmanSourceTable | null, id: number | null): string {
  if (table === 'practice_items') return '/practice'
  if (table === 'mistakes') return '/mistakes'
  return '/feynman-history'
}

export default function Feynman() {
  const { id } = useParams<{ id?: string }>()
  const [searchParams] = useSearchParams()
  const nav = useNavigate()

  const [sessionId, setSessionId] = useState<number | null>(
    id ? Number(id) : null,
  )
  const [messages, setMessages] = useState<FeynmanMessage[]>([])
  const [turnCount, setTurnCount] = useState(0)
  const [maxTurns, setMaxTurns] = useState(MAX_TURNS_FALLBACK)
  const [topicSeed, setTopicSeed] = useState<string>('')
  const [status, setStatus] = useState<'in_progress' | 'finished' | 'abandoned' | string>('in_progress')
  const [assessment, setAssessment] = useState<FeynmanAssessment | null>(null)
  const [sourceTable, setSourceTable] = useState<FeynmanSourceTable | null>(null)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [manualSubject, setManualSubject] = useState<string | null>(null)
  const [manualKp, setManualKp] = useState<string | null>(null)

  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const scrollerRef = useRef<HTMLDivElement | null>(null)

  const finished = status === 'finished' || status === 'abandoned'
  const abandoned = status === 'abandoned'

  // 启动: 有 id 加载历史; 没 id 从 query 读 source 然后 startFeynman
  useEffect(() => {
    let cancelled = false
    async function boot() {
      setLoading(true)
      setErr('')
      try {
        if (id) {
          const data = await api.getFeynmanSession(Number(id))
          if (cancelled) return
          setSessionId(data.id)
          setMessages(data.conversation || [])
          setTurnCount(data.turn_count || 0)
          setStatus(data.status)
          setAssessment(data.assessment)
          setTopicSeed(data.topic_seed || '')
          setSourceTable(data.source_table)
          setSourceId(data.source_id)
          setManualSubject(data.manual_subject || null)
          setManualKp(data.manual_knowledge_point || null)
        } else {
          const qsTable = searchParams.get('source_table') as FeynmanSourceTable | null
          const qsIdRaw = searchParams.get('source_id')
          const startBody: { source_table?: FeynmanSourceTable; source_id?: number } = {}
          if (qsTable && VALID_SOURCES.includes(qsTable)) {
            startBody.source_table = qsTable
            setSourceTable(qsTable)
          }
          if (qsIdRaw && !Number.isNaN(Number(qsIdRaw))) {
            startBody.source_id = Number(qsIdRaw)
            setSourceId(Number(qsIdRaw))
          }
          const r = await api.startFeynman(startBody)
          if (cancelled) return
          setSessionId(r.session_id)
          setTopicSeed(r.topic_seed)
          setMaxTurns(r.max_turns || MAX_TURNS_FALLBACK)
          setMessages([{ role: 'ai', content: r.opening_question }])
          setTurnCount(0)
          setStatus('in_progress')
          setAssessment(null)
          // 用 replace 让浏览器后退不会再触发 start
          nav(`/feynman/${r.session_id}`, { replace: true })
        }
      } catch (e: any) {
        if (cancelled) return
        setErr(e instanceof ApiError ? e.message : String(e?.message || e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void boot()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // 自动滚到底
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, busy, assessment])

  async function send() {
    const text = draft.trim()
    if (!text || !sessionId || finished) return
    setBusy(true)
    setErr('')
    // 乐观加学生气泡
    setMessages((prev) => [...prev, { role: 'student', content: text }])
    setDraft('')
    try {
      const r = await api.feynmanTurn(sessionId, text)
      setTurnCount(r.turn_count)
      if (r.next_question) {
        setMessages((prev) => [...prev, { role: 'ai', content: r.next_question as string }])
      }
      if (r.finished) {
        setStatus('finished')
        setAssessment(r.assessment)
      }
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function endNow() {
    if (!sessionId || finished) return
    if (!confirm('结束这次讲解? AI 会基于已经讲的内容做个小评估')) return
    setBusy(true)
    setErr('')
    try {
      const r = await api.feynmanFinish(sessionId)
      if (r.abandoned) {
        setStatus('abandoned')
      } else {
        setStatus('finished')
        setAssessment(r.assessment || null)
      }
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function restart() {
    setLoading(true)
    setErr('')
    try {
      const startBody: { source_table?: FeynmanSourceTable; source_id?: number } = {}
      if (sourceTable) startBody.source_table = sourceTable
      if (sourceId != null) startBody.source_id = sourceId
      const r = await api.startFeynman(startBody)
      setSessionId(r.session_id)
      setTopicSeed(r.topic_seed)
      setMaxTurns(r.max_turns || MAX_TURNS_FALLBACK)
      setMessages([{ role: 'ai', content: r.opening_question }])
      setTurnCount(0)
      setStatus('in_progress')
      setAssessment(null)
      nav(`/feynman/${r.session_id}`, { replace: true })
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }

  const backPath = useMemo(() => sourceBackPath(sourceTable, sourceId), [sourceTable, sourceId])

  return (
    <div className="mx-auto flex h-[calc(100vh-8rem)] max-w-3xl flex-col">
      {/* 顶部条 */}
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-800">🎓 教教我</h1>
          {topicSeed && (
            <div className="mt-0.5 truncate text-xs text-slate-500">主题: {topicSeed}</div>
          )}
        </div>
        <div className="text-xs text-slate-500">
          {finished ? (
            <span>已结束</span>
          ) : (
            <span>第 {turnCount} 轮 / 最多 {maxTurns} 轮</span>
          )}
        </div>
      </div>

      {err && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      {/* 对话区 */}
      <div ref={scrollerRef} className="flex-1 space-y-3 overflow-y-auto py-4">
        {loading ? (
          <div className="text-sm text-slate-400">加载中...</div>
        ) : (
          messages.map((m, i) => <Bubble key={i} msg={m} />)
        )}

        {busy && !finished && (
          <div className="flex">
            <div className="max-w-[80%] rounded-2xl rounded-tl-sm bg-purple-50 px-3 py-2 text-sm text-purple-700 shadow-sm">
              <span className="animate-pulse">同学在想...</span>
            </div>
          </div>
        )}

        {abandoned && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            这次讲得不太够, 没生成评估也没关系. 想清楚了再来一次也行.
          </div>
        )}

        {finished && !abandoned && assessment && (
          <AssessmentCard
            assessment={assessment}
            backPath={backPath}
            onRestart={restart}
            manualSubject={manualSubject}
            manualKp={manualKp}
          />
        )}
      </div>

      {/* 底部输入 */}
      {!finished && (
        <div className="sticky bottom-0 border-t border-slate-200 bg-white pt-3">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void send()
              }
            }}
            rows={3}
            placeholder="把你的思路讲给 AI 同学听 (Cmd/Ctrl + Enter 发送)"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            disabled={busy || loading}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <button
              onClick={endNow}
              disabled={busy || loading}
              className="rounded-full border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              结束对话
            </button>
            <button
              onClick={send}
              disabled={busy || loading || !draft.trim()}
              className="rounded-full bg-brand-600 px-5 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {busy ? '发送中...' : '继续讲'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Bubble({ msg }: { msg: FeynmanMessage }) {
  const isAi = msg.role === 'ai'
  return (
    <div className={`flex ${isAi ? 'justify-start' : 'justify-end'}`}>
      <div
        className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed shadow-sm ${
          isAi
            ? 'rounded-tl-sm bg-purple-50 text-purple-900'
            : 'rounded-tr-sm bg-blue-50 text-blue-900'
        }`}
      >
        <MathText text={msg.content} />
      </div>
    </div>
  )
}

const UNDERSTOOD_STYLE: Record<FeynmanUnderstood, { label: string; bg: string; border: string; text: string; dot: string }> = {
  understood: {
    label: '讲明白了',
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-800',
    dot: 'bg-green-500',
  },
  mechanical: {
    label: '只是套了步骤',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-800',
    dot: 'bg-amber-500',
  },
  confused: {
    label: '还有些没想清',
    bg: 'bg-rose-50',
    border: 'border-rose-200',
    text: 'text-rose-800',
    dot: 'bg-rose-500',
  },
}

function AssessmentCard({
  assessment,
  backPath,
  onRestart,
  manualSubject,
  manualKp,
}: {
  assessment: FeynmanAssessment
  backPath: string
  onRestart: () => void
  manualSubject: string | null
  manualKp: string | null
}) {
  const style = UNDERSTOOD_STYLE[assessment.understood] || UNDERSTOOD_STYLE.confused
  const conf = Math.round((assessment.confidence || 0) * 100)
  const mastered =
    assessment.understood === 'understood' && !!manualSubject && !!manualKp
  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4 space-y-3`}>
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${style.dot}`} />
        <div className={`text-sm font-semibold ${style.text}`}>{style.label}</div>
        <span className="ml-auto text-xs text-slate-500">置信度 {conf}%</span>
      </div>
      {assessment.topic && (
        <div className="text-xs text-slate-600">主题: {assessment.topic}</div>
      )}
      {mastered && (
        <Link
          to="/insights"
          className="flex items-center gap-2 rounded-lg border border-green-200 bg-white/70 px-3 py-2 text-xs text-green-800 hover:bg-white"
        >
          <span>✓</span>
          <span className="flex-1">
            已记入你的「<b>{manualSubject}</b>」知识图谱 ·{' '}
            <span className="text-green-700">{manualKp}</span>
          </span>
          <span className="text-green-600">去看 →</span>
        </Link>
      )}
      {assessment.weak_points?.length > 0 && (
        <div>
          <div className="mb-1 text-xs font-medium text-slate-500">还可以再想想</div>
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {assessment.weak_points.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        <button
          onClick={onRestart}
          className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          再来一次
        </button>
        <Link
          to={backPath}
          className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
        >
          回到来源页
        </Link>
        <Link
          to="/feynman-history"
          className="rounded-full bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
        >
          完成
        </Link>
      </div>
    </div>
  )
}
