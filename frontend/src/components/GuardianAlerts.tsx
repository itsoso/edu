/**
 * GuardianAlerts — P7 异常监控提示卡片列表 (web).
 *
 * 后端按当前 user 的 audience 过滤. 严重度配色平静中性.
 */
import { useCallback, useEffect, useState } from 'react'
import { api, GuardianAlert, GuardianSeverity } from '../api'

const SEVERITY_CLASS: Record<
  GuardianSeverity,
  { wrap: string; title: string }
> = {
  low: {
    wrap: 'bg-slate-100 border-slate-300',
    title: 'text-slate-800',
  },
  medium: {
    wrap: 'bg-amber-50 border-amber-300',
    title: 'text-amber-900',
  },
  high: {
    wrap: 'bg-red-50 border-red-200',
    title: 'text-red-900',
  },
}

export default function GuardianAlerts() {
  const [alerts, setAlerts] = useState<GuardianAlert[]>([])
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.getGuardianAlerts()
      setAlerts(Array.isArray(data) ? data : [])
    } catch {
      /* ignore */
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function ack(id: number) {
    setAlerts((cur) => cur.filter((a) => a.id !== id))
    try {
      await api.acknowledgeGuardianAlert(id)
    } catch {
      load()
    }
  }

  if (!loaded || alerts.length === 0) return null

  return (
    <div className="space-y-2">
      {alerts.map((a) => {
        const cls = SEVERITY_CLASS[a.severity] || SEVERITY_CLASS.low
        return (
          <div
            key={a.id}
            className={`border rounded-lg p-4 ${cls.wrap}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className={`text-base font-semibold flex-1 ${cls.title}`}>
                {a.title}
              </div>
              <button
                type="button"
                onClick={() => ack(a.id)}
                className="text-xs text-slate-700 px-2.5 py-1 rounded border border-black/10 bg-white/70 hover:bg-white"
              >
                知道了
              </button>
            </div>
            {a.message && (
              <p className="text-sm text-slate-700 mt-2 leading-relaxed">
                {a.message}
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}
