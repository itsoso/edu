import { useEffect, useMemo, useState } from 'react'
import { useIsDesktop } from '../hooks/useMediaQuery'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api, type Exam, type ExamInsightSubject, type LatestExamInsight } from '../api'

const SUBJECTS = [
  { key: '科学', color: '#10b981', full: 150 },
  { key: '英语', color: '#3b82f6', full: 120 },
  { key: '数学', color: '#ef4444', full: 120 },
  { key: '语文', color: '#f59e0b', full: 120 },
  { key: '社会', color: '#8b5cf6', full: 100 },
]

type AddForm = {
  exam_name: string
  exam_date: string
  stage: string
  notes: string
  scores: Record<string, string>
  scoreRanks: Record<string, string>
}

function makeEmptyForm(): AddForm {
  return {
    exam_name: '',
    exam_date: '',
    stage: '初二下',
    notes: '',
    scores: Object.fromEntries(SUBJECTS.map((s) => [s.key, ''])),
    scoreRanks: Object.fromEntries(SUBJECTS.map((s) => [s.key, ''])),
  }
}

export default function Trends() {
  const isDesktop = useIsDesktop()
  const [exams, setExams] = useState<Exam[]>([])
  const [insight, setInsight] = useState<LatestExamInsight | null>(null)
  const [insightError, setInsightError] = useState<string | null>(null)
  const [tab, setTab] = useState<'subjects' | 'total' | 'rank'>('subjects')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddForm>(() => makeEmptyForm())
  const [grade_rank, setGradeRank] = useState('')
  const [examFeeling, setExamFeeling] = useState('')

  async function reload() {
    const d = await api.listExams()
    setExams(d)
    try {
      const latest = await api.latestExamInsight()
      setInsight(latest.exists ? latest : null)
      setInsightError(null)
    } catch {
      setInsight(null)
      setInsightError('考试复盘加载失败')
    }
  }
  useEffect(() => {
    reload()
  }, [])

  const chartData = useMemo(
    () =>
      exams.map((e, idx) => {
        const row: any = {
          // 完整标签 (用于 tooltip/desktop), 短标签 (用于手机 X 轴)
          name: `${e.stage || ''}${e.exam_name}`,
          shortName: isDesktop ? `${e.stage || ''}${e.exam_name}` : `#${idx + 1}`,
          total: e.total,
          rank: e.grade_rank,
        }
        SUBJECTS.forEach((s) => {
          row[s.key] = e.scores[s.key] ?? null
          row[`${s.key}_pct`] = e.scores[s.key] != null ? (e.scores[s.key] / s.full) * 100 : null
        })
        return row
      }),
    [exams, isDesktop]
  )

  async function submit() {
    const scores: Record<string, number> = {}
    const score_ranks: Record<string, number> = {}
    Object.entries(form.scores).forEach(([k, v]) => {
      const n = parseFloat(v)
      if (!isNaN(n)) scores[k] = n
    })
    Object.entries(form.scoreRanks).forEach(([k, v]) => {
      const n = parseInt(v, 10)
      if (!isNaN(n)) score_ranks[k] = n
    })
    const created = await api.createExam({
      exam_name: form.exam_name || '新考试',
      exam_date: form.exam_date || null,
      stage: form.stage,
      notes: form.notes || null,
      grade_rank: grade_rank ? parseInt(grade_rank) : null,
      scores,
      score_ranks,
    })
    // 如果她写了考完感受, 顺便存一条 reflection (永远不喂给 AI)
    if (examFeeling.trim()) {
      try {
        await api.upsertReflection({
          kind: 'exam_feeling',
          related_id: created.id,
          content: examFeeling.trim(),
        })
      } catch {
        // 存感受失败不影响成绩录入
      }
    }
    setForm(makeEmptyForm())
    setGradeRank('')
    setExamFeeling('')
    setShowAdd(false)
    reload()
  }

  async function remove(id: number) {
    if (!confirm('确定删除这次考试？')) return
    await api.deleteExam(id)
    reload()
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">成绩趋势</h1>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
        >
          {showAdd ? '取消' : '+ 录入新成绩'}
        </button>
      </div>

      {showAdd && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <input
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="考试名称(如: 5月月考)"
              value={form.exam_name}
              onChange={(e) => setForm({ ...form, exam_name: e.target.value })}
            />
            <input
              type="date"
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              value={form.exam_date}
              onChange={(e) => setForm({ ...form, exam_date: e.target.value })}
            />
            <select
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              value={form.stage}
              onChange={(e) => setForm({ ...form, stage: e.target.value })}
            >
              <option>初二下</option>
              <option>初二上</option>
              <option>初一下</option>
              <option>初一上</option>
              <option>初三上</option>
              <option>初三下</option>
            </select>
            <input
              type="number"
              className="border border-slate-300 rounded px-3 py-2 text-sm"
              placeholder="年级排名"
              value={grade_rank}
              onChange={(e) => setGradeRank(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {SUBJECTS.map((s) => (
              <div key={s.key}>
                <label className="text-xs text-slate-500">
                  {s.key} (满分 {s.full})
                </label>
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                  <input
                    type="number"
                    step="0.1"
                    aria-label={`${s.key}分数`}
                    placeholder="分数"
                    className="w-full min-w-0 border border-slate-300 rounded px-3 py-2 text-sm"
                    value={form.scores[s.key]}
                    onChange={(e) => setForm({ ...form, scores: { ...form.scores, [s.key]: e.target.value } })}
                  />
                  <input
                    type="number"
                    aria-label={`${s.key}单科排名`}
                    placeholder="排名"
                    className="w-full min-w-0 border border-slate-300 rounded px-2 py-2 text-sm"
                    value={form.scoreRanks[s.key]}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scoreRanks: { ...form.scoreRanks, [s.key]: e.target.value },
                      })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder="备注(可选)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          {/* 考完感受 — 写给自己看, 不会喂给 AI */}
          <div>
            <label className="text-xs text-slate-500 block mb-1">
              这次考完的感受 (可选) · 只给你自己看
            </label>
            <textarea
              className="w-full border border-slate-300 rounded px-3 py-2 text-sm resize-none"
              placeholder="考试当时的心情, 哪里紧张, 哪里满意, 写两句..."
              rows={2}
              maxLength={500}
              value={examFeeling}
              onChange={(e) => setExamFeeling(e.target.value)}
            />
          </div>
          <button
            onClick={submit}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
          >
            保存
          </button>
        </div>
      )}

      {insight && <LatestExamInsightCard insight={insight} />}
      {insightError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {insightError}
        </div>
      )}

      <div className="bg-white rounded-lg border border-slate-200 p-5">
        <div className="flex gap-2 mb-4">
          {[
            { k: 'subjects', label: '各科得分率' },
            { k: 'total', label: '总分走势' },
            { k: 'rank', label: '年级排名' },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as any)}
              className={`px-3 py-1.5 text-sm rounded ${
                tab === t.k ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div style={{ width: '100%', height: isDesktop ? 380 : 320 }}>
          <ResponsiveContainer>
            <LineChart
              data={chartData}
              margin={{
                top: 10,
                right: isDesktop ? 20 : 8,
                left: isDesktop ? 0 : -20,
                bottom: isDesktop ? 60 : 8,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis
                dataKey="shortName"
                angle={isDesktop ? -30 : 0}
                textAnchor={isDesktop ? 'end' : 'middle'}
                height={isDesktop ? 80 : 24}
                interval={isDesktop ? 0 : 'preserveEnd'}
                fontSize={isDesktop ? 11 : 9}
              />
              <YAxis
                fontSize={isDesktop ? 11 : 9}
                width={isDesktop ? 50 : 32}
                domain={
                  tab === 'rank'
                    ? ['auto', 'auto']
                    : tab === 'total'
                    ? [400, 620]
                    : [60, 100]
                }
                reversed={tab === 'rank'}
                label={
                  isDesktop
                    ? {
                        value: tab === 'rank' ? '名次' : tab === 'total' ? '总分' : '得分率 %',
                        angle: -90,
                        position: 'insideLeft',
                      }
                    : undefined
                }
              />
              <Tooltip
                labelFormatter={(shortName: any, payload: any) => {
                  // 移动端显示 #N, tooltip 里显示完整名字
                  const row = payload?.[0]?.payload
                  return row?.name || shortName
                }}
              />
              <Legend wrapperStyle={{ fontSize: isDesktop ? 12 : 10 }} />
              {tab === 'subjects' &&
                SUBJECTS.map((s) => (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={`${s.key}_pct`}
                    name={s.key}
                    stroke={s.color}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    connectNulls
                  />
                ))}
              {tab === 'total' && (
                <Line type="monotone" dataKey="total" name="总分" stroke="#2563eb" strokeWidth={3} dot={{ r: 4 }} />
              )}
              {tab === 'rank' && (
                <Line type="monotone" dataKey="rank" name="年排" stroke="#dc2626" strokeWidth={3} dot={{ r: 4 }} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 成绩列表 */}
      <div className="bg-white rounded-lg border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2 text-left">阶段</th>
              <th className="px-3 py-2 text-left">考试</th>
              <th className="px-3 py-2">总分</th>
              <th className="px-3 py-2">年排</th>
              {SUBJECTS.map((s) => (
                <th key={s.key} className="px-3 py-2">
                  {s.key}
                </th>
              ))}
              <th className="px-3 py-2">备注</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {exams.map((e) => (
              <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 text-slate-500">{e.stage}</td>
                <td className="px-3 py-2 font-medium">{e.exam_name}</td>
                <td className="px-3 py-2 text-center font-semibold">{e.total?.toFixed(1)}</td>
                <td className="px-3 py-2 text-center">{e.grade_rank ?? '-'}</td>
                {SUBJECTS.map((s) => (
                  <td key={s.key} className="px-3 py-2 text-center">
                    <div className="font-medium text-slate-800">{e.scores[s.key] ?? '-'}</div>
                    {e.score_ranks?.[s.key] != null && (
                      <div className="mt-0.5 text-[11px] text-slate-400">
                        第 {e.score_ranks[s.key]} 名
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2 text-xs text-slate-500">{e.notes}</td>
                <td className="px-3 py-2">
                  <button
                    onClick={() => remove(e.id)}
                    className="text-red-500 hover:text-red-700 text-xs"
                  >
                    删
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function LatestExamInsightCard({ insight }: { insight: LatestExamInsight }) {
  const latest = insight.latest_exam
  const focus = insight.focus_subjects || []
  const strengths = insight.strengths || []
  const primary = focus[0]

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
            最新考试复盘
          </div>
          <h2 className="mt-2 text-xl font-semibold text-slate-900">
            {latest?.exam_name || '最新考试'}复盘
          </h2>
          {insight.summary && (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              {insight.summary}
            </p>
          )}

          {primary && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-base font-semibold text-rose-900">
                  先修复：{primary.subject}
                </div>
                {primary.subject_rank != null && (
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-rose-700 ring-1 ring-rose-200">
                    单科排名 {primary.subject_rank}
                  </span>
                )}
                {primary.delta_from_previous != null && (
                  <span className="rounded-full bg-white px-2.5 py-1 text-xs font-medium text-slate-600 ring-1 ring-slate-200">
                    较上次 {formatSigned(primary.delta_from_previous)} 分
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm leading-6 text-rose-900">
                {primary.recommendation}
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3">
          {focus.length > 1 && (
            <div>
              <div className="text-xs font-medium text-slate-500">后续修复队列</div>
              <div className="mt-2 space-y-2">
                {focus.slice(1, 4).map((item) => (
                  <InsightSubjectRow key={item.subject} item={item} />
                ))}
              </div>
            </div>
          )}
          {strengths.length > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
              <div className="text-xs font-medium text-emerald-800">保持优势</div>
              <div className="mt-1 text-sm text-emerald-900">
                {strengths.map((s) => s.subject).join('、')}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function InsightSubjectRow({ item }: { item: ExamInsightSubject }) {
  const subjectMeta = SUBJECTS.find((s) => s.key === item.subject)
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: subjectMeta?.color || '#64748b' }}
          />
          <span className="font-medium text-slate-900">{item.subject}</span>
        </div>
        <div className="mt-1 truncate text-xs text-slate-500">{item.recommendation}</div>
      </div>
      <div className="shrink-0 text-right text-xs text-slate-500">
        <div>{formatScore(item.latest_score)} / {formatScore(item.full_mark)}</div>
        {item.subject_rank != null && <div>第 {item.subject_rank} 名</div>}
      </div>
    </div>
  )
}

function formatScore(v: number | null | undefined) {
  if (v == null) return '-'
  return Number.isInteger(v) ? String(v) : v.toFixed(1)
}

function formatSigned(v: number) {
  return v > 0 ? `+${formatScore(v)}` : formatScore(v)
}
