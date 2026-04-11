import { useEffect, useState } from 'react'
import { api, PracticeSet, PracticeItem } from '../api'
import { usePolling } from '../hooks/usePolling'
import EmptyState from '../components/EmptyState'

export default function Practice() {
  const [sets, setSets] = useState<PracticeSet[]>([])
  const [active, setActive] = useState<PracticeSet | null>(null)
  const [err, setErr] = useState('')

  async function reload() {
    try {
      const data = await api.listPracticeSets()
      setSets(data)
      if (active) {
        const u = data.find((x) => x.id === active.id)
        if (u) setActive(u)
      } else if (data.length > 0) {
        // 如果还没选中任何题集, 默认选第一个 (最新的)
        setActive(data[0])
      }
    } catch (e: any) {
      setErr(e.message || String(e))
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
                const done = s.items.filter((i) => i.is_correct !== null).length
                const correct = s.items.filter((i) => i.is_correct === 1).length
                const gen = s.status === 'generating'
                const failed = s.status === 'failed'
                return (
                  <li key={s.id}>
                    <button
                      onClick={() => setActive(s)}
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
                          : `${s.items.length} 题 · 已做 ${done} · 对 ${correct}`}
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
                <button
                  onClick={() => remove(active.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  删除
                </button>
              </div>

              {active.status === 'generating' && (
                <div className="bg-brand-50 border border-brand-200 rounded-lg p-6 text-center">
                  <div className="text-3xl mb-2 animate-pulse">⏳</div>
                  <div className="font-medium text-brand-700">AI 正在基于你的错题出题...</div>
                  <div className="text-xs text-slate-500 mt-1">
                    大约 15-25 秒. 你可以切到其他页面, 稍后回来看
                  </div>
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

              {active.status !== 'generating' &&
                active.items.map((it, idx) => (
                  <ItemCard
                    key={it.id}
                    index={idx}
                    item={it}
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
                      // 同步侧栏的 done/correct 计数 (轻量刷一次 list)
                      api.listPracticeSets().then(setSets).catch(() => {})
                    }}
                  />
                ))}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function ItemCard({
  index, item, onGraded,
}: { index: number; item: PracticeItem; onGraded: (updated: PracticeItem) => void }) {
  const [answer, setAnswer] = useState(item.student_answer || '')
  const [showSolution, setShowSolution] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const done = item.is_correct !== null

  async function submit() {
    if (!answer.trim()) {
      setErr('请输入你的作答')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const updated = await api.gradePracticeItem(item.id, answer.trim())
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
      <div className="text-sm leading-relaxed whitespace-pre-wrap">{item.question_text}</div>

      <textarea
        value={answer}
        onChange={(e) => setAnswer(e.target.value)}
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
            onClick={() => setShowSolution((v) => !v)}
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
          <summary className="cursor-pointer text-slate-500">参考思路</summary>
          <div className="mt-2 text-slate-700 whitespace-pre-wrap">{item.solution_steps}</div>
          {item.expected_answer && (
            <div className="mt-1 text-xs text-slate-600">
              标准答案: <span className="font-mono">{item.expected_answer}</span>
            </div>
          )}
        </details>
      )}
    </div>
  )
}
