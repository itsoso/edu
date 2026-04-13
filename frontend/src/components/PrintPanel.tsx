import { useState } from 'react'
import type { PrintableMode } from '../print/printable'

type PrintScope = 'selected' | 'all'

export type PrintPanelOptions = {
  scope: PrintScope
  mode: PrintableMode
  includeSolutions: boolean
  includeLinkedPractice: boolean
}

export default function PrintPanel({
  title,
  selectedCount,
  totalCount,
  allowLinkedPractice = false,
  busy = false,
  onClose,
  onConfirm,
}: {
  title: string
  selectedCount: number
  totalCount: number
  allowLinkedPractice?: boolean
  busy?: boolean
  onClose: () => void
  onConfirm: (options: PrintPanelOptions) => Promise<void> | void
}) {
  const [scope, setScope] = useState<PrintScope>(selectedCount > 0 ? 'selected' : 'all')
  const [mode, setMode] = useState<PrintableMode>('questions')
  const [includeSolutions, setIncludeSolutions] = useState(false)
  const [includeLinkedPractice, setIncludeLinkedPractice] = useState(false)

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/35 px-4 py-8">
      <div className="mx-auto max-w-lg rounded-3xl bg-white shadow-2xl">
        <div className="border-b border-slate-200 px-6 py-4">
          <div className="text-lg font-semibold">{title}</div>
          <div className="mt-1 text-sm text-slate-500">按 A4 纸张排版，支持题目册和答案册分开打印。</div>
        </div>

        <div className="space-y-5 px-6 py-5 text-sm">
          <section>
            <div className="mb-2 font-medium text-slate-700">打印范围</div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                <input
                  type="radio"
                  checked={scope === 'selected'}
                  disabled={selectedCount === 0}
                  onChange={() => setScope('selected')}
                />
                <span>当前勾选题目{selectedCount > 0 ? `（${selectedCount} 题）` : '（暂无勾选）'}</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                <input type="radio" checked={scope === 'all'} onChange={() => setScope('all')} />
                <span>当前页全部题目（${totalCount} 题）</span>
              </label>
            </div>
          </section>

          <section>
            <div className="mb-2 font-medium text-slate-700">打印内容</div>
            <div className="grid gap-2">
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                <input type="radio" checked={mode === 'questions'} onChange={() => setMode('questions')} />
                <span>只打印题目</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                <input type="radio" checked={mode === 'answers'} onChange={() => setMode('answers')} />
                <span>只打印答案</span>
              </label>
              <label className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-3">
                <input type="radio" checked={mode === 'combined'} onChange={() => setMode('combined')} />
                <span>题目 + 答案一起打印</span>
              </label>
            </div>
          </section>

          <section className="space-y-2">
            {allowLinkedPractice && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={includeLinkedPractice}
                  onChange={(e) => setIncludeLinkedPractice(e.target.checked)}
                />
                <span>连同已生成的举一反三题一起打印</span>
              </label>
            )}
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={includeSolutions}
                onChange={(e) => setIncludeSolutions(e.target.checked)}
              />
              <span>答案页包含解析/思路</span>
            </label>
          </section>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm text-slate-600"
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm({ scope, mode, includeSolutions, includeLinkedPractice })}
            className="rounded-full bg-brand-600 px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy ? '准备打印中...' : '开始打印'}
          </button>
        </div>
      </div>
    </div>
  )
}
