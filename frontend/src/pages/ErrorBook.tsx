import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, Mistake } from '../api'
import { useToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import ReflectionField from '../components/ReflectionField'
import MathText from '../components/MathText'

const SUBJECTS = ['数学', '科学', '英语', '语文', '社会']
const REASONS = ['计算错', '审题漏', '不会做', '步骤乱', '知识遗忘', '其他']

type Form = {
  subject: string
  exam_name: string
  question_text: string
  wrong_answer: string
  correct_answer: string
  reason: string
  knowledge_point: string
}

const empty: Form = {
  subject: '数学',
  exam_name: '',
  question_text: '',
  wrong_answer: '',
  correct_answer: '',
  reason: '计算错',
  knowledge_point: '',
}

const PAGE_SIZE = 50

export default function ErrorBook() {
  const nav = useNavigate()
  const toast = useToast()
  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const [stats, setStats] = useState<{ by_reason: any[]; by_subject: any[] }>({ by_reason: [], by_subject: [] })
  const [filterSubject, setFilterSubject] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<'' | '0' | '1'>('')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Form>({ ...empty })
  const [generatingId, setGeneratingId] = useState<number | null>(null)

  async function reload() {
    const [pageResult, st] = await Promise.all([
      api.listMistakesPaged({
        subject: filterSubject || undefined,
        mastered: filterStatus === '' ? undefined : (Number(filterStatus) as 0 | 1),
        limit: PAGE_SIZE,
        offset: 0,
      }),
      api.mistakeStats(),
    ])
    setMistakes(pageResult.items)
    setTotal(pageResult.total)
    setStats(st)
  }

  async function loadMore() {
    setLoadingMore(true)
    try {
      const result = await api.listMistakesPaged({
        subject: filterSubject || undefined,
        mastered: filterStatus === '' ? undefined : (Number(filterStatus) as 0 | 1),
        limit: PAGE_SIZE,
        offset: mistakes.length,
      })
      setMistakes((prev) => [...prev, ...result.items])
      setTotal(result.total)
    } finally {
      setLoadingMore(false)
    }
  }

  useEffect(() => {
    reload()
  }, [filterSubject, filterStatus])

  const totalReason = stats.by_reason.reduce((s, r) => s + r.n, 0)

  async function submit() {
    if (!form.question_text && !form.knowledge_point) {
      alert('题目或知识点至少填一个')
      return
    }
    await api.createMistake(form)
    setForm({ ...empty })
    setShowAdd(false)
    reload()
  }

  async function toggleMastered(m: Mistake) {
    await api.updateMistake(m.id, { mastered: m.mastered ? 0 : 1 })
    reload()
  }

  async function remove(id: number) {
    if (!confirm('删除？')) return
    await api.deleteMistake(id)
    reload()
  }

  async function generatePractice(id: number) {
    setGeneratingId(id)
    try {
      await api.generatePractice(id, 3)
      toast.info('AI 正在出题, 约 15-25 秒')
      nav('/practice')
    } catch (e: any) {
      toast.error('生成失败: ' + (e.message || e))
    } finally {
      setGeneratingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">错题本</h1>
          <p className="text-slate-500 mt-1 text-sm">记录 → 归因 → 重做 → 标记掌握</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/scan"
            className="px-4 py-2 bg-purple-600 text-white rounded hover:bg-purple-700 text-sm"
          >
            📸 扫描试卷
          </Link>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 text-sm"
          >
            {showAdd ? '取消' : '+ 手动添加'}
          </button>
        </div>
      </div>

      {/* 统计 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="font-semibold mb-3">失分归因分布</div>
          {stats.by_reason.length === 0 ? (
            <p className="text-sm text-slate-400">暂无数据</p>
          ) : (
            <ul className="space-y-2">
              {stats.by_reason.map((r) => {
                const pct = totalReason ? (r.n / totalReason) * 100 : 0
                return (
                  <li key={r.reason}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-medium">{r.reason}</span>
                      <span className="text-slate-500">
                        {r.n} · {pct.toFixed(0)}%
                      </span>
                    </div>
                    <div className="bg-slate-100 h-2 rounded">
                      <div className="bg-brand-600 h-2 rounded" style={{ width: `${pct}%` }} />
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="font-semibold mb-3">各科错题数</div>
          {stats.by_subject.length === 0 ? (
            <p className="text-sm text-slate-400">暂无数据</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {stats.by_subject.map((s) => (
                <li key={s.subject} className="flex justify-between">
                  <span>{s.subject}</span>
                  <span className="text-slate-500">
                    {s.n} 道 · 已掌握 {s.mastered_n}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 添加表单 */}
      {showAdd && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <select
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            >
              {SUBJECTS.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <select
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
            >
              {REASONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
            <input
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="来源(如: 5月月考)"
              value={form.exam_name}
              onChange={(e) => setForm({ ...form, exam_name: e.target.value })}
            />
          </div>
          <textarea
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            rows={2}
            placeholder="题目描述 / 简述"
            value={form.question_text}
            onChange={(e) => setForm({ ...form, question_text: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-3">
            <input
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="我的错答"
              value={form.wrong_answer}
              onChange={(e) => setForm({ ...form, wrong_answer: e.target.value })}
            />
            <input
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="正确答案"
              value={form.correct_answer}
              onChange={(e) => setForm({ ...form, correct_answer: e.target.value })}
            />
          </div>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder="涉及知识点"
            value={form.knowledge_point}
            onChange={(e) => setForm({ ...form, knowledge_point: e.target.value })}
          />
          <button
            onClick={submit}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
          >
            保存
          </button>
        </div>
      )}

      {/* 过滤 */}
      <div className="flex gap-2 items-center text-sm">
        <span className="text-slate-500">过滤:</span>
        <select
          className="border border-slate-300 rounded px-2 py-1"
          value={filterSubject}
          onChange={(e) => setFilterSubject(e.target.value)}
        >
          <option value="">全部科目</option>
          {SUBJECTS.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="border border-slate-300 rounded px-2 py-1"
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as any)}
        >
          <option value="">全部状态</option>
          <option value="0">未掌握</option>
          <option value="1">已掌握</option>
        </select>
      </div>

      {/* 列表 */}
      <div className="space-y-3">
        {total > 0 && (
          <div className="text-xs text-slate-500">
            共 {total} 道错题 · 当前显示 {mistakes.length}
          </div>
        )}
        {mistakes.length === 0 ? (
          <EmptyState
            icon="📓"
            title="还没有错题记录"
            description={
              <>
                从扫描试卷开始, 或者手动添加一道. 每道错题都是一次
                <b className="text-slate-700">学会某件事的机会</b>。
              </>
            }
            ctaLabel="📸 扫描试卷"
            ctaTo="/scan"
          />
        ) : (
          mistakes.map((m) => (
            <div
              key={m.id}
              className={`bg-white border rounded-lg p-4 ${
                m.mastered ? 'border-green-200 bg-green-50' : 'border-slate-200'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="text-xs px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded">
                      {m.subject}
                    </span>
                    <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded">
                      {m.reason}
                    </span>
                    {m.exam_name && <span className="text-xs text-slate-500">来自: {m.exam_name}</span>}
                    {m.mastered ? (
                      <span className="text-xs text-green-600">✓ 已掌握</span>
                    ) : null}
                  </div>
                  {m.question_text && (
                    <p className="text-sm mb-1">
                      <MathText text={m.question_text} />
                    </p>
                  )}
                  {m.knowledge_point && (
                    <p className="text-xs text-slate-500">知识点: {m.knowledge_point}</p>
                  )}
                  {(m.wrong_answer || m.correct_answer) && (
                    <div className="text-xs text-slate-600 mt-2 space-y-0.5">
                      {m.wrong_answer && (
                        <div>
                          错: <span className="text-red-500"><MathText text={m.wrong_answer} /></span>
                        </div>
                      )}
                      {m.correct_answer && (
                        <AnswerReveal label="对" answer={m.correct_answer} />
                      )}
                    </div>
                  )}
                  {/* 她说 — 永远不喂给 AI */}
                  <ReflectionField
                    kind="mistake_note"
                    relatedId={m.id}
                    label="我的想法"
                    placeholder="你当时为什么会错? 以后怎么避免? 写给自己看."
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <button
                    onClick={() => generatePractice(m.id)}
                    disabled={generatingId === m.id}
                    className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {generatingId === m.id ? '出题中...' : '🏋️ 生成类题'}
                  </button>
                  <button
                    onClick={() => toggleMastered(m)}
                    className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50 whitespace-nowrap"
                  >
                    {m.mastered ? '标记未掌握' : '标记掌握'}
                  </button>
                  <button
                    onClick={() => remove(m.id)}
                    className="text-xs text-red-500 hover:text-red-700"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
        {mistakes.length < total && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="w-full py-2 border border-slate-200 rounded text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore ? '加载中...' : `加载更多 (还有 ${total - mistakes.length} 道)`}
          </button>
        )}
      </div>
    </div>
  )
}

/** 答案默认隐藏, 点击才显示. 设计理由: 让她先自己想, 再看答案 — 预测错误是学习的原料. */
function AnswerReveal({ label, answer }: { label: string; answer: string }) {
  const [revealed, setRevealed] = useState(false)
  return (
    <div className="flex items-center gap-1">
      <span>{label}:</span>
      {revealed ? (
        <span className="text-green-600">
          <MathText text={answer} />
        </span>
      ) : (
        <button
          onClick={() => setRevealed(true)}
          className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded hover:bg-slate-200 text-[11px]"
        >
          点击查看答案
        </button>
      )}
    </div>
  )
}
