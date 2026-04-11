/**
 * Journal — 她的声音时间流.
 *
 * 这一页展示所有的 reflections, 按时间倒序:
 * - weekly_note: 本周的"本周我学到了什么"
 * - free_write: 她主动写的任何东西 (日记/随想/困惑/开心事)
 * - mistake_note / exam_feeling: 简要链接, 但不在这页展开 (那些属于错题/考试上下文)
 *
 * 核心体验:
 * - 她能一目了然看到自己这段时间的思考
 * - 永远不会被 AI 分析 — 每次页面顶部都会提醒
 */
import { useEffect, useState } from 'react'
import { api, Reflection } from '../api'
import EmptyState from '../components/EmptyState'
import { useToast } from '../components/Toast'

export default function Journal() {
  const toast = useToast()
  const [items, setItems] = useState<Reflection[]>([])
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  async function reload() {
    try {
      // 拉取所有类型的 reflections, 前端再筛
      const [free, weekly, examF] = await Promise.all([
        api.listReflections({ kind: 'free_write', limit: 100 }),
        api.listReflections({ kind: 'weekly_note', limit: 20 }),
        api.listReflections({ kind: 'exam_feeling', limit: 20 }),
      ])
      // 合并 + 按 created_at desc 排序
      const all = [...free, ...weekly, ...examF].sort(
        (a, b) => b.created_at.localeCompare(a.created_at)
      )
      setItems(all)
      setLoaded(true)
    } catch (e: any) {
      toast.error('加载失败: ' + (e.message || e))
      setLoaded(true)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function submit() {
    const content = newContent.trim()
    if (!content) return
    setSaving(true)
    try {
      await api.upsertReflection({ kind: 'free_write', content })
      setNewContent('')
      toast.success('写下了')
      reload()
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: number) {
    if (!confirm('删除这条? 不可恢复')) return
    try {
      await api.deleteReflection(id)
      reload()
    } catch (e: any) {
      toast.error('删除失败: ' + (e.message || e))
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">日记</h1>
        <p className="text-slate-500 mt-1 text-sm">
          你的主观表达 · <b className="text-slate-700">永远不会被 AI 分析</b> · 只有你自己看得到
        </p>
      </div>

      {/* 写入区 */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <label className="text-sm font-medium">现在想写点什么?</label>
        <textarea
          value={newContent}
          onChange={(e) => setNewContent(e.target.value)}
          placeholder="一句话、一段话、一个吐槽、一个困惑, 都可以."
          rows={4}
          maxLength={2000}
          className="w-full mt-2 border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
        <div className="flex items-center justify-between mt-2">
          <span className="text-xs text-slate-400">{newContent.length} / 2000</span>
          <button
            onClick={submit}
            disabled={saving || !newContent.trim()}
            className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded disabled:opacity-50"
          >
            {saving ? '保存中...' : '写下'}
          </button>
        </div>
      </div>

      {/* 时间流 */}
      <div className="space-y-3">
        {loaded && items.length === 0 && (
          <EmptyState
            icon="🕊️"
            title="这里还是空的"
            description={
              <>
                任何想法都可以放在这里。以后翻回去看, 会发现自己一直在变。
                <br />
                这个空间只有你自己看得到, 不会被 AI 分析。
              </>
            }
          />
        )}
        {items.map((it) => (
          <JournalEntry key={it.id} item={it} onDelete={() => remove(it.id)} />
        ))}
      </div>
    </div>
  )
}

function JournalEntry({ item, onDelete }: { item: Reflection; onDelete: () => void }) {
  const kindLabel: Record<string, { label: string; color: string }> = {
    free_write: { label: '随想', color: 'bg-slate-100 text-slate-700' },
    weekly_note: { label: '本周笔记', color: 'bg-brand-50 text-brand-700' },
    exam_feeling: { label: '考后感受', color: 'bg-purple-50 text-purple-700' },
    mistake_note: { label: '错题想法', color: 'bg-amber-50 text-amber-700' },
  }
  const meta = kindLabel[item.kind] || { label: item.kind, color: 'bg-slate-100' }
  const dt = new Date(item.created_at)
  const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className={`px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
        {item.related_key && (
          <span className="text-slate-500">周 {item.related_key}</span>
        )}
        <span className="text-slate-400">· {dateStr}</span>
        <button
          onClick={onDelete}
          className="ml-auto text-slate-400 hover:text-red-500"
        >
          删
        </button>
      </div>
      <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
        {item.content}
      </div>
    </div>
  )
}
