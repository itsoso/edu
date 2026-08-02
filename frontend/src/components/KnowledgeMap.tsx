/**
 * 知识点图谱 - 用 Treemap 展示每个知识点的错题数 + 掌握度.
 *
 * 颜色 = 薄弱程度 (红=未掌握/绿=已掌握)
 * 面积 = 错题数量 (越大越多)
 *
 * 需求来源: 家长想看"孩子哪个知识点最弱", 而不只看单题错因.
 */
import { useEffect, useMemo, useState } from 'react'
import { ResponsiveContainer, Treemap, Tooltip } from 'recharts'
import { api } from '../api'

type Node = {
  subject: string
  knowledge_point: string
  total: number
  mastered: number
  mastery: number
  weakness_score: number
  last_seen: string | null
}

// 红 → 黄 → 绿
function mapColor(score: number): string {
  // score 是薄弱度: 0 (强) ~ 1 (弱)
  // 0 → emerald (#10b981), 0.5 → amber (#f59e0b), 1 → rose (#e11d48)
  if (score <= 0.5) {
    // emerald → amber
    const t = score * 2
    const r = Math.round(0x10 + (0xf5 - 0x10) * t)
    const g = Math.round(0xb9 + (0x9e - 0xb9) * t)
    const b = Math.round(0x81 + (0x0b - 0x81) * t)
    return `rgb(${r}, ${g}, ${b})`
  } else {
    const t = (score - 0.5) * 2
    const r = Math.round(0xf5 + (0xe1 - 0xf5) * t)
    const g = Math.round(0x9e + (0x1d - 0x9e) * t)
    const b = Math.round(0x0b + (0x48 - 0x0b) * t)
    return `rgb(${r}, ${g}, ${b})`
  }
}

type RechartsCustomCellProps = {
  x: number
  y: number
  width: number
  height: number
  payload?: Node
  name?: string
  rank?: number
}

function CellRenderer(props: RechartsCustomCellProps) {
  const { x, y, width, height, payload, name } = props
  if (width < 4 || height < 4) return null
  const score = payload?.weakness_score ?? 0
  const fill = mapColor(score)
  const text = name || payload?.knowledge_point || ''
  // 字号根据格子大小自适应
  const fontSize = Math.max(10, Math.min(14, Math.round(Math.min(width, height) / 5)))
  const showText = width > 44 && height > 26 && text
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="#fff" strokeWidth={2} rx={4} />
      {showText && (
        <>
          <text
            x={x + width / 2}
            y={y + height / 2 - fontSize / 2}
            textAnchor="middle"
            fill="#fff"
            fontSize={fontSize}
            fontWeight={600}
            style={{ pointerEvents: 'none' }}
          >
            {text.length > 8 ? text.slice(0, 8) + '…' : text}
          </text>
          {payload && height > 50 && (
            <text
              x={x + width / 2}
              y={y + height / 2 + fontSize + 2}
              textAnchor="middle"
              fill="rgba(255,255,255,0.85)"
              fontSize={fontSize - 2}
              style={{ pointerEvents: 'none' }}
            >
              {payload.total} 题 · {Math.round(payload.mastery * 100)}%
            </text>
          )}
        </>
      )}
    </g>
  )
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.[0]) return null
  const node = payload[0].payload as Node
  if (!node?.knowledge_point) return null
  return (
    <div className="bg-white border border-slate-200 shadow-lg rounded px-3 py-2 text-xs">
      <div className="font-bold text-slate-900">{node.knowledge_point}</div>
      <div className="text-slate-500">{node.subject}</div>
      <div className="mt-1 text-slate-700">
        错题 <b>{node.total}</b> 道 · 已掌握 <b>{node.mastered}</b> 道
      </div>
      <div className="text-slate-700">
        掌握率 <b>{Math.round(node.mastery * 100)}%</b>
      </div>
    </div>
  )
}

export default function KnowledgeMap() {
  const [nodes, setNodes] = useState<Node[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSubject, setFilterSubject] = useState<string>('')

  useEffect(() => {
    api.knowledgeGraph()
      .then((r) => setNodes(r.nodes))
      .finally(() => setLoading(false))
  }, [])

  const subjects = useMemo(() => {
    const s = new Set(nodes.map((n) => n.subject).filter(Boolean))
    return Array.from(s)
  }, [nodes])

  const filtered = useMemo(
    () => (filterSubject ? nodes.filter((n) => n.subject === filterSubject) : nodes),
    [nodes, filterSubject]
  )

  const treemapData = useMemo(() => {
    return filtered.map((n) => ({
      ...n,
      name: n.knowledge_point,
      size: n.total,
    }))
  }, [filtered])

  // 薄弱前 5
  const top5 = useMemo(
    () =>
      [...filtered]
        .filter((n) => n.total >= 2 && n.mastery < 0.7)
        .sort((a, b) => b.weakness_score - a.weakness_score)
        .slice(0, 5),
    [filtered]
  )

  if (loading) {
    return <div className="text-sm text-slate-500">加载中…</div>
  }

  if (nodes.length === 0) {
    return (
      <div className="bg-slate-50 rounded p-6 text-center text-sm text-slate-500">
        暂时没有带知识点的错题。在错题本里给错题添加"知识点"后这里就会出现图谱。
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <button
          onClick={() => setFilterSubject('')}
          className={`px-3 py-1 rounded-full border text-xs ${
            filterSubject === ''
              ? 'bg-brand-600 text-white border-brand-600'
              : 'border-slate-300 text-slate-600'
          }`}
        >
          全部
        </button>
        {subjects.map((s) => (
          <button
            key={s}
            onClick={() => setFilterSubject(s)}
            className={`px-3 py-1 rounded-full border text-xs ${
              filterSubject === s
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-slate-300 text-slate-600'
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">
          色系: 红=薄弱 · 黄=进步中 · 绿=掌握
        </span>
      </div>

      <div className="h-80 w-full bg-white rounded border border-slate-200 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData}
            dataKey="size"
            stroke="#fff"
            content={<CellRenderer x={0} y={0} width={0} height={0} />}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {top5.length > 0 && (
        <div className="bg-rose-50 border border-rose-200 rounded p-4">
          <div className="text-sm font-bold text-rose-900 mb-2">⚠️ 薄弱知识点 TOP 5</div>
          <ul className="space-y-1.5 text-sm">
            {top5.map((n) => (
              <li key={`${n.subject}-${n.knowledge_point}`} className="flex justify-between">
                <span className="text-slate-700">
                  <span className="text-slate-400 mr-2">{n.subject}</span>
                  {n.knowledge_point}
                </span>
                <span className="text-rose-700">
                  {n.total} 道 · 掌握 {Math.round(n.mastery * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
