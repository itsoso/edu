import { useEffect, useRef, useState } from 'react'

/**
 * 轮询 hook. 传入一个拉数据的 async fn + 判断"是否应该继续轮询"的谓词.
 *
 * 典型用法:
 *   const { data, error, loading } = usePolling(
 *     () => api.getUpload(id),
 *     (u) => u.status === 'extracting' || u.status === 'analyzing',
 *     { interval: 2000 }
 *   )
 *
 * - enabled=false 会暂停轮询
 * - 组件卸载时自动清理定时器
 * - 第一次立即拉一次, 之后按 interval 轮询, 直到 shouldPoll 返回 false
 */
export function usePolling<T>(
  fetcher: () => Promise<T>,
  shouldPoll: (data: T) => boolean,
  opts: { interval?: number; enabled?: boolean } = {}
) {
  const { interval = 2000, enabled = true } = opts
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<number | null>(null)
  const cancelledRef = useRef(false)

  // 保持最新的 fetcher/shouldPoll 引用, 但不触发 effect 重跑
  const fetcherRef = useRef(fetcher)
  const shouldPollRef = useRef(shouldPoll)
  fetcherRef.current = fetcher
  shouldPollRef.current = shouldPoll

  useEffect(() => {
    if (!enabled) return
    cancelledRef.current = false

    async function tick() {
      if (cancelledRef.current) return
      setLoading(true)
      try {
        const result = await fetcherRef.current()
        if (cancelledRef.current) return
        setData(result)
        setError('')
        if (shouldPollRef.current(result)) {
          timerRef.current = window.setTimeout(tick, interval)
        }
      } catch (e: any) {
        if (cancelledRef.current) return
        setError(e?.message || String(e))
      } finally {
        if (!cancelledRef.current) setLoading(false)
      }
    }

    tick()

    return () => {
      cancelledRef.current = true
      if (timerRef.current != null) {
        window.clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [enabled, interval])

  return { data, error, loading, setData }
}
