/**
 * 任务页 — 家长布置任务 / 学生待办.
 *
 * 角色行为:
 *  - 家长: 默认看自己布置的;可新建/编辑/删除/取消
 *  - 学生: 看自己收到的所有任务;可"完成"/"撤销完成";只能删自己加的
 */
import { useEffect, useMemo, useState } from 'react'
import { api, Assignment } from '../api'
import { useAuth } from '../auth'
import { useToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'

const KIND_OPTIONS = [
  { v: 'custom', label: '其他' },
  { v: 'practice', label: '做练习' },
  { v: 'essay', label: '写作文' },
  { v: 'reading', label: '阅读' },
] as const

const KIND_EMOJI: Record<string, string> = {
  custom: '📌',
  practice: '🏋️',
  essay: '📝',
  reading: '📖',
}

function fmtDate(s: string | null): string {
  if (!s) return '无截止'
  return s
}

function isOverdue(a: Assignment): boolean {
  if (!a.due_date || a.status !== 'pending') return false
  const today = new Date().toISOString().slice(0, 10)
  return a.due_date < today
}

export default function Assignments() {
  const { user } = useAuth()
  const toast = useToast()
  const isParent = user?.role === 'parent'

  const [items, setItems] = useState<Assignment[]>([])
  const [filter, setFilter] = useState<'all' | 'pending' | 'completed'>('pending')
  const [showAdd, setShowAdd] = useState(false)
  const [busy, setBusy] = useState(false)

  // 表单
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<string>('custom')
  const [dueDate, setDueDate] = useState('')

  async function reload() {
    try {
      const data = await api.listAssignments({
        status: filter === 'all' ? undefined : filter,
        // 家长默认看自己布置的; 学生看自己收到的
        mine_assigned: isParent ? true : false,
      })
      setItems(data)
    } catch (e: any) {
      toast.error('加载失败: ' + (e.message || e))
    }
  }

  useEffect(() => { reload() }, [filter, isParent])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setBusy(true)
    try {
      await api.createAssignment({
        title: title.trim(),
        description: description.trim() || undefined,
        kind,
        due_date: dueDate || undefined,
      })
      setTitle(''); setDescription(''); setKind('custom'); setDueDate('')
      setShowAdd(false)
      toast.success('已添加')
      reload()
    } catch (e: any) {
      toast.error('添加失败: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function toggle(a: Assignment) {
    try {
      const next = a.status === 'completed' ? 'pending' : 'completed'
      await api.updateAssignment(a.id, { status: next })
      reload()
    } catch (e: any) {
      toast.error('更新失败: ' + (e.message || e))
    }
  }

  async function remove(a: Assignment) {
    if (!confirm(`删除任务"${a.title}"?`)) return
    try {
      await api.deleteAssignment(a.id)
      reload()
    } catch (e: any) {
      toast.error('删除失败: ' + (e.message || e))
    }
  }

  const pendingCount = useMemo(
    () => items.filter((x) => x.status === 'pending').length,
    [items]
  )
  const overdueCount = useMemo(
    () => items.filter(isOverdue).length,
    [items]
  )

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">📋 {isParent ? '我布置的' : '我的待办'}</h1>
          <p className="text-slate-500 mt-1 text-sm">
            {isParent
              ? '给孩子布置作业 / 阅读 / 自定义任务,孩子完成后会同步状态'
              : '家长布置或自己加的任务清单。点 ✓ 标完成。'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd((v) => !v)}
          className="self-start md:self-auto px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
        >
          {showAdd ? '取消' : '+ 新增任务'}
        </button>
      </div>

      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="bg-white border border-slate-200 rounded-lg p-4 space-y-3"
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">标题 *</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="完成第三章数学练习题"
                maxLength={100}
                className="w-full border border-slate-300 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">类型</label>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2"
              >
                {KIND_OPTIONS.map((o) => (
                  <option key={o.v} value={o.v}>{o.label}</option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-slate-500 mb-1">说明 (可选)</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="例如:重点做第 5、8、10 题"
                className="w-full border border-slate-300 rounded px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">截止日期</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full border border-slate-300 rounded px-3 py-2"
              />
            </div>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={busy || !title.trim()}
              className="px-4 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
            >
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}

      <div className="flex gap-2 items-center text-sm flex-wrap">
        {(['pending', 'completed', 'all'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs border ${
              filter === f
                ? 'bg-brand-600 text-white border-brand-600'
                : 'border-slate-300 text-slate-600'
            }`}
          >
            {f === 'pending' ? '进行中' : f === 'completed' ? '已完成' : '全部'}
          </button>
        ))}
        <span className="text-xs text-slate-400 ml-auto">
          待办 {pendingCount}
          {overdueCount > 0 && (
            <span className="text-red-600 font-medium"> · 逾期 {overdueCount}</span>
          )}
        </span>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon="📋"
          title={filter === 'completed' ? '还没有已完成的任务' : '还没有任务'}
          description={isParent ? '点"+新增任务"给孩子布置一个' : '让家长布置或自己加一个'}
        />
      ) : (
        <ul className="space-y-2">
          {items.map((a) => (
            <li
              key={a.id}
              className={`border rounded-lg p-3 flex gap-3 items-start ${
                a.status === 'completed'
                  ? 'bg-slate-50 border-slate-200'
                  : isOverdue(a)
                  ? 'bg-red-50 border-red-200'
                  : 'bg-white border-slate-200'
              }`}
            >
              <button
                onClick={() => toggle(a)}
                className={`shrink-0 mt-0.5 w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs ${
                  a.status === 'completed'
                    ? 'bg-emerald-500 border-emerald-500 text-white'
                    : 'border-slate-300 text-transparent hover:border-brand-500'
                }`}
                aria-label="切换完成"
              >
                ✓
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base">{KIND_EMOJI[a.kind] || '📌'}</span>
                  <span
                    className={`font-medium ${
                      a.status === 'completed' ? 'line-through text-slate-400' : ''
                    }`}
                  >
                    {a.title}
                  </span>
                  {a.due_date && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        isOverdue(a)
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      📅 {fmtDate(a.due_date)}
                    </span>
                  )}
                </div>
                {a.description && (
                  <div className="text-xs text-slate-500 mt-1">{a.description}</div>
                )}
                <div className="text-xs text-slate-400 mt-1">
                  {a.assigner_name ? `${a.assigner_name} 布置 · ` : ''}
                  {new Date(a.created_at).toLocaleDateString()}
                </div>
              </div>
              {(isParent || a.assigner_user_id === user?.id) && (
                <button
                  onClick={() => remove(a)}
                  className="text-xs text-slate-400 hover:text-red-600 shrink-0"
                >
                  删除
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
