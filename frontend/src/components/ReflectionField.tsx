/**
 * 反思字段. 一个可折叠的长文本输入区, 存到 reflections 表.
 *
 * 用法:
 *   <ReflectionField
 *     kind="mistake_note"
 *     relatedId={mistake.id}
 *     placeholder="你当时怎么想的?"
 *   />
 *
 * 行为:
 * - 点击 "写下想法" 展开
 * - 500ms debounce 自动 upsert
 * - 首次加载时从后端读取已有内容
 * - 只有学生自己看得到, 不会喂给 AI — UI 上必须明确告知
 */
import { useEffect, useState } from 'react'
import { api, Reflection, ReflectionKind } from '../api'

type Props = {
  kind: ReflectionKind
  relatedId?: number
  relatedKey?: string
  placeholder?: string
  label?: string
  /** 默认折叠, 点击才展开. 设为 false 则总是展开. */
  collapsible?: boolean
}

export default function ReflectionField({
  kind,
  relatedId,
  relatedKey,
  placeholder = '你当时是怎么想的? 这题让你有什么感觉? 写给自己看.',
  label = '我的想法',
  collapsible = true,
}: Props) {
  const [expanded, setExpanded] = useState(!collapsible)
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)
  const [existing, setExisting] = useState<Reflection | null>(null)

  // 加载已有
  useEffect(() => {
    if (!loaded && expanded) {
      api
        .listReflections({ kind, related_id: relatedId, related_key: relatedKey, limit: 1 })
        .then((items) => {
          if (items.length > 0) {
            setContent(items[0].content)
            setExisting(items[0])
          }
          setLoaded(true)
        })
        .catch(() => setLoaded(true))
    }
  }, [expanded, loaded, kind, relatedId, relatedKey])

  // debounce 保存
  useEffect(() => {
    if (!loaded || !expanded) return
    if (!content.trim()) return
    const t = window.setTimeout(() => {
      api
        .upsertReflection({
          kind,
          related_id: relatedId ?? null,
          related_key: relatedKey ?? null,
          content: content.trim(),
        })
        .then((row) => {
          setExisting(row)
          setSaved(true)
          window.setTimeout(() => setSaved(false), 1500)
        })
        .catch(() => {})
    }, 800)
    return () => window.clearTimeout(t)
  }, [content, loaded, expanded, kind, relatedId, relatedKey])

  if (collapsible && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-xs text-slate-500 hover:text-brand-600 mt-2 flex items-center gap-1"
      >
        💭 {existing ? `${label} (${existing.content.length} 字)` : `写下${label}`}
      </button>
    )
  }

  return (
    <div className="mt-3 bg-slate-50 border border-slate-200 rounded p-3 space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-slate-600">{label}</label>
        <span className="text-[10px] text-slate-400">
          {saved ? '已保存 ✓' : '只给你自己看 · 不会被 AI 分析'}
        </span>
      </div>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={2000}
        className="w-full border border-slate-200 rounded px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
      />
      {collapsible && (
        <button
          onClick={() => setExpanded(false)}
          className="text-[11px] text-slate-400 hover:text-slate-600"
        >
          收起
        </button>
      )}
    </div>
  )
}
