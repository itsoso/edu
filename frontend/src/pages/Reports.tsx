import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'
import { usePolling } from '../hooks/usePolling'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function prevMonth(m: string): string {
  const [y, mo] = m.split('-').map(Number)
  const nd = new Date(y, mo - 2, 1) // mo 是 1-12, -2 → 上个月
  return `${nd.getFullYear()}-${String(nd.getMonth() + 1).padStart(2, '0')}`
}

type ReportState = {
  exists: boolean
  status?: 'generating' | 'done' | 'failed'
  content_md?: string
  metrics?: any
  error_message?: string | null
}

export default function Reports() {
  const [list, setList] = useState<{ id: number; month: string; created_at: string }[]>([])
  const [active, setActive] = useState<string>(currentMonth())
  const [report, setReport] = useState<ReportState>({ exists: false })
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
    setReport({ exists: false })
    try {
      const r = await api.getMonthlyReport(m)
      setReport({
        exists: r.exists,
        status: r.status,
        content_md: r.content_md || '',
        metrics: r.metrics || null,
        error_message: r.error_message,
      })
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

  // 状态 generating 时自动轮询
  const isGenerating = report.exists && report.status === 'generating'
  usePolling(
    async () => {
      const r = await api.getMonthlyReport(active)
      setReport({
        exists: r.exists,
        status: r.status,
        content_md: r.content_md || '',
        metrics: r.metrics || null,
        error_message: r.error_message,
      })
      if (r.status !== 'generating') {
        refreshList()
      }
      return r
    },
    (r: any) => r?.exists && r?.status === 'generating',
    { interval: 3000, enabled: isGenerating }
  )

  async function generate(force: boolean) {
    setErr('')
    try {
      const r = await api.generateMonthlyReport(active, force)
      setReport({
        exists: true,
        status: r.status || 'done',
        content_md: r.content_md || '',
        metrics: r.metrics || null,
        error_message: r.error_message,
      })
      await refreshList()
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  async function remove() {
    if (!confirm(`删除 ${active} 的复盘报告?`)) return
    try {
      await api.deleteMonthlyReport(active)
      setReport({ exists: false })
      await refreshList()
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  function exportPdf() {
    if (!report.content_md) return
    const html = buildReportPrintHtml(active, report.content_md, report.metrics)
    const win = window.open('', '_blank', 'noopener,noreferrer')
    if (!win) {
      alert('浏览器拦截了打印窗口,请允许弹窗后重试')
      return
    }
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 300)
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

  const hasDoneReport = report.exists && report.status === 'done' && !!report.content_md
  const isFailed = report.status === 'failed'

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

      {isGenerating && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-6 text-center">
          <div className="text-3xl mb-2 animate-pulse">⏳</div>
          <div className="font-medium text-brand-700">
            AI 正在生成 {active} 复盘报告...
          </div>
          <div className="text-xs text-slate-500 mt-1">
            大约 20-40 秒. 你可以切到其他页面, 稍后回来看
          </div>
        </div>
      )}

      {isFailed && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5">
          <div className="font-medium text-red-700 mb-1">生成失败</div>
          <div className="text-sm text-slate-700">{report.error_message || '未知原因'}</div>
          <button
            onClick={() => generate(true)}
            className="mt-3 px-4 py-1.5 text-sm bg-brand-600 text-white rounded"
          >
            🔄 重试
          </button>
        </div>
      )}

      {!report.exists && !isGenerating && !isFailed && (
        <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
          <div className="text-lg font-medium mb-2">{active} 还没有复盘报告</div>
          <div className="text-sm text-slate-500 mb-4">
            生成后会整合本月考试成绩、错题分布、打卡记录和训练数据，用 AI 写一份有洞察的月度报告
          </div>
          <button
            onClick={() => generate(false)}
            className="px-5 py-2 bg-brand-600 text-white rounded hover:bg-brand-700"
          >
            🧠 生成 {active} 复盘
          </button>
        </div>
      )}

      {hasDoneReport && (
        <div className="space-y-4">
          <div className="flex justify-end gap-2">
            <button
              onClick={() => exportPdf()}
              className="px-3 py-1.5 text-sm border border-slate-300 rounded hover:bg-slate-50"
            >
              🖨️ 导出 PDF
            </button>
            <button
              onClick={() => generate(true)}
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

          {report.metrics && <MetricsBar metrics={report.metrics} />}

          <div className="bg-white border border-slate-200 rounded-lg p-6 md:p-8 md-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report.content_md || ''}</ReactMarkdown>
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

/** 把月度报告的 markdown + metrics 渲染为可打印的 A4 HTML.
 *  极简 markdown 解析 (够用就行: # ## ### / 段落 / **bold** / 列表). */
function buildReportPrintHtml(month: string, md: string, metrics: any): string {
  const escape = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const inline = (s: string) =>
    escape(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')

  const lines = md.split('\n')
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (line.startsWith('### ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h3>${inline(line.slice(4))}</h3>`)
    } else if (line.startsWith('## ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h2>${inline(line.slice(3))}</h2>`)
    } else if (line.startsWith('# ')) {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<h1>${inline(line.slice(2))}</h1>`)
    } else if (/^\s*[-*]\s+/.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true }
      out.push(`<li>${inline(line.replace(/^\s*[-*]\s+/, ''))}</li>`)
    } else if (line.trim() === '') {
      if (inList) { out.push('</ul>'); inList = false }
      out.push('<div class="gap"></div>')
    } else {
      if (inList) { out.push('</ul>'); inList = false }
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  if (inList) out.push('</ul>')

  const metricsHtml = metrics
    ? `<section class="metrics">
        ${Object.entries(metrics)
          .map(([k, v]) => {
            if (v == null || typeof v === 'object') return ''
            return `<div class="metric"><div class="ml">${escape(String(k))}</div><div class="mv">${escape(String(v))}</div></div>`
          })
          .join('')}
      </section>`
    : ''

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <title>月度复盘 ${escape(month)}</title>
  <style>
    @page { size: A4; margin: 14mm; }
    body { font-family: "PingFang SC", "Noto Serif SC", serif; color: #0f172a; margin: 0; line-height: 1.6; }
    .header { border-bottom: 2px solid #94a3b8; padding-bottom: 8mm; margin-bottom: 8mm; }
    .header h1 { margin: 0; font-size: 22px; }
    .header .sub { color: #64748b; font-size: 13px; margin-top: 2mm; }
    .metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-bottom: 6mm; }
    .metric { background: #f1f5f9; border-radius: 6px; padding: 4mm; }
    .metric .ml { color: #64748b; font-size: 11px; }
    .metric .mv { font-size: 18px; font-weight: 700; margin-top: 1mm; }
    h1 { font-size: 18px; margin: 5mm 0 3mm; }
    h2 { font-size: 16px; margin: 4mm 0 2mm; color: #334155; }
    h3 { font-size: 14px; margin: 3mm 0 2mm; color: #475569; }
    p { margin: 0 0 2mm; font-size: 13px; }
    ul { margin: 0 0 2mm 5mm; padding: 0; font-size: 13px; }
    li { margin-bottom: 1mm; }
    code { background: #f1f5f9; padding: 0 4px; border-radius: 3px; font-size: 12px; }
    .gap { height: 2mm; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>📅 ${escape(month)} 月度复盘</h1>
    <div class="sub">导出时间: ${new Date().toLocaleString('zh-CN')}</div>
  </div>
  ${metricsHtml}
  ${out.join('\n')}
</body>
</html>`
}
