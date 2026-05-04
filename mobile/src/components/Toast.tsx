/**
 * 简化版 Toast — RN 里用 Alert + 自定义悬浮条实现.
 * Web 版导出 useToast() hook, 我们保持相同 API.
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

type ToastKind = 'success' | 'error' | 'info'
type ToastFn = (msg: string) => void
type ToastApi = { success: ToastFn; error: ToastFn; info: ToastFn }

const ToastCtx = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState<{ text: string; kind: ToastKind } | null>(null)
  const opacity = useRef(new Animated.Value(0)).current
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback(
    (text: string, kind: ToastKind) => {
      setMsg({ text, kind })
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }).start()
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        Animated.timing(opacity, {
          toValue: 0,
          duration: 220,
          useNativeDriver: true,
        }).start(() => setMsg(null))
      }, 2600)
    },
    [opacity]
  )

  const api: ToastApi = {
    success: (m) => show(m, 'success'),
    error: (m) => show(m, 'error'),
    info: (m) => show(m, 'info'),
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {msg && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.toast,
            { opacity },
            msg.kind === 'success' && styles.toastSuccess,
            msg.kind === 'error' && styles.toastError,
            msg.kind === 'info' && styles.toastInfo,
          ]}
        >
          <Text style={styles.toastText}>{msg.text}</Text>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastCtx)
  if (!ctx) {
    // Fallback silent toast if used outside provider — avoid crash.
    return {
      success: () => {},
      error: () => {},
      info: () => {},
    }
  }
  return ctx
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 60,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
  },
  toastSuccess: { backgroundColor: '#ecfdf5', borderWidth: 1, borderColor: '#bbf7d0' },
  toastError: { backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca' },
  toastInfo: { backgroundColor: '#eff6ff', borderWidth: 1, borderColor: '#bfdbfe' },
  toastText: { fontSize: 14, color: colors.slate800 },
})
