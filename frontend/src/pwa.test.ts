import manifest from '../public/manifest.json'
import { registerServiceWorker } from './pwa'

describe('PWA configuration', () => {
  it('exposes installable metadata for iPad home screen usage', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.name).toContain('学习系统')
    expect(manifest.icons.length).toBeGreaterThan(0)
  })

  it('registers the service worker in production when supported', async () => {
    const register = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, 'navigator', {
      value: {
        serviceWorker: { register },
      },
      configurable: true,
    })

    await registerServiceWorker(true)

    expect(register).toHaveBeenCalledWith('/sw.js')
  })
})
