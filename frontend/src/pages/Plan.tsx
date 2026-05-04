import { useEffect, useMemo, useState } from 'react'
import { api, Task, Checkin } from '../api'
import { useToast } from '../components/Toast'
import signals from '../lib/signals'

const WEEK_THEMES: Record<number, { title: string; goal: string }> = {
  1: { title: '第 1 周 · 摸底与修复', goal: '找到数学失分规律' },
  2: { title: '第 2 周 · 数学稳基 + 社会框架', goal: '把该拿的分拿稳' },
  3: { title: '第 3 周 · 语文止下滑 + 英语精进', goal: '语文答题模板 + 英语句型库' },
  4: { title: '第 4 周 · 综合模考 + 查漏', goal: '全真模考并制定下阶段目标' },
}

const DOW_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function todayStr() {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function currentWeekStart(): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function Plan() {
  const toast = useToast()
  const [week, setWeek] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')

  const weekStart = currentWeekStart()

  async function reload() {
    const [ts, cks] = await Promise.all([
      api.listTasks(week, undefined, weekStart),
      api.listCheckins(todayStr()),
    ])
    setTasks(ts)
    setCheckins(cks)
  }

  useEffect(() => {
    reload()
  }, [week])

  const grouped = useMemo(() => {
    const out: Record<number, Task[]> = {}
    for (const t of tasks) {
      ;(out[t.day_of_week] ||= []).push(t)
    }
    return out
  }, [tasks])

  const doneSet = new Set(checkins.map((c) => c.task_id))

  async function toggle(t: Task) {
    // skip 的任务不能打卡 (她已经说不做了)
    if (t.override_action === 'skip') {
      toast.info('这个任务本周已跳过. 先恢复默认才能打卡.')
      return
    }
    const completed = !doneSet.has(t.id)
    await api.upsertCheckin({
      task_id: t.id,
      checkin_date: todayStr(),
      completed,
    })
    signals.track('task.checkin.toggle', {
      related_table: 'tasks',
      related_id: t.id,
      payload: { completed, hour_of_day: new Date().getHours() },
    })
    const cks = await api.listCheckins(todayStr())
    setCheckins(cks)
  }

  async function skipTask(t: Task) {
    try {
      await api.overrideTask(t.id, { week_start: weekStart, action: 'skip' })
      signals.track('task.override.skip', {
        related_table: 'tasks',
        related_id: t.id,
        payload: { week },
      })
      toast.success('本周跳过')
      reload()
    } catch (e: any) {
      toast.error('操作失败: ' + (e.message || e))
    }
  }

  function startEdit(t: Task) {
    setEditingId(t.id)
    setEditTitle(t.effective_title || t.title)
    setEditDesc(t.effective_description || t.description || '')
  }

  async function saveEdit(t: Task) {
    const title = editTitle.trim()
    if (!title) {
      toast.error('标题不能为空')
      return
    }
    try {
      await api.overrideTask(t.id, {
        week_start: weekStart,
        action: 'replace',
        custom_title: title,
        custom_description: editDesc.trim() || undefined,
      })
      signals.track('task.override.replace', {
        related_table: 'tasks',
        related_id: t.id,
      })
      toast.success('换成了你自己的版本')
      setEditingId(null)
      reload()
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    }
  }

  async function restoreDefault(t: Task) {
    try {
      await api.clearTaskOverride(t.id, weekStart)
      reload()
    } catch (e: any) {
      toast.error('恢复失败: ' + (e.message || e))
    }
  }

  const theme = WEEK_THEMES[week]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">4 周执行计划</h1>
        <p className="text-slate-500 mt-1 text-sm">
          这是一份<b className="text-slate-700">建议模板</b>. 任何任务你都可以
          跳过 / 换成自己的话. 默认是空的, 你填什么它就是什么.
        </p>
      </div>

      {/* 周选择 */}
      <div className="flex gap-2">
        {[1, 2, 3, 4].map((w) => (
          <button
            key={w}
            onClick={() => setWeek(w)}
            className={`px-4 py-2 rounded font-medium text-sm ${
              week === w ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 border border-slate-200'
            }`}
          >
            第 {w} 周
          </button>
        ))}
      </div>

      <div className="bg-brand-50 border border-brand-100 rounded-lg p-4">
        <div className="font-semibold text-brand-700">{theme.title}</div>
        <div className="text-sm text-slate-600 mt-1">建议核心目标：{theme.goal}</div>
      </div>

      {/* 分天任务 */}
      <div className="space-y-4">
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const dayTasks = grouped[d] || []
          if (dayTasks.length === 0) return null
          const activeTasks = dayTasks.filter((t) => t.override_action !== 'skip')
          const doneOfDay = activeTasks.filter((t) => doneSet.has(t.id)).length
          return (
            <div key={d} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-slate-50 border-b border-slate-200">
                <div className="font-semibold">{DOW_LABEL[d - 1]}</div>
                <div className="text-xs text-slate-500">
                  {doneOfDay} / {activeTasks.length} ·{' '}
                  {activeTasks.reduce((s, t) => s + (t.effective_minutes || t.minutes), 0)} 分钟
                </div>
              </div>
              <ul className="divide-y divide-slate-100">
                {dayTasks.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    done={doneSet.has(t.id)}
                    editing={editingId === t.id}
                    editTitle={editTitle}
                    editDesc={editDesc}
                    setEditTitle={setEditTitle}
                    setEditDesc={setEditDesc}
                    onToggle={() => toggle(t)}
                    onSkip={() => skipTask(t)}
                    onStartEdit={() => startEdit(t)}
                    onCancelEdit={() => setEditingId(null)}
                    onSaveEdit={() => saveEdit(t)}
                    onRestore={() => restoreDefault(t)}
                  />
                ))}
              </ul>
            </div>
          )
        })}
      </div>
    </div>
  )
}

