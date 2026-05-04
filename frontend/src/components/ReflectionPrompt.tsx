/**
 * ReflectionPrompt — P4 "想想看" 元认知伙伴
 *
 * 折叠 details 区, 展开后向后端拉一个针对当前题目的反思性问题,
 * 然后把回答 (走 ReflectionField, 隐私关键) 写入 reflections 表.
 *
 * - source_table/source_id: 后端 reflector 用来生成问题
 * - storeKind: 答案写到哪种 reflection (mistake_note / free_write)
 * - storeRelatedKey: 自由记录用 related_key (如 `pi_${id}`)
 *
 * 设计语言: 复用 brand/slate 色板 + violet 边框, 与其它卡片区分.
 * 调性平静中性, 强调 "只有你能看到, 不会被 AI 分析".
 */
import { useEffect, useState } from 'react'
import { api, ReflectorQuestion, ReflectionKind } from '../api'
import ReflectionField from './ReflectionField'

type Props = {
  sourceTable: 'mistakes' | 'practice_items'
  sourceId: number
  storeKind: 'mistake_note' | 'free_write'
  storeRelatedKey?: string
}

export default function ReflectionPrompt({
  sourceTable,
  sourceId,
  storeKind,
  storeRelatedKey,
}: Props) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [question, setQuestion] = useState<ReflectorQuestion | null>(null)
  const [err, setErr] = useState('')

  async function fetchQuestion() {
    setLoading(true)
    setErr('')
    try {
      const q = await api.reflectorQuestion({
        source_table: sourceTable,
        source_id: sourceId,
      })
      setQuestion(q)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  // 第一次展开时拉问题
  useEffect(() => {
    if (open && !question && !loading && !err) {
      void fetchQuestion()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // ReflectionField 需要的 kind 类型
  const kind: ReflectionKind = storeKind

  // free_write 用 related_key, mistake_note 用 related_id
  const relatedId = storeKind === 'mistake_note' ? sourceId : undefined
  const relatedKey = storeKind === 'free_write' ? storeRelatedKey : undefined

  return (
    <details
      className="mt-3 rounded-lg border border-violet-200 bg-violet-50/40 open:bg-violet-50"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-violet-800 hover:text-violet-900">
        💭 想想看 — 回答只有你能看到, 不会被 AI 分析
      </summary>

      <div className="border-t border-violet-200 px-3 py-3 space-y-3">
        {loading && (
          <div className="text-xs text-slate-500">正在为你想一个问题…</div>
        )}

        {err && !loading && (
          <div className="space-y-2">
            <div className="text-xs text-red-600">问题加载失败: {err}</div>
            <button
              onClick={fetchQuestion}
              className="text-xs px-2 py-1 border border-slate-300 rounded hover:bg-slate-50"
            >
              重试
            </button>
          </div>
        )}

        {!loading && !err && question && (
          <>
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-relaxed text-slate-700 flex-1">
                {question.question}
              </p>
              <button
                onClick={fetchQuestion}
                className="shrink-0 text-[11px] text-violet-600 hover:text-violet-800 whitespace-nowrap"
                title="换一个问题"
              >
                换一个
              </button>
            </div>

            <ReflectionField
              kind={kind}
              relatedId={relatedId}
              relatedKey={relatedKey}
              label="我的回答"
              placeholder="想到什么写什么, 没有标准答案."
              collapsible={false}
            />
          </>
        )}
      </div>
    </details>
  )
}
