/**
 * 内联音视频播放器 + AI 分析入口.
 */
import { useState } from 'react'
import { api, JournalMedia } from '../api'
import { usePolling } from '../hooks/usePolling'
import { useToast } from './Toast'

type Props = {
  media: JournalMedia
  onUpdated?: (m: JournalMedia) => void
}

const PROMPT_PRESETS = [
  '黑板/白板上写了什么?',
  '这页手写笔记的内容是什么?',
  '画面中有什么数学/科学题目?',
  '总结视频中展示的内容',
]

export default function MediaPlayer({ media, onUpdated }: Props) {
  const toast = useToast()
  const [m, setM] = useState(media)
  const [showAnalysis, setShowAnalysis] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 轮询分析状态
  const isProcessing =
    m.analysis_status === 'extracting_frames' || m.analysis_status === 'analyzing'
  usePolling(
    async () => {
      const updated = await api.getJournalMedia(m.id)
      setM(updated)
      if (
        updated.analysis_status !== 'extracting_frames' &&
        updated.analysis_status !== 'analyzing'
      ) {
        onUpdated?.(updated)
      }
      return updated
    },
    (u: any) =>
      u?.analysis_status === 'extracting_frames' ||
      u?.analysis_status === 'analyzing',
    { interval: 3000, enabled: isProcessing }
  )

  async function submitAnalysis() {
    const p = prompt.trim()
    if (!p) {
      toast.error('请输入你想让 AI 看什么')
      return
    }
    setSubmitting(true)
    try {
      const updated = await api.analyzeJournalMedia(m.id, p)
      setM(updated)
      setShowAnalysis(true)
    } catch (e: any) {
      toast.error('分析请求失败: ' + (e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  const secs = m.duration_secs
  const dur = secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : ''
  const sizeMB = m.file_size_bytes ? (m.file_size_bytes / 1024 / 1024).toFixed(1) : ''

  return (
    <div className="mt-2 space-y-2">
      {/* 播放器 */}
      {m.media_type === 'video' ? (
        <video
          src={m.file_url}
          controls
          playsInline
          preload="metadata"
          className="w-full max-h-48 rounded bg-black"
        />
      ) : (
        <audio src={m.file_url} controls className="w-full" preload="metadata" />
      )}

      <div className="flex items-center gap-2 text-[11px] text-slate-500">
        <span>{m.media_type === 'video' ? '📹' : '🎙️'}</span>
        {dur && <span>{dur}</span>}
        {sizeMB && <span>{sizeMB} MB</span>}
        {m.ai_opt_in && <span className="text-purple-600">已 AI 分析</span>}
      </div>

      {/* AI 分析区 (仅视频) */}
      {m.media_type === 'video' && (
        <>
          {!showAnalysis && m.analysis_status === 'none' && (
            <button
              onClick={() => setShowAnalysis(true)}
              className="text-xs text-purple-600 hover:text-purple-800"
            >
              🧠 AI 分析这段视频
            </button>
          )}

          {(showAnalysis || m.analysis_status !== 'none') && (
            <div className="bg-purple-50 border border-purple-200 rounded p-3 space-y-2">
              {/* 已有分析结果 */}
              {m.analysis_status === 'done' && m.analysis && (
                <div className="text-sm space-y-1">
                  {m.analysis_prompt && (
                    <div className="text-xs text-purple-600">
                      提问: {m.analysis_prompt}
                    </div>
                  )}
                  {m.analysis.summary && (
                    <div className="font-medium">{m.analysis.summary}</div>
                  )}
                  {m.analysis.answer && (
                    <div className="text-slate-700">{m.analysis.answer}</div>
                  )}
                  {m.analysis.details?.length > 0 && (
                    <ul className="list-disc pl-5 text-xs text-slate-600">
                      {m.analysis.details.map((d: string, i: number) => (
                        <li key={i}>{d}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {/* 处理中 */}
              {isProcessing && (
                <div className="text-sm text-purple-700 animate-pulse">
                  {m.analysis_status === 'extracting_frames'
                    ? '正在从视频提取关键帧...'
                    : 'AI 正在分析画面...'}
                </div>
              )}

              {/* 失败 */}
              {m.analysis_status === 'failed' && (
                <div className="text-xs text-red-600">
                  分析失败: {m.error_message || '未知错误'}
                </div>
              )}

              {/* 输入区 (未分析 / 重新分析) */}
              {(m.analysis_status === 'none' || m.analysis_status === 'done' || m.analysis_status === 'failed') && (
                <div className="space-y-2">
                  <div className="text-xs text-slate-600">
                    {m.analysis_status === 'done'
                      ? '换个问题重新分析:'
                      : '你想让 AI 看什么?'}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {PROMPT_PRESETS.map((p) => (
                      <button
                        key={p}
                        onClick={() => setPrompt(p)}
                        className={`text-[11px] px-2 py-1 rounded border ${
                          prompt === p
                            ? 'bg-purple-100 border-purple-400 text-purple-800'
                            : 'bg-white border-slate-200 text-slate-600'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      value={prompt}
                      onChange={(e) => setPrompt(e.target.value)}
                      placeholder="或者自己写..."
                      className="flex-1 border border-slate-300 rounded px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={submitAnalysis}
                      disabled={submitting || isProcessing}
                      className="px-3 py-1.5 bg-purple-600 text-white rounded text-sm disabled:opacity-50"
                    >
                      {submitting ? '...' : '分析'}
                    </button>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    ⚠️ 点击"分析"即表示你同意将视频画面发送给 AI — 文字日记不会被发送
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
