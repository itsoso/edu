import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const nd = new Date(y, mo - 2, 1) // mo 是 1-12, -2 → 上个月
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`
}

export default function Reports() {
  const [list, setList] = useState<{ id: number; month: string; created_at: string }[]>([])
  const [active, setActive] = useState<string>(currentMonth())
  const [content, setContent] = useState('')
  const [metrics, setMetrics] = useState<any>(null)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')

  async function refreshList() {
    try {
      const data = await api.listMonthlyReports()
      setList(data)
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  async function loadActive(m: string) {
    setErr('')
    setContent('')
    setMetrics(null)
    try {
      const r = await api.getMonthlyReport(m)
      if (r.exists) {
        setContent(r.content_md || '')
        setMetrics(r.metrics || null)
      }
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  useEffect(() => {
    refreshList()
  }, [])

  useEffect(() => {
    loadActive(active)
  }, [active])

  async function generate(force: boolean) {
    setErr('')
    setBusy(`AI 正在生成 ${active} 复盘报告... (20-40 秒)`)
    try {
      const r = await api.generateMonthlyReport(active, force)
      setContent(r.content_md)
      setMetrics(r.metrics)
      await refreshList()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy('')
    }
  }

  async function remove() {
    if (!confirm(`删除 ${active} 的复盘报告?`)) return
    try {
      await api.deleteMonthlyReport(active)
      setContent('')
      setMetrics(null)
      await refreshList()
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  // 最近 6 个月的快捷切换
  const recentMonths = useMemo(() => {
    const arr: string[] = []
    let m = currentMonth()
    for (let i = 0; i < 6; i++) {
      arr.push(m)
      m = prevMonth(m)
    }
    return arr
  }, [])

  const hasReport = Boolean(content)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">月度复盘</h1>
        <p className="text-slate-500 mt-1 text-sm">
          每月 AI 基于当月考试、错题、打卡、训练自动生成复盘报告
        </p>
      </div>

      {/* 月份选择 */}
      <div className="flex gap-2 flex-wrap">
        {recentMonths.map((m) => {
          const hasData = list.some((r) => r.month === m)
          return (
            <button
              key={m}
              onClick={() => setActive(m)}
              className={`px-3 py-1.5 rounded text-sm border ${
                active === m
                  ? 'bg-brand-600 text-white border-brand-600'
                  : hasData
                  ? 'bg-green-50 text-green-700 border-green-200'
                  : 'bg-white text-slate-600 border-slate-300'
              }`}
            >
              {m} {hasData ? '✓' : ''}
            </button>
          )
        })}
      </div>

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {err}
        </div>
      )}
      {busy && (
        <div className="text-sm text-brand-700 bg-brand-50 border border-brand-200 rounded p-3">
          {busy}
        </div>
      )}

      {!hasReport && !busy && (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
          <div className="text-lg font-medium mb-2">{active} 还没有复盘报告</div>
          <div className="text-sm text-slate-500 mb-4">
            生成后会整合本月考试成绩、错题分布、打卡记录和训练数据，用 AI 写一份有洞察的月度报告
          </div>
          <button
            onClick={() => generate(false)}
            disabled={!!busy}
            className="px-5 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            🧠 生成 {active} 复盘
          </button>
        </div>
      )}

      {hasReport && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <button
              onClick={() => generate(true)}
              disabled={!!busy}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
            >
              🔄 重新生成
            </button>
            <button
              onClick={remove}
              className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded hover:bg-red-50"
            >
              删除
            </button>
          </div>

          {metrics && <MetricsBar metrics={metrics} />}

          <div className="bg-white border border-slate-200 rounded-lg p-6 md:p-8 md-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricsBar({ metrics }: { metrics: any }) {
  const items: { label: string; value: string | number; color: string }[] = [
    { label: '本月考试', value: metrics.exams?.length || 0, color: 'blue' },
    { label: '新增错题', value: metrics.mistakes_count || 0, color: 'red' },
    { label: '打卡天数', value: metrics.distinct_checkin_days || 0, color: 'green' },
    { label: '训练题数', value: metrics.practice_item_count || 0, color: 'purple' },
  ]
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {items.map((it) => (
        <div
          key={it.label}
          className="bg-white border border-slate-200 rounded-lg p-3"
        >
          <div className="text-xs text-slate-500">{it.label}</div>
          <div className="text-2xl font-bold mt-1">{it.value}</div>
        </div>
      ))}
    </div>
  )
}
