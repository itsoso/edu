import { useEffect, useMemo, useState } from 'react'
import { api, Course, CourseInput } from '../api'

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEKEND_DAYS = [5, 6, 7]  // 周末接送关注: 周五晚 + 周六日

function toMinutes(hhmm: string) {
  const [h, m] = hhmm.split(':').map((x) => parseInt(x, 10) || 0)
  return h * 60 + m
}

function durationLabel(start: string, end: string) {
  const mins = toMinutes(end) - toMinutes(start)
  if (mins < 60) return `${mins} 分钟`
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

function emptyInput(): CourseInput {
  return {
    child_name: '',
    course_name: '',
    weekday: 6,
    start_time: '09:00',
    end_time: '10:00',
    location: '',
    pickup_note: '',
    notes: '',
  }
}

export default function Schedule() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [children, setChildren] = useState<{ name: string; count: number }[]>([])
  const [filterChild, setFilterChild] = useState<string>('all')
  const [weekendOnly, setWeekendOnly] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Course | null>(null)
  const [draft, setDraft] = useState<CourseInput>(emptyInput())
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  async function refresh() {
    setLoading(true)
    try {
      const [cs, kids] = await Promise.all([
        api.listCourses(),
        api.listCourseChildren(),
      ])
      setCourses(cs)
      setChildren(kids)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const filtered = useMemo(() => {
    return courses.filter((c) => {
      if (weekendOnly && !WEEKEND_DAYS.includes(c.weekday)) return false
      if (filterChild !== 'all' && c.child_name !== filterChild) return false
      return true
    })
  }, [courses, weekendOnly, filterChild])

  // 按孩子 → 周几分组
  const grouped = useMemo(() => {
    const byChild = new Map<string, Map<number, Course[]>>()
    for (const c of filtered) {
      if (!byChild.has(c.child_name)) byChild.set(c.child_name, new Map())
      const byDay = byChild.get(c.child_name)!
      if (!byDay.has(c.weekday)) byDay.set(c.weekday, [])
      byDay.get(c.weekday)!.push(c)
    }
    return byChild
  }, [filtered])

  function openCreate() {
    setEditing(null)
    setDraft(emptyInput())
    setEditOpen(true)
  }

  function openEdit(c: Course) {
    setEditing(c)
    setDraft({
      child_name: c.child_name,
      course_name: c.course_name,
      weekday: c.weekday,
      start_time: c.start_time,
      end_time: c.end_time,
      location: c.location || '',
      pickup_note: c.pickup_note || '',
      notes: c.notes || '',
      sort_order: c.sort_order,
    })
    setEditOpen(true)
  }

  async function save() {
    setBusy(true)
    setMsg('')
    try {
      if (editing) {
        await api.updateCourse(editing.id, draft)
      } else {
        await api.createCourse(draft)
      }
      setEditOpen(false)
      await refresh()
    } catch (e: any) {
      setMsg(e.message || '保存失败')
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: Course) {
    if (!confirm(`删除「${c.child_name} · ${c.course_name}」?`)) return
    await api.deleteCourse(c.id)
    await refresh()
  }

  async function seedFamily() {
    setBusy(true)
    try {
      const r = await api.seedFamilyCourses()
      setMsg(`已录入 ${r.inserted} 门课 (跳过已存在 ${r.skipped} 门)`)
      await refresh()
    } catch (e: any) {
      setMsg(e.message || '导入失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold">课程日历</h1>
        <p className="mt-1 text-slate-500">
          周末接送一眼看清 — 时间、地点、孩子。
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={weekendOnly}
            onChange={(e) => setWeekendOnly(e.target.checked)}
          />
          只看周末（周五-周日）
        </label>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">孩子:</span>
          <select
            value={filterChild}
            onChange={(e) => setFilterChild(e.target.value)}
            className="rounded-md border border-slate-300 px-2 py-1"
          >
            <option value="all">全部</option>
            {children.map((k) => (
              <option key={k.name} value={k.name}>{k.name} ({k.count})</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex gap-2">
          {courses.length === 0 && (
            <button
              onClick={seedFamily}
              disabled={busy}
              className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              一键导入家庭课表
            </button>
          )}
          <button
            onClick={openCreate}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white"
          >
            + 新增课程
          </button>
        </div>
      </div>

      {msg && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {msg}
        </div>
      )}

      {loading ? (
        <div className="text-slate-400">加载中...</div>
      ) : filtered.length === 0 ? (
        <EmptyState onSeed={seedFamily} onNew={openCreate} canSeed={courses.length === 0} />
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([child, byDay]) => (
            <ChildBlock
              key={child}
              childName={child}
              byDay={byDay}
              onEdit={openEdit}
              onDelete={remove}
            />
          ))}
        </div>
      )}

      {editOpen && (
        <EditModal
          draft={draft}
          setDraft={setDraft}
          onClose={() => setEditOpen(false)}
          onSave={save}
          saving={busy}
          isEdit={!!editing}
          knownChildren={children.map((c) => c.name)}
        />
      )}
    </div>
  )
}

function ChildBlock({
  childName,
  byDay,
  onEdit,
  onDelete,
}: {
  childName: string
  byDay: Map<number, Course[]>
  onEdit: (c: Course) => void
  onDelete: (c: Course) => void
}) {
  const days = Array.from(byDay.keys()).sort((a, b) => a - b)
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-lg font-semibold text-brand-700">👧 {childName}</h2>
      <div className="space-y-4">
        {days.map((d) => (
          <div key={d}>
            <div className={`mb-2 text-sm font-medium ${
              d === 6 || d === 7 ? 'text-rose-600' : 'text-slate-600'
            }`}>
              {WEEKDAY_LABELS[d]}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {byDay.get(d)!.map((c) => (
                <CourseCard
                  key={c.id}
                  course={c}
                  onEdit={() => onEdit(c)}
                  onDelete={() => onDelete(c)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function CourseCard({
  course,
  onEdit,
  onDelete,
}: {
  course: Course
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold text-slate-900">{course.course_name}</div>
          <div className="mt-0.5 text-sm text-slate-600">
            {course.start_time} - {course.end_time}
            <span className="ml-2 text-xs text-slate-400">
              ({durationLabel(course.start_time, course.end_time)})
            </span>
          </div>
          {course.location && (
            <div className="mt-1 text-sm text-slate-500">📍 {course.location}</div>
          )}
          {course.pickup_note && (
            <div className="mt-1 text-sm text-amber-700">🚗 {course.pickup_note}</div>
          )}
          {course.notes && (
            <div className="mt-1 text-xs text-slate-500">{course.notes}</div>
          )}
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <button onClick={onEdit} className="rounded border border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-white">
            编辑
          </button>
          <button onClick={onDelete} className="rounded border border-rose-200 px-2 py-0.5 text-rose-600 hover:bg-rose-50">
            删除
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState({
  onSeed,
  onNew,
  canSeed,
}: {
  onSeed: () => void
  onNew: () => void
  canSeed: boolean
}) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center">
      <div className="text-slate-500">还没有课程记录</div>
      <div className="mt-4 flex justify-center gap-2">
        {canSeed && (
          <button
            onClick={onSeed}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white"
          >
            一键导入家庭课表
          </button>
        )}
        <button
          onClick={onNew}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700"
        >
          手动添加
        </button>
      </div>
    </div>
  )
}

function EditModal({
  draft,
  setDraft,
  onClose,
  onSave,
  saving,
  isEdit,
  knownChildren,
}: {
  draft: CourseInput
  setDraft: (d: CourseInput) => void
  onClose: () => void
  onSave: () => void
  saving: boolean
  isEdit: boolean
  knownChildren: string[]
}) {
  const update = (patch: Partial<CourseInput>) => setDraft({ ...draft, ...patch })
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 text-lg font-semibold">
          {isEdit ? '编辑课程' : '新增课程'}
        </div>
        <div className="space-y-3 text-sm">
          <Field label="孩子">
            <input
              list="known-children"
              value={draft.child_name}
              onChange={(e) => update({ child_name: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
              placeholder="潘立言 / 潘友闻"
            />
            <datalist id="known-children">
              {knownChildren.map((n) => <option key={n} value={n} />)}
            </datalist>
          </Field>
          <Field label="课程名">
            <input
              value={draft.course_name}
              onChange={(e) => update({ course_name: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
              placeholder="例: 黄语文"
            />
          </Field>
          <Field label="周几">
            <select
              value={draft.weekday}
              onChange={(e) => update({ weekday: parseInt(e.target.value) })}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            >
              {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                <option key={d} value={d}>{WEEKDAY_LABELS[d]}</option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="开始">
              <input
                type="time"
                value={draft.start_time}
                onChange={(e) => update({ start_time: e.target.value })}
                className="w-full rounded border border-slate-300 px-2 py-1.5"
              />
            </Field>
            <Field label="结束">
              <input
                type="time"
                value={draft.end_time}
                onChange={(e) => update({ end_time: e.target.value })}
                className="w-full rounded border border-slate-300 px-2 py-1.5"
              />
            </Field>
          </div>
          <Field label="地点">
            <input
              value={draft.location || ''}
              onChange={(e) => update({ location: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
              placeholder="例: 4号教室"
            />
          </Field>
          <Field label="接送备注">
            <input
              value={draft.pickup_note || ''}
              onChange={(e) => update({ pickup_note: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
              placeholder="例: 爸爸送, 妈妈接"
            />
          </Field>
          <Field label="其它备注">
            <input
              value={draft.notes || ''}
              onChange={(e) => update({ notes: e.target.value })}
              className="w-full rounded border border-slate-300 px-2 py-1.5"
            />
          </Field>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm"
          >
            取消
          </button>
          <button
            onClick={onSave}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs font-medium text-slate-500">{label}</div>
      {children}
    </label>
  )
}