type TaskRowProps = {
  task: Task
  done: boolean
  editing: boolean
  editTitle: string
  editDesc: string
  setEditTitle: (s: string) => void
  setEditDesc: (s: string) => void
  onToggle: () => void
  onSkip: () => void
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaveEdit: () => void
  onRestore: () => void
}

function TaskRow({
  task: t,
  done,
  editing,
  editTitle,
  editDesc,
  setEditTitle,
  setEditDesc,
  onToggle,
  onSkip,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRestore,
}: TaskRowProps) {
  const skipped = t.override_action === 'skip'
  const replaced = t.override_action === 'replace'
  const title = t.effective_title || t.title
  const desc = t.effective_description || t.description
  const mins = t.effective_minutes || t.minutes

  if (editing) {
    return (
      <li className="px-4 py-3 bg-brand-50">
        <div className="text-xs text-brand-700 font-medium mb-2">换成你自己的版本</div>
        <input
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          placeholder="用你自己的话写这个任务"
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-2"
          autoFocus
        />
        <textarea
          value={editDesc}
          onChange={(e) => setEditDesc(e.target.value)}
          placeholder="详细说明 (可选)"
          rows={2}
          className="w-full border border-slate-300 rounded px-3 py-2 text-sm mb-2 resize-none"
        />
        <div className="flex gap-2">
          <button
            onClick={onSaveEdit}
            className="px-3 py-1 text-sm bg-brand-600 text-white rounded"
          >
            保存
          </button>
          <button
            onClick={onCancelEdit}
            className="px-3 py-1 text-sm border border-slate-300 rounded"
          >
            取消
          </button>
        </div>
      </li>
    )
  }

  return (
    <li className={`px-4 py-3 flex items-start gap-3 ${skipped ? 'opacity-50' : ''}`}>
      <input
        type="checkbox"
        checked={done}
        onChange={onToggle}
        disabled={skipped}
        className="mt-1 w-5 h-5 accent-brand-600 disabled:opacity-40"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {t.subject && (
            <span className="text-xs px-1.5 py-0.5 bg-brand-100 text-brand-700 rounded">
              {t.subject}
            </span>
          )}
          {replaced && (
            <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">
              ✍️ 我的版本
            </span>
          )}
          {skipped && (
            <span className="text-xs px-1.5 py-0.5 bg-slate-200 text-slate-600 rounded">
              已跳过
            </span>
          )}
          <span
            className={`font-medium ${
              done ? 'line-through text-slate-400' : ''
            } ${skipped ? 'line-through' : ''}`}
          >
            {title}
          </span>
          <span className="text-xs text-slate-400">{mins} 分钟</span>
        </div>
        {desc && (
          <p
            className={`text-sm mt-1 ${
              done || skipped ? 'text-slate-400' : 'text-slate-600'
            }`}
          >
            {desc}
          </p>
        )}
        {replaced && (
          <p className="text-[10px] text-slate-400 mt-1">
            原模板: {t.title}
          </p>
        )}
        <div className="flex gap-3 mt-2 text-[11px]">
          {!skipped && !replaced && (
            <>
              <button
                onClick={onStartEdit}
                className="text-slate-500 hover:text-brand-600"
              >
                ✍️ 换成我的
              </button>
              <button
                onClick={onSkip}
                className="text-slate-500 hover:text-red-600"
              >
                跳过本周
              </button>
            </>
          )}
          {(skipped || replaced) && (
            <button
              onClick={onRestore}
              className="text-slate-500 hover:text-brand-600"
            >
              ↻ 恢复默认
            </button>
          )}
          {replaced && (
            <button
              onClick={onStartEdit}
              className="text-slate-500 hover:text-brand-600"
            >
              ✍️ 再改
            </button>
          )}
        </div>
      </div>
    </li>
  )
}
