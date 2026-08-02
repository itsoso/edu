/**
 * 作文管理页 — 多来源录入 + 分类 + AI 批改.
 *
 * 三种录入: 📸 拍照上传 / 📄 导入 Word / ✍️ 粘贴文本
 * 左侧列表 (过滤+分页) + 右侧详情 (正文+批改)
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { api, Essay } from '../api'
import { usePolling } from '../hooks/usePolling'
import { useToast } from '../components/Toast'
import EmptyState from '../components/EmptyState'
import { compressImage, formatBytes } from '../utils/compressImage'
import signals from '../lib/signals'

const EssayAnalysisView = lazy(() => import('../components/EssayAnalysisView'))

type InputTab = 'photo' | 'document' | 'text'
const ESSAY_TYPES = ['记叙文', '议论文', '说明文', '应用文']
const PAGE_SIZE = 20

export default function Essays() {
  const toast = useToast()
  const photoRef = useRef<HTMLInputElement>(null)
  const docRef = useRef<HTMLInputElement>(null)

  const [essays, setEssays] = useState<Essay[]>([])
  const [total, setTotal] = useState(0)
  const [active, setActive] = useState<Essay | null>(null)
  const [tab, setTab] = useState<InputTab>('text')
  const [busy, setBusy] = useState('')

  // 范文 (按需生成, 不持久化)
  const [model, setModel] = useState<{
    title: string
    content: string
    highlights: string[]
    structure_note: string
  } | null>(null)
  const [modelBusy, setModelBusy] = useState(false)

  // 过滤
  const [filterType, setFilterType] = useState('')
  const [searchQ, setSearchQ] = useState('')

  // 文本输入
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [textType, setTextType] = useState('')
  const [textTopic, setTextTopic] = useState('')

  // 编辑
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editTopic, setEditTopic] = useState('')

  async function reload() {
    try {
      const r = await api.listEssays({
        essay_type: filterType || undefined,
        q: searchQ || undefined,
        limit: PAGE_SIZE,
      })
      setEssays(r.items)
      setTotal(r.total)
      if (active) {
        const u = r.items.find((e) => e.id === active.id)
        if (u) setActive(u)
      }
    } catch (e: any) {
      toast.error('加载失败: ' + (e.message || e))
    }
  }

  useEffect(() => { reload() }, [filterType, searchQ])

  // 轮询 OCR / 分析状态
  const isProcessing = active?.status === 'ocr_processing' || active?.status === 'analyzing'
  usePolling(
    async () => {
      if (!active) return null
      const u = await api.getEssay(active.id)
      setActive(u)
      if (u.status !== 'ocr_processing' && u.status !== 'analyzing') reload()
      return u
    },
    (u: any) => !!u && (u.status === 'ocr_processing' || u.status === 'analyzing'),
    { interval: 3000, enabled: !!active && isProcessing }
  )

  // ---- 上传照片 (支持多张, 最多 9 张) ----
  async function handlePhotos(rawFiles: File[]) {
    if (rawFiles.length === 0) return
    if (rawFiles.length > 9) {
      toast.error('最多 9 张')
      return
    }
    setBusy(`压缩 ${rawFiles.length} 张...`)
    try {
      const compressed: File[] = []
      let totalSize = 0
      for (let i = 0; i < rawFiles.length; i++) {
        setBusy(`压缩 ${i + 1}/${rawFiles.length}...`)
        const r = await compressImage(rawFiles[i])
        compressed.push(r.file)
        totalSize += r.compressedSize
      }
      setBusy(`上传 ${compressed.length} 张 (${formatBytes(totalSize)})...`)
      const essay = await api.uploadEssayFile(compressed, 'photo')
      signals.track('essay.create', {
        related_table: 'essays',
        related_id: essay.id,
        payload: { source_type: 'photo', word_count: essay.word_count || 0, pages: compressed.length },
      })
      setActive(essay)
      toast.info(
        compressed.length > 1
          ? `${compressed.length} 张已上传, 点"识别文字"按顺序拼接`
          : '照片已上传, 点"识别文字"提取正文'
      )
      reload()
    } catch (e: any) {
      toast.error('上传失败: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  // ---- 上传 Word ----
  async function handleDoc(file: File) {
    setBusy('解析 Word...')
    try {
      const essay = await api.uploadEssayFile(file, 'document')
      signals.track('essay.create', {
        related_table: 'essays',
        related_id: essay.id,
        payload: { source_type: 'document', word_count: essay.word_count || 0 },
      })
      setActive(essay)
      toast.success(`导入成功, ${essay.word_count} 字`)
      reload()
    } catch (e: any) {
      toast.error('导入失败: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  // ---- 粘贴文本 ----
  async function handleTextSubmit() {
    if (!textContent.trim()) {
      toast.error('作文内容不能为空')
      return
    }
    setBusy('保存中...')
    try {
      const essay = await api.createEssayFromText({
        content: textContent.trim(),
        title: textTitle.trim() || undefined,
        essay_type: textType || undefined,
        topic: textTopic.trim() || undefined,
      })
      signals.track('essay.create', {
        related_table: 'essays',
        related_id: essay.id,
        payload: { source_type: 'text', word_count: essay.word_count || 0 },
      })
      setActive(essay)
      setTextContent(''); setTextTitle(''); setTextType(''); setTextTopic('')
      toast.success('保存成功')
      reload()
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    } finally {
      setBusy('')
    }
  }

  async function triggerOcr() {
    if (!active) return
    try {
      const u = await api.triggerEssayOcr(active.id)
      setActive(u)
    } catch (e: any) {
      toast.error('OCR 失败: ' + (e.message || e))
    }
  }

  async function triggerAnalysis() {
    if (!active) return
    try {
      const u = await api.triggerEssayAnalysis(active.id)
      setActive(u)
    } catch (e: any) {
      toast.error('批改失败: ' + (e.message || e))
    }
  }

  async function startEdit() {
    if (!active) return
    setEditTitle(active.title || '')
    setEditType(active.essay_type || '')
    setEditTopic(active.topic || '')
    setEditing(true)
  }

  async function saveEdit() {
    if (!active) return
    try {
      const u = await api.updateEssay(active.id, {
        title: editTitle.trim() || undefined,
        essay_type: editType || undefined,
        topic: editTopic.trim() || undefined,
      })
      setActive(u)
      setEditing(false)
      reload()
      toast.success('已更新')
    } catch (e: any) {
      toast.error('更新失败')
    }
  }

  async function remove(id: number) {
    if (!confirm('删除这篇作文?')) return
    try {
      await api.deleteEssay(id)
      if (active?.id === id) setActive(null)
      reload()
    } catch (e: any) {
      toast.error('删除失败')
    }
  }

  const TABS: { key: InputTab; icon: string; label: string }[] = [
    { key: 'photo', icon: '📸', label: '拍照上传' },
    { key: 'document', icon: '📄', label: '导入 Word' },
    { key: 'text', icon: '✍️', label: '粘贴文本' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">作文管理</h1>
        <p className="text-slate-500 mt-1 text-sm">收集 · 分类 · AI 批改</p>
      </div>

      {/* 录入区 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="flex border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-2.5 text-sm font-medium transition ${
                tab === t.key
                  ? 'bg-brand-50 text-brand-700 border-b-2 border-brand-600'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {busy && <div className="text-sm text-brand-700 animate-pulse mb-2">{busy}</div>}

          {tab === 'photo' && (
            <div className="text-center py-4 space-y-3">
              <div className="text-4xl">📸</div>
              <div className="text-sm text-slate-600">
                可一次选最多 9 张, AI 会按顺序拼接为一篇作文
              </div>
              <button
                onClick={() => photoRef.current?.click()}
                disabled={!!busy}
                className="px-5 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
              >
                选择图片
              </button>
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  const list = e.target.files ? Array.from(e.target.files) : []
                  if (list.length) handlePhotos(list)
                  e.target.value = ''
                }}
              />
            </div>
          )}

          {tab === 'document' && (
            <div className="text-center py-4 space-y-3">
              <div className="text-4xl">📄</div>
              <div className="text-sm text-slate-600">支持 .docx (WPS / Word)</div>
              <button
                onClick={() => docRef.current?.click()}
                disabled={!!busy}
                className="px-5 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
              >
                选择文件
              </button>
              <input
                ref={docRef}
                type="file"
                accept=".docx,.doc"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleDoc(f)
                  e.target.value = ''
                }}
              />
            </div>
          )}

          {tab === 'text' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                <input
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                  placeholder="标题 (可选)"
                  value={textTitle}
                  onChange={(e) => setTextTitle(e.target.value)}
                />
                <select
                  className="border border-slate-300 rounded px-3 py-2 text-sm"
                  value={textType}
                  onChange={(e) => setTextType(e.target.value)}
                >
                  <option value="">类型 (可选)</option>
                  {ESSAY_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <input
                  className="md:col-span-2 border border-slate-300 rounded px-3 py-2 text-sm"
                  placeholder="话题 (可选, 如: 成长/亲情)"
                  value={textTopic}
                  onChange={(e) => setTextTopic(e.target.value)}
                />
              </div>
              <textarea
                value={textContent}
                onChange={(e) => setTextContent(e.target.value)}
                placeholder="在这里粘贴作文全文..."
                rows={8}
                maxLength={10000}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">
                  {textContent.replace(/\s/g, '').length} 字
                </span>
                <button
                  onClick={handleTextSubmit}
                  disabled={!!busy || !textContent.trim()}
                  className="px-4 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
                >
                  保存
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 过滤 */}
      <div className="flex gap-2 items-center text-sm flex-wrap">
        <select
          className="border border-slate-300 rounded px-2 py-1"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
        >
          <option value="">全部类型</option>
          {ESSAY_TYPES.map((t) => <option key={t}>{t}</option>)}
        </select>
        <input
          className="border border-slate-300 rounded px-2 py-1 flex-1 max-w-xs"
          placeholder="搜索标题或内容..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
        />
        <span className="text-xs text-slate-500">共 {total} 篇</span>
      </div>

      {/* 主体: 列表 + 详情 */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        {/* 列表 */}
        <aside className="md:col-span-2 space-y-2">
          {essays.length === 0 ? (
            <EmptyState
              variant="inline"
              icon="📝"
              title="还没有作文"
              description="上传照片、导入 Word、或直接粘贴"
            />
          ) : (
            essays.map((e) => (
              <button
                key={e.id}
                onClick={() => { setActive(e); setEditing(false); setModel(null) }}
                className={`w-full text-left px-3 py-3 rounded-lg border text-sm hover:bg-slate-50 ${
                  active?.id === e.id ? 'bg-brand-50 border-brand-200' : 'bg-white border-slate-200'
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  {e.essay_type && (
                    <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">
                      {e.essay_type}
                    </span>
                  )}
                  {e.analysis && (
                    <span className={`text-xs font-bold ${
                      (e.analysis as any).score >= 80 ? 'text-green-600' :
                      (e.analysis as any).score >= 60 ? 'text-brand-700' : 'text-amber-600'
                    }`}>
                      {(e.analysis as any).score}分
                    </span>
                  )}
                  <span className="text-xs text-slate-400 ml-auto">
                    {e.word_count} 字
                  </span>
                </div>
                <div className="font-medium truncate">
                  {e.title || e.content?.slice(0, 30) || `#${e.id}`}
                </div>
                <div className="text-xs text-slate-400 mt-0.5">
                  {e.source_type === 'photo' ? '📸' : e.source_type === 'document' ? '📄' : '✍️'}
                  {' '}{new Date(e.created_at).toLocaleDateString()}
                  {e.topic && ` · ${e.topic}`}
                </div>
              </button>
            ))
          )}
        </aside>

        {/* 详情 */}
        <section className="md:col-span-3">
          {!active ? (
            <EmptyState icon="👈" title="选一篇作文" description="或者从上方录入新的" />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
              {/* 头部 */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  {editing ? (
                    <div className="space-y-2">
                      <input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="标题"
                        className="w-full border border-slate-300 rounded px-3 py-2 text-sm font-semibold"
                      />
                      <div className="flex gap-2">
                        <select
                          value={editType}
                          onChange={(e) => setEditType(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-sm"
                        >
                          <option value="">类型</option>
                          {ESSAY_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                        <input
                          value={editTopic}
                          onChange={(e) => setEditTopic(e.target.value)}
                          placeholder="话题"
                          className="border border-slate-300 rounded px-2 py-1 text-sm flex-1"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button onClick={saveEdit} className="px-3 py-1 text-sm bg-brand-600 text-white rounded">保存</button>
                        <button onClick={() => setEditing(false)} className="px-3 py-1 text-sm border border-slate-300 rounded">取消</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-lg font-semibold">
                        {active.title || '(无标题)'}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                        {active.essay_type && <span className="px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded">{active.essay_type}</span>}
                        {active.topic && <span>{active.topic}</span>}
                        <span>{active.word_count} 字</span>
                        <span>{active.source_type === 'photo' ? '📸 拍照' : active.source_type === 'document' ? '📄 Word' : '✍️ 粘贴'}</span>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex gap-1">
                  {!editing && <button onClick={startEdit} className="text-xs text-slate-500 hover:text-brand-600">编辑</button>}
                  <button onClick={() => remove(active.id)} className="text-xs text-red-500 hover:text-red-700">删除</button>
                </div>
              </div>

              {/* 状态操作 */}
              <div className="flex gap-2 flex-wrap items-center">
                {active.source_type === 'photo' && active.status === 'uploaded' && (
                  <button onClick={triggerOcr} disabled={isProcessing} className="px-3 py-1.5 text-sm bg-brand-600 text-white rounded disabled:opacity-50">
                    🔍 识别文字 (OCR)
                  </button>
                )}
                {active.status === 'ocr_processing' && (
                  <span className="text-sm text-brand-700 animate-pulse">⏳ 正在识别文字...</span>
                )}
                {(active.status === 'ocr_done' || (active.content && active.status !== 'analyzing' && active.status !== 'analyzed')) && (
                  <button onClick={triggerAnalysis} disabled={isProcessing} className="px-3 py-1.5 text-sm bg-purple-600 text-white rounded disabled:opacity-50">
                    🧠 AI 批改
                  </button>
                )}
                {active.status === 'analyzing' && (
                  <span className="text-sm text-purple-700 animate-pulse">⏳ AI 批改中...</span>
                )}
                {active.status === 'analyzed' && (
                  <button onClick={triggerAnalysis} className="px-3 py-1.5 text-sm border border-slate-300 rounded text-slate-600">
                    🔄 重新批改
                  </button>
                )}
                {active.status === 'failed' && (
                  <span className="text-xs text-red-600">失败: {active.error_message?.slice(0, 100)}</span>
                )}
              </div>

              {/* 原图 (photo 来源) */}
              {active.source_type === 'photo' && (active.file_urls?.length || active.file_url) ? (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {(active.file_urls?.length ? active.file_urls : [active.file_url!]).map((url, index) => (
                    <img
                      key={url}
                      src={url}
                      alt={`作文第 ${index + 1} 页`}
                      className="max-h-48 shrink-0 rounded border border-slate-200 object-contain"
                    />
                  ))}
                </div>
              ) : null}

              {/* 正文 */}
              {active.content && (
                <div className="border border-slate-200 rounded p-4">
                  <div className="text-xs text-slate-500 mb-2">正文 ({active.word_count} 字)</div>
                  <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
                    {active.content}
                  </div>
                </div>
              )}

              {/* AI 批改结果 */}
              {active.analysis && (
                <div>
                  <div className="text-sm font-semibold text-purple-700 mb-2">AI 批改结果</div>
                  <Suspense fallback={<div className="text-sm text-slate-400">加载中...</div>}>
                    <EssayAnalysisView a={active.analysis} />
                  </Suspense>
                </div>
              )}

              {/* 同主题范文 (按需生成) */}
              {active.content && active.status !== 'analyzing' && active.status !== 'ocr_processing' && (
                <div className="border border-emerald-200 bg-emerald-50/50 rounded p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold text-emerald-700">📖 同主题范文参考</div>
                    {!model ? (
                      <button
                        onClick={async () => {
                          setModelBusy(true)
                          try {
                            const r = await api.generateEssayModel(active.id)
                            setModel(r)
                          } catch (e: any) {
                            toast.error('生成范文失败: ' + (e.message || e))
                          } finally {
                            setModelBusy(false)
                          }
                        }}
                        disabled={modelBusy}
                        className="px-3 py-1.5 text-xs bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
                      >
                        {modelBusy ? '生成中(约 20 秒)...' : '生成一篇范文'}
                      </button>
                    ) : (
                      <button
                        onClick={() => setModel(null)}
                        className="text-xs text-slate-500 hover:text-slate-700"
                      >
                        收起
                      </button>
                    )}
                  </div>
                  {!model && !modelBusy && (
                    <div className="text-xs text-slate-500">
                      让 AI 写一篇与你这篇作文同主题、同类型的优秀范文,可以学习它的结构和细节描写
                    </div>
                  )}
                  {model && (
                    <div className="space-y-3 text-sm">
                      <div className="font-bold text-base text-slate-900">{model.title}</div>
                      {model.structure_note && (
                        <div className="text-xs text-slate-500 bg-white rounded px-2 py-1.5 border border-slate-200">
                          🧱 {model.structure_note}
                        </div>
                      )}
                      <div className="text-slate-800 whitespace-pre-wrap leading-relaxed bg-white rounded p-3 border border-slate-200 max-h-96 overflow-y-auto">
                        {model.content}
                      </div>
                      {model.highlights.length > 0 && (
                        <div className="bg-amber-50 border border-amber-200 rounded p-3">
                          <div className="text-xs font-semibold text-amber-900 mb-1">✨ 可学习要点</div>
                          <ul className="list-disc pl-5 space-y-0.5 text-xs text-amber-900">
                            {model.highlights.map((h, i) => (
                              <li key={i}>{h}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
