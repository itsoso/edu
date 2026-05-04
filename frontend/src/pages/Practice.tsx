import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, PracticeSet, PracticeItem } from '../api'
import signals from '../lib/signals'
import { usePolling } from '../hooks/usePolling'
import EmptyState from '../components/EmptyState'
import MathText from '../components/MathText'
import SolutionSteps from '../components/SolutionSteps'
import PrintPanel, { type PrintPanelOptions } from '../components/PrintPanel'
import ReflectionPrompt from '../components/ReflectionPrompt'
import { buildPrintablePayload, openPrintWindow } from '../print/printable'

export default function Practice() {
  const [sets, setSets] = useState<PracticeSet[]>([])
  const [active, setActive] = useState<PracticeSet | null>(null)
  const [err, setErr] = useState('')
  const [detailLoading, setDetailLoading] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())
  const [printOpen, setPrintOpen] = useState(false)
  const [printing, setPrinting] = useState(false)

  async function reload() {
    try {
      const data = await api.listPracticeSets()
      setSets(data)
      if (active && !data.find((x) => x.id === active.id)) {
        setActive(null)
      } else if (active) {
        const summary = data.find((x) => x.id === active.id)
        if (summary) {
          setActive((prev) => (prev ? { ...prev, ...summary } : prev))
        }
      } else if (data.length > 0) {
        // 首屏先渲染列表, 详情异步加载, 避免页面被一整套题目阻塞。
        void openSet(data[0].id, data[0])
      }
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  async function openSet(id: number, summary?: PracticeSet) {
    const base = summary || sets.find((set) => set.id === id)
    if (base) {
      setActive((prev) => (prev?.id === id ? { ...prev, ...base } : { ...base, items: [] }))
    }
    setDetailLoading(true)
    try {
      const detail = await api.getPracticeSet(id)
      setActive(detail)
      setSelectedItemIds(new Set())
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // 当 active set 正在生成中时轮询
  const isGenerating = active?.status === 'generating'
  usePolling(
    async () => {
      if (!active) return null
      const s = await api.getPracticeSet(active.id)
      setActive(s)
      // 完成后刷一下 list 让侧栏也更新
      if (s.status !== 'generating') {
        api.listPracticeSets().then(setSets).catch(() => {})
      }
      return s
    },
    (s: any) => !!s && s.status === 'generating',
    { interval: 2500, enabled: !!active && isGenerating }
  )

  async function remove(id: number) {
    if (!confirm('删除这份训练题？已作答的记录将一并删除')) return
    await api.deletePracticeSet(id)
    if (active?.id === id) setActive(null)
    reload()
  }

  function toggleSelected(id: number) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handlePrint(options: PrintPanelOptions) {
    if (!active) return
    const chosenItems =
      options.scope === 'selected'
        ? active.items.filter((item) => selectedItemIds.has(item.id))
        : active.items
    if (chosenItems.length === 0) {
      setErr('请先勾选要打印的训练题')
      return
    }

    setPrinting(true)
    try {
      const payload = buildPrintablePayload({
        title: active.title,
        mode: options.mode,
        includeSolutions: options.includeSolutions,
        mistakes: [],
        practiceSets: [{ ...active, items: chosenItems }],
      })
      openPrintWindow(payload)
      setPrintOpen(false)
    } finally {
      setPrinting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">二次训练</h1>
        <p className="text-slate-500 mt-1 text-sm">
          在错题本页面点"生成类题"即可创建训练。巩固后系统自动批改。
        </p>
      </div>

      {err && <div className="text-sm text-red-600">{err}</div>}

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <aside className="md:col-span-2 bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-500 px-1 pb-2">训练题集</div>
          {sets.length === 0 ? (
            <EmptyState
              variant="inline"
              icon="🏋️"
              title="还没有训练题"
              description="去错题本, 点任意一道错题的'生成类题'"
              ctaLabel="前往错题本"
              ctaTo="/mistakes"
            />
          ) : (
            <ul className="space-y-1">
              {sets.map((s) => {
                const gen = s.status === 'generating'
                const failed = s.status === 'failed'
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => openSet(s.id)}
                      className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-slate-50 ${
                        active?.id === s.id ? 'bg-brand-50 border border-brand-200' : ''
                      }`}
                    >
                      <div className="font-medium truncate flex items-center gap-1">
                        {gen && <span className="animate-pulse">⏳</span>}
                        {failed && <span>⚠️</span>}
                        <span className="truncate">{s.title}</span>
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {gen
                          ? 'AI 出题中...'
                          : failed
                          ? '生成失败'
                          : `${s.item_count ?? 0} 题 · 已做 ${s.graded_count ?? 0} · 对 ${s.correct_count ?? 0}`}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </aside>

        <section className="md:col-span-3 space-y-4">
          {!active ? (
            <EmptyState
              icon="👈"
              title="选一份训练题集开始"
              description="左边列表里点任意一项"
            />
          ) : (
            <>
              <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between">
                <div>
                  <div className="font-semibold">{active.title}</div>
                  <div className="text-xs text-slate-500">
                    {active.subject} · {active.knowledge_point}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPrintOpen(true)}
                    className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600"
                  >
                    🖨️ 打印
                  </button>
                  <button
                    onClick={() => remove(active.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
              </div>
              {active.status !== 'generating' && !detailLoading && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  <button
                    onClick={() => setSelectedItemIds(new Set(active.items.map((item) => item.id)))}
                    className="text-brand-600"
                  >
                    全选当前题集
                  </button>
                  <button onClick={() => setSelectedItemIds(new Set())}>清空勾选</button>
                  <span>已勾选 {selectedItemIds.size} 题</span>
                </div>
              )}

              {active.status === 'generating' && (
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-6 text-center">
                  <div className="text-3xl mb-2 animate-pulse">⏳</div>
                  <div className="font-medium text-brand-700">AI 正在基于你的错题出题...</div>
                  <div className="text-xs text-slate-500 mt-1">
                    大约 15-25 秒. 你可以切到其他页面, 稍后回来看
                  </div>
                </div>
              )}

              {detailLoading && (
                <div className="bg-white border border-slate-200 rounded-lg p-6 text-sm text-slate-500">
                  正在加载这套训练题...
                </div>
              )}

              {active.status === 'failed' && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
                  生成失败: {active.error_message || '未知原因'}
                  <div className="mt-2 text-xs text-slate-500">
                    请回到错题本重新点"生成类题"
                  </div>
                </div>
              )}

              {!detailLoading &&
                active.status !== 'generating' &&
                active.items.map((it, idx) => (
                  <ItemCard
                    key={it.id}
                    index={idx}
                    item={it}
                    subject={active.subject}
                    selected={selectedItemIds.has(it.id)}
                    onToggleSelected={() => toggleSelected(it.id)}
                    onGraded={(updated) => {
                      // 局部更新: 只替换这一条 item, 不重拉全集
                      setActive((prev) =>
                        prev
                          ? {
                              ...prev,
                              items: prev.items.map((x) =>
                                x.id === updated.id ? updated : x
                              ),
                            }
                          : prev
                      )
                      // 同步侧栏摘要计数
                      api.listPracticeSets().then(setSets).catch(() => {})
                    }}
                  />
                ))}
              {printOpen && active && (
                <PrintPanel
                  title="打印训练题"
                  selectedCount={selectedItemIds.size}
                  totalCount={active.items.length}
                  busy={printing}
                  onClose={() => setPrintOpen(false)}
                  onConfirm={handlePrint}
                />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function ItemCard({
  index, item, selected, onToggleSelected, onGraded, subject,
}: {
  index: number
  item: PracticeItem
  selected: boolean
  onToggleSelected: () => void
  onGraded: (updated: PracticeItem) => void
  subject?: string | null
}) {
  const [answer, setAnswer] = useState(item.student_answer || '')
  const [showSolution, setShowSolution] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const done = item.is_correct !== null

  const startedAtRef = useRef<number>(Date.now())
  const lastInputAtRef = useRef<number>(Date.now())
  const pauseCountRef = useRef<number>(0)
  const pauseTimerRef = useRef<number | null>(null)
  const hintUsedRef = useRef<boolean>(false)
  const startedRef = useRef<boolean>(false)
  const submittedRef = useRef<boolean>(done)

  // 进入卡片 → start (只触发一次)
  useEffect(() => {
    if (startedRef.current || done) return
    startedRef.current = true
    startedAtRef.current = Date.now()
    signals.track('practice.item.start', {
      related_table: 'practice_items',
      related_id: item.id,
      payload: {
        subject: subject || undefined,
        difficulty: item.difficulty || undefined,
      },
    })
    // 卡片卸载时若未提交 → skip 事件
    return () => {
      if (pauseTimerRef.current != null) {
        window.clearTimeout(pauseTimerRef.current)
      }
      if (!submittedRef.current && !done) {
        const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000)
        signals.track('practice.item.skip', {
          related_table: 'practice_items',
          related_id: item.id,
          payload: { elapsed_secs: elapsed },
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id])

  function onAnswerChange(v: string) {
    setAnswer(v)
    lastInputAtRef.current = Date.now()
    if (pauseTimerRef.current != null) window.clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = window.setTimeout(() => {
      // 5 秒无输入 = 一次 pause
      const pauseSecs = Math.round((Date.now() - lastInputAtRef.current) / 1000)
      pauseCountRef.current += 1
      signals.track('practice.item.input_pause', {
        related_table: 'practice_items',
        related_id: item.id,
        payload: {
          pause_count_so_far: pauseCountRef.current,
          pause_secs: pauseSecs,
        },
      })
    }, 5000)
  }

  function toggleSolution() {
    const next = !showSolution
    setShowSolution(next)
    if (next && !hintUsedRef.current) {
      hintUsedRef.current = true
      const t = Math.round((Date.now() - startedAtRef.current) / 1000)
      signals.track('practice.item.hint_used', {
        related_table: 'practice_items',
        related_id: item.id,
        payload: { time_before_hint_secs: t },
      })
    }
  }

  async function submit() {
    if (!answer.trim()) {
      setErr('请输入你的作答')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const updated = await api.gradePracticeItem(item.id, answer.trim())
      submittedRef.current = true
      const elapsed = Math.round((Date.now() - startedAtRef.current) / 1000)
      signals.track('practice.item.submit', {
        related_table: 'practice_items',
        related_id: item.id,
        payload: {
          elapsed_secs: elapsed,
          answer_length: answer.trim().length,
          hint_used: hintUsedRef.current,
        },
      })
      onGraded(updated)
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={selected} onChange={onToggleSelected} className="h-4 w-4" />
        <span className="font-bold text-slate-600">第 {index + 1} 题</span>
        {item.difficulty && (
          <span className="px-1.5 py-0.5 bg-slate-100 rounded">
            {item.difficulty === 'easy' ? '简单' : item.difficulty === 'hard' ? '难' : '中等'}
          </span>
        )}
        {done &&
          (item.is_correct ? (
            <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded">
              ✓ 对 · {item.score}
            </span>
          ) : (
            <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
              ✗ 错 · {item.score}
            </span>
          ))}
      </div>
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        <MathText text={item.question_text} />
      </div>

      <textarea
        value={answer}
        onChange={(e) => onAnswerChange(e.target.value)}
        placeholder="在这里写你的作答（可多行）"
        rows={3}
        className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
        disabled={done}
      />
      {err && <div className="text-xs text-red-600">{err}</div>}

      {!done && (
        <div className="flex gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded disabled:opacity-50"
          >
            {busy ? 'AI 批改中...' : '提交作答'}
          </button>
          <button
            onClick={toggleSolution}
            className="px-3 py-1.5 text-sm border border-slate-300 text-slate-600 rounded"
          >
            {showSolution ? '隐藏思路' : '卡住了? 看思路'}
          </button>
        </div>
      )}

      {done && item.feedback && (
        <div className={`text-sm rounded p-3 ${
          item.is_correct ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'
        }`}>
          <div className="font-medium mb-1">点评</div>
          <div className="text-slate-700">{item.feedback}</div>
        </div>
      )}

      {(showSolution || done) && item.solution_steps && (
        <details className="text-sm" open={done}>
          <summary className="cursor-pointer text-purple-600 hover:text-purple-800 font-medium">
            ▶ 参考思路
          </summary>
          <div className="mt-2 bg-slate-50 border border-slate-200 rounded p-3">
            <SolutionSteps steps={item.solution_steps} />
          </div>
          {item.expected_answer && (
            <div className="mt-1 text-xs text-slate-600">
              标准答案: <span className="font-mono">{item.expected_answer}</span>
            </div>
          )}
        </details>
      )}

      {done && item.is_correct ? (
        <div className="pt-1">
          <Link
            to={`/feynman?source_table=practice_items&source_id=${item.id}`}
            className="inline-flex items-center gap-1 rounded-full border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100"
          >
            🎓 教教我?
          </Link>
        </div>
      ) : null}

      {done && !item.is_correct ? (
        <ReflectionPrompt
          sourceTable="practice_items"
          sourceId={item.id}
          storeKind="free_write"
          storeRelatedKey={`pi_${item.id}`}
        />
      ) : null}
    </div>
  )
}
