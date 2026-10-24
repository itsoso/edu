import { useEffect, useState } from 'react'

export type AuthProviderKind = 'local' | 'health'

export function useLoginProvider() {
  const [provider, setProvider] = useState<AuthProviderKind | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/auth/provider', { credentials: 'include', cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('登录服务暂时不可用，请刷新重试。')
        const data = await response.json()
        if (data.provider !== 'local' && data.provider !== 'health') throw new Error('登录配置无效，请联系管理员。')
        setProvider(data.provider)
      })
      .catch(cause => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '无法获取登录方式。')
      })
    return () => controller.abort()
  }, [])
  return { provider, error }
}

export function HealthLogin({ error = '' }: { error?: string }) {
  return <main className="min-h-screen flex items-center justify-center p-4 bg-slate-50">
    <div className="bg-white rounded-lg shadow border border-slate-200 w-full max-w-sm p-8 space-y-5 text-center">
      <h1 className="text-2xl font-bold text-brand-700">登录学习系统</h1>
      <p className="text-sm text-slate-600">使用已关联的 Health 账号登录，继续查看课表和学习记录。</p>
      {error ? <p role="alert" className="text-red-600">{error}</p>
        : <a className="block rounded bg-brand-600 px-4 py-3 font-medium text-white" href="/api/auth/health/start">前往 Health 登录</a>}
    </div>
  </main>
}
