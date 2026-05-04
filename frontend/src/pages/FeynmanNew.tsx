import { FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError, RecentFeynmanKp } from '../api'

const SUBJECTS = ['数学', '科学', '英语', '语文', '社会']
const KP_MAX = 80
const NOTE_MAX = 120

export default function FeynmanNew() {
  const nav = useNavigate()
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [kp, setKp] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [recent, setRecent] = useState<RecentFeynmanKp[]>([])

  useEffect(() => {
    let cancelled = false
    api
      .listRecentFeynmanKps(12)
      .then((r) => {
        if (!cancelled) setRecent(r)
      })
      .catch(() => {
        // 静默: chips 是增强, 失败不影响表单
      })
    return () => {
      cancelled = true
    }
  }, [])

  function pickRecent(r: RecentFeynmanKp) {
    if (SUBJECTS.includes(r.subject)) setSubject(r.subject)
    setKp(r.knowledge_point)
  }

  const kpTrim = kp.trim()
  const noteTrim = note.trim()
  const valid = !!kpTrim && kpTrim.length <= KP_MAX && noteTrim.length <= NOTE_MAX

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!valid || busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await api.startFeynman({
        source_table: 'manual',
        subject,
        knowledge_point: kpTrim,
        learned_from: noteTrim || undefined,
      })
      nav(`/feynman/${r.session_id}`, { replace: true })
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : String(e?.message || e))
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">🎓 讲一个新知识点</h1>
          <p className="mt-1 text-sm text-slate-500">
            刚学到的东西,讲给 AI 同学听,帮你把它变成真的"自己的"。
          </p>
        </div>
        <Link to="/feynman-history" className="text-sm text-slate-500 hover:text-slate-700">
          回看历次
        </Link>
      </div>

      {err && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {err}
        </div>
      )}

      <form
        onSubmit={submit}
        className="space-y-4 rounded-lg border border-slate-200 bg-white p-5"
      >
        {recent.length > 0 && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-slate-500">
                最近讲过的
              </label>
              <span className="text-xs text-slate-400">点一下继续讲</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {recent.map((r) => {
                const active =
                  r.subject === subject && r.knowledge_point === kpTrim
                return (
                  <button
                    key={`${r.subject}:${r.knowledge_point}`}
                    type="button"
                    onClick={() => pickRecent(r)}
                    title={`${r.session_count} 次 · 最近 ${r.last_spoken_at?.slice(0, 10) ?? ''}`}
                    className={
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition ' +
                      (active
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-slate-100')
                    }
                  >
                    <span
                      className={
                        'inline-block h-1.5 w-1.5 rounded-full ' +
                        (r.last_understood ? 'bg-green-500' : 'bg-slate-300')
                      }
                    />
                    <span className="text-slate-400">{r.subject}·</span>
                    <span className="font-medium">{r.knowledge_point}</span>
                    {r.session_count > 1 && (
                      <span className="text-slate-400">×{r.session_count}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">科目</label>
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSubject(s)}
                className={
                  'rounded-full border px-4 py-1.5 text-sm transition ' +
                  (subject === s
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50')
                }
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="kp" className="mb-1 block text-xs font-medium text-slate-500">
            知识点 <span className="text-red-500">*</span>
          </label>
          <input
            id="kp"
            type="text"
            value={kp}
            onChange={(e) => setKp(e.target.value)}
            maxLength={KP_MAX + 10}
            placeholder="例: 勾股定理 / 电路串并联 / 定语从句"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
            autoFocus
          />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>简短一两个词即可,越具体越好</span>
            <span className={kpTrim.length > KP_MAX ? 'text-red-500' : ''}>
              {kpTrim.length} / {KP_MAX}
            </span>
          </div>
        </div>

        <div>
          <label htmlFor="note" className="mb-1 block text-xs font-medium text-slate-500">
            我在哪学的 <span className="text-slate-400">(可选)</span>
          </label>
          <input
            id="note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={NOTE_MAX + 20}
            placeholder="例: 物理 4.3 节 / B 站某视频 / 课堂"
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-400 focus:outline-none"
          />
          <div className="mt-1 flex justify-between text-xs text-slate-400">
            <span>告诉 AI 同学你在哪学的,开场白会更自然</span>
            <span className={noteTrim.length > NOTE_MAX ? 'text-red-500' : ''}>
              {noteTrim.length} / {NOTE_MAX}
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            onClick={() => nav(-1)}
            className="rounded-full border border-slate-300 px-5 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
            disabled={busy}
          >
            取消
          </button>
          <button
            type="submit"
            className="rounded-full bg-brand-600 px-6 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
            disabled={!valid || busy}
          >
            {busy ? '进入对话...' : '开始讲解'}
          </button>
        </div>
      </form>
    </div>
  )
}
