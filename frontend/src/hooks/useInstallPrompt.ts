import { useEffect, useMemo, useState } from 'react'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function isStandaloneDisplayMode() {
  if (typeof window === 'undefined') return false
  return window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
}

export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [standalone, setStandalone] = useState(() => isStandaloneDisplayMode())

  useEffect(() => {
    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault()
      setDeferredPrompt(event as BeforeInstallPromptEvent)
    }

    function handleDisplayModeChange() {
      setStandalone(isStandaloneDisplayMode())
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleDisplayModeChange)
    const media = window.matchMedia('(display-mode: standalone)')
    media.addEventListener('change', handleDisplayModeChange)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleDisplayModeChange)
      media.removeEventListener('change', handleDisplayModeChange)
    }
  }, [])

  return useMemo(() => {
    if (standalone) {
      return { visible: false, message: '', actionLabel: '', onAction: undefined }
    }

    if (deferredPrompt) {
      return {
        visible: true,
        message: '把学习系统添加到主屏幕，孩子在 iPad 上会像原生 App 一样打开。',
        actionLabel: '立即安装',
        onAction: async () => {
          await deferredPrompt.prompt()
          await deferredPrompt.userChoice.catch(() => undefined)
          setDeferredPrompt(null)
        },
      }
    }

    return {
      visible: true,
      message: '在 iPad Safari 点“分享”再选“添加到主屏幕”，就能固定到桌面。',
      actionLabel: '',
      onAction: undefined,
    }
  }, [deferredPrompt, standalone])
}
