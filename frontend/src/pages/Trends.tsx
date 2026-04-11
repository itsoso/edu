import { useEffect, useMemo, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api, Exam } from '../api'

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
}

const emptyForm: AddForm = {
  exam_name: '',
  exam_date: '',
  stage: '初二下',
  notes: '',
  scores: Object.fromEntries(SUBJECTS.map((s) => [s.key, ''])),
}

export default function Trends() {
  const [exams, setExams] = useState<Exam[]>([])
  const [tab, setTab] = useState<'subjects' | 'total' | 'rank'>('subjects')
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddForm>({ ...emptyForm })
  const [grade_rank, setGradeRank] = useState('')

  async function reload() {
    const d = await api.listExams()
    setExams(d)
  }
  useEffect(() => {
    reload()
  }, [])

  const chartData = useMemo(
    () =>
      exams.map((e) => {
        const row: any = {
          name: `${e.stage || ''}${e.exam_name}`,
          total: e.total,
          rank: e.grade_rank,
        }
        SUBJECTS.forEach((s) => {
          row[s.key] = e.scores[s.key] ?? null
          // 换算得分率百分比方便同图对比
          row[`${s.key}_pct`] = e.scores[s.key] != null ? (e.scores[s.key] / s.full) * 100 : null
        })
        return row
      }),
    [exams]
  )

  async function submit() {
    const scores: Record<string, number> = {}
    Object.entries(form.scores).forEach(([k, v]) => {
      const n = parseFloat(v)
      if (!isNaN(n)) scores[k] = n
    })
    await api.createExam({
      exam_name: form.exam_name || '新考试',
      exam_date: form.exam_date || null,
      stage: form.stage,
      notes: form.notes || null,
      grade_rank: grade_rank ? parseInt(grade_rank) : null,
      scores,
    })
    setForm({ ...emptyForm, scores: { ...emptyForm.scores } })
    setGradeRank('')
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
                <input
                  type="number"
                  step="0.1"
                  className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
                  value={form.scores[s.key]}
                  onChange={(e) => setForm({ ...form, scores: { ...form.scores, [s.key]: e.target.value } })}
                />
              </div>
            ))}
          </div>
          <input
            className="w-full border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder="备注(可选)"
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
          <button
            onClick={submit}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
          >
            保存
          </button>
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
        <div style={{ width: '100%', height: 380 }}>
          <ResponsiveContainer>
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="name" angle={-30} textAnchor="end" height={80} fontSize={11} />
              <YAxis
                fontSize={11}
                domain={
                  tab === 'rank'
                    ? ['auto', 'auto']
                    : tab === 'total'
                    ? [400, 620]
                    : [60, 100]
                }
                reversed={tab === 'rank'}
                label={{
                  value: tab === 'rank' ? '名次' : tab === 'total' ? '总分' : '得分率 %',
                  angle: -90,
                  position: 'insideLeft',
                }}
              />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
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
                    {e.scores[s.key] ?? '-'}
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
