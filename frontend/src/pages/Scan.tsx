import { useEffect, useRef, useState } from 'react'
import { api, ExamUpload, ExtractedMistake } from '../api'
import { compressImage, stitchImagesVertical, formatBytes } from '../utils/compressImage'
import { usePolling } from '../hooks/usePolling'
import { useToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'

export default function Scan() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploads, setUploads] = useState<ExamUpload[]>([])
  const [examName, setExamName] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [active, setActive] = useState<ExamUpload | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [llmReady, setLlmReady] = useState<boolean | null>(null)

  async function reload() {
    try {
      const [list, status] = await Promise.all([api.listUploads(), api.llmStatus()])
      setUploads(list)
      setLlmReady(status.configured)
      if (active) {
        const u = list.find((x) => x.id === active.id)
        if (u) setActive(u)
      }
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // 当 active 处于 extracting/analyzing 状态时, 启动轮询
  const isProcessing =
    active?.status === 'extracting' || active?.status === 'analyzing'
  usePolling(
    async () => {
      if (!active) return null
      const u = await api.getUpload(active.id)
      setActive(u)
      return u
    },
    (u: any) => !!u && (u.status === 'extracting' || u.status === 'analyzing'),
    { interval: 2500, enabled: !!active && isProcessing }
  )

  async function upload(files: File[]) {
    if (files.length === 0) return
    setErr('')
    try {
      const multiple = files.length > 1
      if (multiple) {
        setBusy(`拼接 ${files.length} 张图中...`)
      } else {
        setBusy(`压缩图片中... (${formatBytes(files[0].size)})`)
      }
      const result = multiple
        ? await stitchImagesVertical(files)
        : await compressImage(files[0])
      const ratio = (result.compressedSize / result.originalSize) * 100
      setBusy(
        (multiple ? `上传拼接图 (${files.length} 页)... ` : '上传中... ') +
          `${formatBytes(result.originalSize)} → ${formatBytes(result.compressedSize)} (${ratio.toFixed(0)}%)`
      )
      const u = await api.uploadExamImage(result.file, examName || undefined)
      setExamName('')
      setActive(u)
      setSelected(new Set())
      await reload()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy('')
    }
  }

  async function extract() {
    if (!active) return
    setErr('')
    try {
      // 立即返回 status=extracting, 之后 usePolling 自动轮询到 done/failed
      const u = await api.extractMistakes(active.id)
      setActive(u)
      setSelected(new Set())
      await reload()
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  async function analyze() {
    if (!active) return
    setErr('')
    try {
      const u = await api.analyzeUpload(active.id)
      setActive(u)
      await reload()
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  // 识别刚完成时自动选中所有错题
  useEffect(() => {
    if (active?.status === 'extracted' && active.extracted?.mistakes?.length) {
      setSelected(new Set(active.extracted.mistakes.map((_, i) => i)))
    }
  }, [active?.id, active?.status, active?.extracted?.mistakes?.length])

  async function save() {
    if (!active) return
    if (selected.size === 0) {
      toast.error('请至少选择一道要保存的错题')
      return
    }
    setBusy('保存中...')
    try {
      const res = await api.saveExtractedMistakes(active.id, Array.from(selected))
      toast.success(`已保存 ${res.saved} 道错题到错题本`)
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function remove(id: number) {
    if (!confirm('删除这份试卷？错题本里已保存的错题不会被删除')) return
    await api.deleteUpload(id)
    if (active?.id === id) setActive(null)
    reload()
  }

  const mistakes = active?.extracted?.mistakes || []
  const analysis = active?.analysis

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">试卷扫描</h1>
        <p className="text-slate-500 mt-1 text-sm">拍照上传 → AI 识别错题 → 全卷分析 → 二次训练</p>
      </div>

      {llmReady === false && (
        <div className="bg-amber-50 border border-amber-300 text-amber-800 rounded px-4 py-3 text-sm">
          ⚠️ AI 服务尚未配置（EDU_LLM_API_KEY 缺失），上传后无法调用识别。请联系管理员。
        </div>
      )}

      {/* 上传区 */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
        <div className="text-xs text-slate-500">
          💡 一次可选多张试卷页, 系统会自动拼接成一张后再识别
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <input
            className="md:col-span-2 border border-slate-300 rounded px-3 py-2 text-sm"
            placeholder="考试名称 (可选, 如: 5月月考)"
            value={examName}
            onChange={(e) => setExamName(e.target.value)}
          />
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || [])
              if (files.length > 0) upload(files)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={!!busy}
            className="px-4 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
          >
            📸 拍照 / 选图 (支持多张)
          </button>
        </div>
        {busy && <div className="text-sm text-brand-700">{busy}</div>}
        {err && <div className="text-sm text-red-600">{err}</div>}
      </div>

      {/* 历史 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <aside className="md:col-span-2 bg-white border border-slate-200 rounded-lg p-3">
          <div className="text-xs text-slate-500 px-1 pb-2">历史上传</div>
          {uploads.length === 0 ? (
            <EmptyState
              variant="inline"
              icon="📸"
              title="还没有上传记录"
              description="上传一张试卷, AI 会帮你挑出所有错题"
            />
          ) : (
            <ul className="space-y-1 max-h-96 overflow-y-auto">
              {uploads.map((u) => (
                <li key={u.id}>
                  <button
                    onClick={() => {
                      setActive(u)
                      setSelected(new Set(u.extracted?.mistakes?.map((_, i) => i) || []))
                    }}
                    className={`w-full text-left px-3 py-2 rounded text-sm hover:bg-slate-50 ${
                      active?.id === u.id ? 'bg-brand-50 border border-brand-200' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs px-1.5 py-0.5 bg-slate-100 rounded">
                        {statusLabel(u.status)}
                      </span>
                      <span className="truncate font-medium">
                        {u.exam_name || u.file_name || `#${u.id}`}
                      </span>
                    </div>
                    <div className="text-xs text-slate-400 mt-0.5">
                      {u.subject || ''} · {new Date(u.created_at).toLocaleDateString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </aside>

        {/* 详情 */}
        <section className="md:col-span-3 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          {!active ? (
            <EmptyState
              icon="🗂️"
              title="选一份历史上传"
              description="或者上传新的试卷"
            />
          ) : (
            <>
              <div className="flex items-start gap-3">
                <img
                  src={active.image_url}
                  alt=""
                  className="w-32 h-32 object-cover rounded border border-slate-200"
                />
                <div className="flex-1 min-w-0">
                  <div className="font-semibold">
                    {active.exam_name || active.file_name}
                  </div>
                  <div className="text-xs text-slate-500 mt-0.5">
                    {active.subject || '未识别科目'} ·
                    {new Date(active.created_at).toLocaleString()}
                  </div>
                  <div className="text-xs mt-1">
                    状态: <span className="font-medium">{statusLabel(active.status)}</span>
                  </div>
                  {active.error_message && (
                    <div className="text-xs text-red-600 mt-1">错误: {active.error_message}</div>
                  )}
                </div>
                <button
                  onClick={() => remove(active.id)}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  删除
                </button>
              </div>

              <div className="flex gap-2 flex-wrap items-center">
                <button
                  onClick={extract}
                  disabled={!!busy || llmReady === false || isProcessing}
                  className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded disabled:opacity-50"
                >
                  {active?.status === 'extracting'
                    ? '⏳ 识别中...'
                    : mistakes.length
                    ? '🔄 重新识别'
                    : '🔍 识别错题'}
                </button>
                <button
                  onClick={analyze}
                  disabled={!!busy || llmReady === false || isProcessing}
                  className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded disabled:opacity-50"
                >
                  {active?.status === 'analyzing'
                    ? '⏳ 分析中...'
                    : analysis
                    ? '🔄 重新分析'
                    : '📊 全卷分析'}
                </button>
                {isProcessing && (
                  <span className="text-xs text-slate-500">
                    AI 处理大约 10-40 秒, 你可以切到其他页面, 稍后回来看结果
                  </span>
                )}
              </div>

              {/* 错题列表 */}
              {mistakes.length > 0 && (
                <div className="space-y-2">
                  <div className="text-sm font-semibold">
                    识别到 {mistakes.length} 道错题
                    <button
                      onClick={() =>
                        setSelected(
                          selected.size === mistakes.length
                            ? new Set()
                            : new Set(mistakes.map((_, i) => i))
                        )
                      }
                      className="ml-2 text-xs text-brand-600 font-normal"
                    >
                      {selected.size === mistakes.length ? '取消全选' : '全选'}
                    </button>
                  </div>
                  {mistakes.map((m, i) => (
                    <MistakeCard
                      key={i}
                      m={m}
                      checked={selected.has(i)}
                      onToggle={() => {
                        const s = new Set(selected)
                        s.has(i) ? s.delete(i) : s.add(i)
                        setSelected(s)
                      }}
                    />
                  ))}
                  <button
                    onClick={save}
                    disabled={!!busy || selected.size === 0}
                    className="w-full mt-2 py-2 bg-green-600 text-white rounded text-sm disabled:opacity-50"
                  >
                    💾 保存选中的 {selected.size} 道到错题本
                  </button>
                </div>
              )}

              {/* 全卷分析 */}
              {analysis && (
                <div className="space-y-2 border-t border-slate-100 pt-4">
                  <div className="text-sm font-semibold">全卷分析</div>
                  <AnalysisView a={analysis} />
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function statusLabel(s: string) {
  return (
    {
      uploaded: '待识别',
      extracting: '识别中...',
      extracted: '已识别',
      analyzing: '分析中...',
      analyzed: '已分析',
      failed: '失败',
    } as Record<string, string>
  )[s] || s
}

function MistakeCard({
  m, checked, onToggle,
}: { m: ExtractedMistake; checked: boolean; onToggle: () => void }) {
  return (
    <div
      className={`border rounded p-3 text-sm cursor-pointer ${
        checked ? 'bg-green-50 border-green-200' : 'bg-slate-50 border-slate-200'
      }`}
      onClick={onToggle}
    >
      <div className="flex items-start gap-2">
        <input type="checkbox" checked={checked} onChange={onToggle} className="mt-1" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="font-semibold">{m.question_number || '题'}</span>
            {m.reason_guess && (
              <span className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded">{m.reason_guess}</span>
            )}
            {m.knowledge_point && (
              <span className="text-slate-500">· {m.knowledge_point}</span>
            )}
            {m.confidence !== undefined && (
              <span className="text-slate-400 ml-auto">置信度 {(m.confidence * 100).toFixed(0)}%</span>
            )}
          </div>
          <div className="mt-1">{m.question_text}</div>
          <div className="mt-1 text-xs space-y-0.5 text-slate-600">
            {m.wrong_answer && (
              <div>错: <span className="text-red-500">{m.wrong_answer}</span></div>
            )}
            {m.correct_answer && (
              <div>对: <span className="text-green-600">{m.correct_answer}</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function AnalysisView({ a }: { a: any }) {
  return (
    <div className="bg-purple-50 border border-purple-200 rounded p-3 text-sm space-y-2">
      {a.estimated_score && <div>估分: <b>{a.estimated_score}</b></div>}
      {a.priority_focus && (
        <div>
          <b>最该专攻:</b> {a.priority_focus}
        </div>
      )}
      {a.strengths?.length > 0 && (
        <div>
          <b>亮点:</b>
          <ul className="list-disc pl-5 text-slate-700 mt-1">
            {a.strengths.map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {a.weaknesses?.length > 0 && (
        <div>
          <b>薄弱点:</b>
          <ul className="list-disc pl-5 text-slate-700 mt-1">
            {a.weaknesses.map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {a.knowledge_gaps?.length > 0 && (
        <div>
          <b>需要补的知识点:</b>
          <ul className="list-disc pl-5 text-slate-700 mt-1">
            {a.knowledge_gaps.map((s: string, i: number) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {a.advice && (
        <div>
          <b>建议:</b>
          <p className="text-slate-700 mt-1 leading-relaxed">{a.advice}</p>
        </div>
      )}
    </div>
  )
}
