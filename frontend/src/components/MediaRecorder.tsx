/**
 * 浏览器录音/录像组件. 基于 MediaRecorder API.
 *
 * - audio 模式: 只录音, 显示计时器
 * - video 模式: 摄像头实时预览 + 录像 + 计时器
 * - 自动选最佳 MIME: webm/opus (Chrome/FF) → mp4 (Safari fallback)
 * - 到达时限自动停止
 * - 移动端友好: 大按钮, 全宽预览
 */
import { useCallback, useEffect, useRef, useState } from 'react'

type Props = {
  mode: 'audio' | 'video'
  maxDurationSecs: number
  onRecordingComplete: (blob: Blob, durationSecs: number) => void
  onCancel: () => void
}

function pickMimeType(mode: 'audio' | 'video'): string {
  const candidates =
    mode === 'video'
      ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime
    }
  }
  return mode === 'video' ? 'video/webm' : 'audio/webm'
}

export default function MediaRecorderComponent({
  mode,
  maxDurationSecs,
  onRecordingComplete,
  onCancel,
}: Props) {
  const [state, setState] = useState<'idle' | 'recording' | 'stopped'>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [resultBlob, setResultBlob] = useState<Blob | null>(null)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<number | null>(null)
  const videoPreviewRef = useRef<HTMLVideoElement>(null)
  const startTimeRef = useRef(0)

  const cleanup = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  useEffect(() => {
    return cleanup
  }, [cleanup])

  async function startRecording() {
    setError('')
    chunksRef.current = []
    try {
      const constraints: MediaStreamConstraints =
        mode === 'video'
          ? {
              video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
              audio: true,
            }
          : { audio: true }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      // 视频预览
      if (mode === 'video' && videoPreviewRef.current) {
        videoPreviewRef.current.srcObject = stream
        videoPreviewRef.current.play().catch(() => {})
      }

      const mimeType = pickMimeType(mode)
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: mimeType })
        const dur = Math.round((Date.now() - startTimeRef.current) / 1000)
        setResultBlob(blob)
        setPreviewUrl(URL.createObjectURL(blob))
        setElapsed(dur)
        setState('stopped')
        // 停止摄像头
        stream.getTracks().forEach((t) => t.stop())
      }

      recorder.start(1000) // 每秒一个 chunk
      startTimeRef.current = Date.now()
      setState('recording')

      // 计时器
      timerRef.current = window.setInterval(() => {
        const secs = Math.round((Date.now() - startTimeRef.current) / 1000)
        setElapsed(secs)
        if (secs >= maxDurationSecs) {
          recorder.stop()
        }
      }, 500)
    } catch (e: any) {
      const msg = String(e.message || e)
      if (msg.includes('NotAllowed') || msg.includes('Permission')) {
        setError(mode === 'video' ? '请允许摄像头和麦克风权限' : '请允许麦克风权限')
      } else {
        setError('录制失败: ' + msg)
      }
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current?.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function confirm() {
    if (resultBlob) {
      onRecordingComplete(resultBlob, elapsed)
    }
  }

  function formatTime(s: number) {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${String(sec).padStart(2, '0')}`
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {error}
        </div>
      )}

      {/* 视频实时预览 */}
      {mode === 'video' && state === 'recording' && (
        <video
          ref={videoPreviewRef}
          muted
          playsInline
          className="w-full max-h-64 rounded bg-black object-cover"
        />
      )}

      {/* 录制完的预览 */}
      {state === 'stopped' && previewUrl && (
        <div>
          {mode === 'video' ? (
            <video src={previewUrl} controls playsInline className="w-full max-h-64 rounded bg-black" />
          ) : (
            <audio src={previewUrl} controls className="w-full" />
          )}
        </div>
      )}

      {/* 计时器 */}
      {state === 'recording' && (
        <div className="text-center">
          <div className="text-3xl font-mono font-bold text-red-600">
            <span className="animate-pulse inline-block w-3 h-3 bg-red-500 rounded-full mr-2" />
            {formatTime(elapsed)} / {formatTime(maxDurationSecs)}
          </div>
          <div className="text-xs text-slate-500 mt-1">
            {mode === 'audio' ? '正在录音...' : '正在录像...'}
          </div>
        </div>
      )}

      {/* 按钮 */}
      <div className="flex gap-3 justify-center">
        {state === 'idle' && (
          <>
            <button
              onClick={startRecording}
              className="px-6 py-3 bg-red-600 text-white rounded-full text-sm font-medium hover:bg-red-700"
            >
              {mode === 'audio' ? '🎙️ 开始录音' : '📹 开始录像'}
            </button>
            <button
              onClick={onCancel}
              className="px-4 py-3 border border-slate-300 rounded-full text-sm text-slate-600"
            >
              取消
            </button>
          </>
        )}
        {state === 'recording' && (
          <button
            onClick={stopRecording}
            className="px-8 py-3 bg-slate-800 text-white rounded-full text-sm font-medium"
          >
            ⬛ 停止
          </button>
        )}
        {state === 'stopped' && (
          <>
            <button
              onClick={confirm}
              className="px-6 py-3 bg-brand-600 text-white rounded-full text-sm font-medium"
            >
              ✓ 使用这段{mode === 'audio' ? '录音' : '录像'}
            </button>
            <button
              onClick={() => {
                setResultBlob(null)
                if (previewUrl) URL.revokeObjectURL(previewUrl)
                setPreviewUrl(null)
                setElapsed(0)
                setState('idle')
              }}
              className="px-4 py-3 border border-slate-300 rounded-full text-sm text-slate-600"
            >
              重录
            </button>
            <button onClick={onCancel} className="px-4 py-3 text-sm text-slate-500">
              取消
            </button>
          </>
        )}
      </div>
    </div>
  )
}
