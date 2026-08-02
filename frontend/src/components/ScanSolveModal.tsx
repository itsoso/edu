/**
 * 拍照解题对话框 — 上传题目照片, Vision LLM 识别 + 解答, 可选录入错题本.
 *
 * 流程:
 *  1. 选图 → 压缩 → 上传 → 等待 LLM 返回结果
 *  2. 结果展示: 题目 + 解答 + 步骤
 *  3. "加入错题本" 按钮: 二次调用 API 保存
 */
import { useRef, useState } from 'react'
import { api } from '../api'
import { compressImage } from '../utils/compressImage'
import { useToast } from './Toast'
import MathText from './MathText'

type Result = {
  question_text: string
  subject: string
  knowledge_point: string | null
  difficulty: string
  answer: string
  solution_steps: string
  common_mistakes: string
  mistake_id?: number
}

export default function ScanSolveModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved?: (mistakeId: number) => void
}) {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [saving, setSaving] = useState(false)

  async function handlePick(file: File) {
    setBusy('压缩中...')
    setResult(null)
    try {
      const r = await compressImage(file)
      setBusy('AI 识别解答中(约 10-30 秒)...')
      const res = await api.scanSolveMistake(r.file, false)
      setResult(res)
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.includes('no_question_detected')) {
        toast.error('未识别到题目, 请换一张清晰的照片')
      } else {
        toast.error('解析失败: ' + msg)
      }
    } finally {
      setBusy('')
    }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      // 复用 createMistake, 前端已有表单
      const r = await api.createMistake({
        subject: result.subject,
        exam_name: '拍照解题',
        question_text: result.question_text,
        correct_answer: result.answer,
        reason: result.common_mistakes || '拍照录入待复习',
        knowledge_point: result.knowledge_point,
        solution_steps: result.solution_steps,
      })
      toast.success('已加入错题本')
      onSaved?.(r.id)
      onClose()
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-slate-900/35 px-4 py-8 overflow-auto">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <div className="text-lg font-semibold">📷 拍照解题</div>
            <div className="text-sm text-slate-500 mt-1">
              拍一张题目, AI 给出解答; 不会的可一键录入错题本
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
            ✕
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {!result && (
            <div className="text-center py-6 space-y-3">
              <div className="text-5xl">📸</div>
              <button
                onClick={() => fileRef.current?.click()}
                disabled={!!busy}
                className="px-5 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
              >
                {busy ? busy : '选择题目图片'}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handlePick(f)
                  e.target.value = ''
                }}
              />
              {busy && <div className="text-xs text-brand-600 animate-pulse">{busy}</div>}
            </div>
          )}

          {result && (
            <div className="space-y-4 text-sm">
              <section>
                <div className="text-xs text-slate-500 mb-1 font-medium">题目</div>
                <div className="bg-slate-50 rounded p-3 border border-slate-200">
                  <MathText text={result.question_text} />
                </div>
              </section>

              <div className="flex flex-wrap gap-2 text-xs">
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded">
                  {result.subject}
                </span>
                {result.knowledge_point && (
                  <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                    {result.knowledge_point}
                  </span>
                )}
                <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded">
                  难度: {result.difficulty}
                </span>
              </div>

              <section>
                <div className="text-xs text-slate-500 mb-1 font-medium">答案</div>
                <div className="bg-green-50 rounded p-3 border border-green-200">
                  <MathText text={result.answer} />
                </div>
              </section>

              <section>
                <div className="text-xs text-slate-500 mb-1 font-medium">解题步骤</div>
                <div className="bg-white rounded p-3 border border-slate-200 whitespace-pre-wrap leading-relaxed">
                  <MathText text={result.solution_steps} />
                </div>
              </section>

              {result.common_mistakes && (
                <section>
                  <div className="text-xs text-slate-500 mb-1 font-medium">常见错误点</div>
                  <div className="bg-amber-50 rounded p-3 border border-amber-200 text-amber-900">
                    <MathText text={result.common_mistakes} />
                  </div>
                </section>
              )}

              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => {
                    setResult(null)
                    fileRef.current?.click()
                  }}
                  className="px-4 py-2 border border-slate-300 rounded text-sm hover:bg-slate-50"
                >
                  换一题
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
                >
                  {saving ? '保存中...' : '📝 加入错题本'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
