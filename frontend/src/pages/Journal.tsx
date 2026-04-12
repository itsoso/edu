/**
 * Journal — 她的声音时间流 + 多媒体录制.
 *
 * 三种输入模式: 文字 | 录音 | 视频
 * 时间流合并: free_write + weekly_note + exam_feeling + 附带的 media
 *
 * 核心原则:
 * - 文字 (reflections.content) 永远不被 AI 分析
 * - 音视频 (journal_media) 可以在用户显式 opt-in 后被 AI 分析
 * - 每条 entry 都只有她自己看得到
 */
import { useEffect, useRef, useState } from 'react'
import { api, Reflection, JournalMedia } from '../api'
import EmptyState from '../components/EmptyState'
import { useToast } from '../components/Toast'
import MediaRecorderComponent from '../components/MediaRecorder'
import MediaPlayer from '../components/MediaPlayer'

type InputTab = 'text' | 'audio' | 'video'

type TimelineEntry = {
  type: 'reflection' | 'media'
  sortKey: string // created_at
  reflection?: Reflection
  media?: JournalMedia
}

export default function Journal() {
  const toast = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<InputTab>('text')
  const [items, setItems] = useState<TimelineEntry[]>([])
  const [newContent, setNewContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [recording, setRecording] = useState(false)
  const [uploading, setUploading] = useState(false)

  async function reload() {
    try {
      const [free, weekly, examF, media] = await Promise.all([
        api.listReflections({ kind: 'free_write', limit: 100 }),
        api.listReflections({ kind: 'weekly_note', limit: 20 }),
        api.listReflections({ kind: 'exam_feeling', limit: 20 }),
        api.listJournalMedia(),
      ])

      // 合并 reflections + media 成统一时间流
      const entries: TimelineEntry[] = []
      for (const r of [...free, ...weekly, ...examF]) {
        entries.push({ type: 'reflection', sortKey: r.created_at, reflection: r })
      }
      for (const m of media) {
        entries.push({ type: 'media', sortKey: m.created_at, media: m })
      }
      entries.sort((a, b) => b.sortKey.localeCompare(a.sortKey))
      setItems(entries)
      setLoaded(true)
    } catch (e: any) {
      toast.error('加载失败: ' + (e.message || e))
      setLoaded(true)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // ---- 文字提交 ----
  async function submitText() {
    const content = newContent.trim()
    if (!content) return
    setSaving(true)
    try {
      await api.upsertReflection({ kind: 'free_write', content })
      setNewContent('')
      toast.success('写下了')
      reload()
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  // ---- 录制完成 → 上传 ----
  async function handleRecordingComplete(blob: Blob, durationSecs: number) {
    setRecording(false)
    setUploading(true)
    const mediaType = tab === 'audio' ? 'audio' : 'video'
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm'
    const file = new File([blob], `${mediaType}-${Date.now()}.${ext}`, {
      type: blob.type,
    })
    try {
      await api.uploadJournalMedia(file, mediaType, { durationSecs })
      toast.success(`${mediaType === 'audio' ? '录音' : '视频'}已保存`)
      reload()
    } catch (e: any) {
      toast.error('上传失败: ' + (e.message || e))
    } finally {
      setUploading(false)
      setTab('text')
    }
  }

  // ---- 选择视频文件上传 ----
  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    // 简单的时长检查 (通过 video 元素)
    const url = URL.createObjectURL(file)
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.src = url
    await new Promise((r) => (video.onloadedmetadata = r))
    const dur = Math.round(video.duration)
    URL.revokeObjectURL(url)

    if (dur > 120) {
      toast.error(`视频 ${dur} 秒, 超过 2 分钟上限`)
      return
    }
    if (file.size > 20 * 1024 * 1024) {
      toast.error(`文件 ${(file.size / 1024 / 1024).toFixed(1)} MB, 超过 20MB 上限`)
      return
    }

    setUploading(true)
    try {
      await api.uploadJournalMedia(file, 'video', { durationSecs: dur })
      toast.success('视频已保存')
      reload()
    } catch (e: any) {
      toast.error('上传失败: ' + (e.message || e))
    } finally {
      setUploading(false)
    }
  }

  // ---- 删除 ----
  async function removeReflection(id: number) {
    if (!confirm('删除这条? 不可恢复')) return
    try {
      await api.deleteReflection(id)
      reload()
    } catch (e: any) {
      toast.error('删除失败: ' + (e.message || e))
    }
  }

  async function removeMedia(id: number) {
    if (!confirm('删除这段录制? 不可恢复')) return
    try {
      await api.deleteJournalMedia(id)
      reload()
    } catch (e: any) {
      toast.error('删除失败: ' + (e.message || e))
    }
  }

  const TABS: { key: InputTab; icon: string; label: string }[] = [
    { key: 'text', icon: '✍️', label: '文字' },
    { key: 'audio', icon: '🎙️', label: '录音' },
    { key: 'video', icon: '📹', label: '视频' },
  ]

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">日记</h1>
        <p className="text-slate-500 mt-1 text-sm">
          文字永远不被 AI 分析 · 音视频可选 AI 分析 · 只有你自己看得到
        </p>
      </div>

      {/* 输入区 */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        {/* Tab 切换 */}
        <div className="flex border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => {
                if (recording) return // 录制中不能切 tab
                setTab(t.key)
              }}
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
          {/* 文字 tab */}
          {tab === 'text' && (
            <div className="space-y-2">
              <textarea
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                placeholder="一句话、一段话、一个吐槽、一个困惑, 都可以."
                rows={4}
                maxLength={2000}
                className="w-full border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-slate-400">{newContent.length} / 2000</span>
                <button
                  onClick={submitText}
                  disabled={saving || !newContent.trim()}
                  className="px-4 py-1.5 text-sm bg-brand-600 text-white rounded disabled:opacity-50"
                >
                  {saving ? '保存中...' : '写下'}
                </button>
              </div>
            </div>
          )}

          {/* 录音 tab */}
          {tab === 'audio' && (
            <div>
              {uploading ? (
                <div className="text-sm text-brand-700 animate-pulse py-8 text-center">
                  上传录音中...
                </div>
              ) : recording ? (
                <MediaRecorderComponent
                  mode="audio"
                  maxDurationSecs={180}
                  onRecordingComplete={handleRecordingComplete}
                  onCancel={() => {
                    setRecording(false)
                    setTab('text')
                  }}
                />
              ) : (
                <div className="text-center py-6 space-y-3">
                  <div className="text-4xl">🎙️</div>
                  <div className="text-sm text-slate-600">录一段语音日记, 最长 3 分钟</div>
                  <button
                    onClick={() => setRecording(true)}
                    className="px-6 py-3 bg-red-600 text-white rounded-full text-sm font-medium"
                  >
                    开始录音
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 视频 tab */}
          {tab === 'video' && (
            <div>
              {uploading ? (
                <div className="text-sm text-brand-700 animate-pulse py-8 text-center">
                  上传视频中...
                </div>
              ) : recording ? (
                <MediaRecorderComponent
                  mode="video"
                  maxDurationSecs={120}
                  onRecordingComplete={handleRecordingComplete}
                  onCancel={() => {
                    setRecording(false)
                    setTab('text')
                  }}
                />
              ) : (
                <div className="text-center py-6 space-y-3">
                  <div className="text-4xl">📹</div>
                  <div className="text-sm text-slate-600">录一段视频或选择已有文件, 最长 2 分钟</div>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={() => setRecording(true)}
                      className="px-5 py-3 bg-red-600 text-white rounded-full text-sm font-medium"
                    >
                      开始录像
                    </button>
                    <button
                      onClick={() => fileRef.current?.click()}
                      className="px-5 py-3 border border-slate-300 rounded-full text-sm text-slate-600"
                    >
                      选择文件
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="video/*"
                      className="hidden"
                      onChange={handleFileSelect}
                    />
                  </div>
                  <div className="text-xs text-slate-400">
                    视频可以用 AI 分析 (识别白板/笔记/题目)
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 时间流 */}
      <div className="space-y-3">
        {loaded && items.length === 0 && (
          <EmptyState
            icon="🕊️"
            title="这里还是空的"
            description={
              <>
                文字、录音、视频, 任何形式都可以放在这里。
                <br />
                文字永远不被 AI 分析。音视频可以选择 AI 分析。
              </>
            }
          />
        )}
        {items.map((entry) => {
          if (entry.type === 'reflection' && entry.reflection) {
            return (
              <ReflectionCard
                key={`r-${entry.reflection.id}`}
                item={entry.reflection}
                onDelete={() => removeReflection(entry.reflection!.id)}
              />
            )
          }
          if (entry.type === 'media' && entry.media) {
            return (
              <MediaCard
                key={`m-${entry.media.id}`}
                media={entry.media}
                onDelete={() => removeMedia(entry.media!.id)}
                onUpdated={(updated) => {
                  setItems((prev) =>
                    prev.map((e) =>
                      e.type === 'media' && e.media?.id === updated.id
                        ? { ...e, media: updated }
                        : e
                    )
                  )
                }}
              />
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

// ---- 子组件 ----

function ReflectionCard({
  item,
  onDelete,
}: {
  item: Reflection
  onDelete: () => void
}) {
  const kindLabel: Record<string, { label: string; color: string }> = {
    free_write: { label: '随想', color: 'bg-slate-100 text-slate-700' },
    weekly_note: { label: '本周笔记', color: 'bg-brand-50 text-brand-700' },
    exam_feeling: { label: '考后感受', color: 'bg-purple-50 text-purple-700' },
    mistake_note: { label: '错题想法', color: 'bg-amber-50 text-amber-700' },
  }
  const meta = kindLabel[item.kind] || { label: item.kind, color: 'bg-slate-100' }
  const dt = new Date(item.created_at)
  const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className={`px-1.5 py-0.5 rounded ${meta.color}`}>{meta.label}</span>
        {item.related_key && <span className="text-slate-500">周 {item.related_key}</span>}
        <span className="text-slate-400">· {dateStr}</span>
        <button onClick={onDelete} className="ml-auto text-slate-400 hover:text-red-500">
          删
        </button>
      </div>
      <div className="text-sm text-slate-800 whitespace-pre-wrap leading-relaxed">
        {item.content}
      </div>
    </div>
  )
}

function MediaCard({
  media,
  onDelete,
  onUpdated,
}: {
  media: JournalMedia
  onDelete: () => void
  onUpdated: (m: JournalMedia) => void
}) {
  const dt = new Date(media.created_at)
  const dateStr = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700">
          {media.media_type === 'audio' ? '🎙️ 录音' : '📹 视频'}
        </span>
        <span className="text-slate-400">· {dateStr}</span>
        <button onClick={onDelete} className="ml-auto text-slate-400 hover:text-red-500">
          删
        </button>
      </div>
      <MediaPlayer media={media} onUpdated={onUpdated} />
    </div>
  )
}
