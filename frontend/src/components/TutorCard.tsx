import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, AgentSuggestion } from '../api'

type Props = {
  suggestion: AgentSuggestion
  onResolved: () => void
}

export default function TutorCard({ suggestion, onResolved }: Props) {
  const nav = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const [busy, setBusy] = useState<'accept' | 'dismiss' | 'snooze' | null>(null)
  const [err, setErr] = useState('')

  async function accept() {
    if (busy) return
    setBusy('accept')
    setErr('')
    try {
      const r = await api.acceptSuggestion(suggestion.id)
      onResolved()
      handleAcceptResult(r.action, r.result)
    } catch (e: any) {
      setErr(e.message || '操作失败')
    } finally {
      setBusy(null)
    }
  }

  function handleAcceptResult(action: any, result: any) {
    const t = action?.type || suggestion.accept_action?.type
    if (t === 'generate_practice') {
      const pid = result?.practice_set_id
      if (pid) nav(`/practice`)
      else nav('/practice')
      return
    }
    if (t === 'navigate') {
      const target = action?.target || suggestion.accept_action?.target
      if (target === 'Mistakes') nav('/mistakes')
      else if (target === 'Practice') nav('/practice')
      else if (target === 'Plan') nav('/plan')
      return
    }
    // acknowledge: 不跳
  }

  async function dismiss(reason?: string) {
    if (busy) return
    setBusy('dismiss')
    setErr('')
    try {
      await api.dismissSuggestion(suggestion.id, reason)
      onResolved()
    } catch (e: any) {
      setErr(e.message || '操作失败')
    } finally {
      setBusy(null)
    }
  }

  async function snooze(days: number) {
    if (busy) return
    setBusy('snooze')
    setMenuOpen(false)
    setErr('')
    try {
      await api.snoozeAgent(days)
      onResolved()
    } catch (e: any) {
      setErr(e.message || '操作失败')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-lg p-5 relative">
      <div className="flex items-start justify-between mb-3">
        <div className="text-sm text-indigo-700 font-medium">🤖 给你一个建议</div>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="text-slate-400 hover:text-slate-600 px-2 py-0.5 rounded"
            aria-label="更多"
          >
            ⋯
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 w-44 bg-white border border-slate-200 rounded shadow-md text-sm z-10">
              <button
                onClick={() => snooze(7)}
                className="block w-full text-left px-3 py-2 hover:bg-slate-50"
              >
                暂停 7 天
              </button>
              <button
                onClick={() => snooze(14)}
                className="block w-full text-left px-3 py-2 hover:bg-slate-50"
              >
                暂停 14 天
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  dismiss('not_interested')
                }}
                className="block w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-600 border-t border-slate-100"
              >
                这条不再建议
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="text-lg text-slate-800 leading-relaxed mb-4">
        {suggestion.wording}
      </div>

      <details
        className="mb-4 text-sm text-slate-600"
        open={whyOpen}
        onToggle={(e) => setWhyOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer text-indigo-600 select-none">
          为什么是这条? →
        </summary>
        <div className="mt-2 space-y-2">
          <div className="text-slate-700 leading-relaxed">{suggestion.rationale}</div>
          {suggestion.evidence_refs && (
            <pre className="text-xs bg-white/60 border border-indigo-100 rounded p-2 overflow-auto text-slate-600">
              {JSON.stringify(suggestion.evidence_refs, null, 2)}
            </pre>
          )}
        </div>
      </details>

      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}

      <div className="flex gap-2">
        <button
          onClick={accept}
          disabled={busy !== null}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
        >
          {busy === 'accept' ? '处理中...' : '好, 我试试'}
        </button>
        <button
          onClick={() => dismiss()}
          disabled={busy !== null}
          className="px-4 py-2 text-sm border border-slate-300 bg-white text-slate-700 rounded hover:bg-slate-50 disabled:opacity-50"
        >
          这次跳过
        </button>
      </div>
    </div>
  )
}
