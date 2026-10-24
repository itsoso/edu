import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { HealthLogin, useLoginProvider } from './healthAuth'

function Probe() {
  const { provider, error } = useLoginProvider()
  return <div>{error || provider || 'loading'}</div>
}

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Health login', () => {
  it('navigates to same-origin SSO start without collecting passwords', () => {
    render(<HealthLogin />)
    expect(screen.getByRole('link').getAttribute('href')).toBe('/api/auth/health/start')
    expect(document.querySelector('input[type=password]')).toBeNull()
  })
  it('reads the server-selected provider', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ provider: 'health' }) }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('health')).toBeTruthy())
  })
  it('does not fall back to password auth when discovery fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<Probe />)
    await waitFor(() => expect(screen.getByText('登录服务暂时不可用，请刷新重试。')).toBeTruthy())
    expect(screen.queryByText('local')).toBeNull()
  })
})
