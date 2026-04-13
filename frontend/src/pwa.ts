export async function registerServiceWorker(enabled = import.meta.env.PROD) {
  if (!enabled) return
  if (typeof window === 'undefined') return
  if (!('serviceWorker' in navigator)) return

  const register = async () => {
    await navigator.serviceWorker.register('/sw.js')
  }

  if (document.readyState !== 'loading') {
    await register()
    return
  }

  await new Promise<void>((resolve) => {
    window.addEventListener(
      'load',
      () => {
        void register().finally(resolve)
      },
      { once: true }
    )
  })
}
