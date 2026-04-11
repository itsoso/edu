/**
 * 轻量 toast 系统. 全局 Provider, 任何子组件可以 useToast().
 *
 * 用法:
 *   const toast = useToast()
 *   toast.success('保存成功')
 *   toast.error('网络错误: ' + e.message)
 *   toast.info('AI 正在思考...')
 *
 * 4 秒自动消失, 多个 toast 堆叠显示.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react'

type ToastKind = 'success' | 'error' | 'info'

type Toast = {
  id: number
  kind: ToastKind
  message: string
}

type ToastApi = {
  success: (msg: string) => void
  error: (msg: string) => void
  info: (msg: string) => void
  dismiss: (id: number) => void
}

const Ctx = createContext<ToastApi | null>(null)

let _nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const timersRef = useRef<Map<number, number>>(new Map())

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timersRef.current.get(id)
    if (timer) {
      window.clearTimeout(timer)
      timersRef.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = _nextId++
      setToasts((prev) => [...prev, { id, kind, message }])
      const timer = window.setTimeout(() => dismiss(id), 4000)
      timersRef.current.set(id, timer)
    },
    [dismiss]
  )

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
    dismiss,
  }

  useEffect(() => {
    return () => {
      timersRef.current.forEach((t) => window.clearTimeout(t))
      timersRef.current.clear()
    }
  }, [])

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-2 max-w-sm">
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
        ))}
      </div>
    </Ctx.Provider>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const styles: Record<ToastKind, string> = {
    success: 'bg-green-50 border-green-300 text-green-800',
    error: 'bg-red-50 border-red-300 text-red-800',
    info: 'bg-brand-50 border-brand-300 text-brand-800',
  }
  const icons: Record<ToastKind, string> = {
    success: '✓',
    error: '✗',
    info: 'ℹ',
  }
  return (
    <div
      className={`flex items-start gap-2 px-4 py-3 rounded border shadow-sm animate-[fadeIn_0.2s_ease-out] ${styles[toast.kind]}`}
    >
      <span className="font-bold text-lg leading-none mt-0.5">{icons[toast.kind]}</span>
      <span className="flex-1 text-sm">{toast.message}</span>
      <button
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-700 text-lg leading-none"
        aria-label="dismiss"
      >
        ×
      </button>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>')
  return ctx
}
