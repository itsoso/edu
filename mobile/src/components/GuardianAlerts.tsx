/**
 * GuardianAlerts — P7 异常监控提示卡片列表.
 *
 * 后端按当前 user 角色过滤 (audience): 学生看 student, 家长看 parent.
 * 严重度配色平静中性, 不感叹.
 */
import React, { useCallback, useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { api, GuardianAlert, GuardianSeverity } from '../lib/api'
import { colors } from '../lib/theme'

const SEVERITY_STYLE: Record<
  GuardianSeverity,
  { bg: string; border: string; titleColor: string }
> = {
  low: { bg: '#f3f4f6', border: '#d1d5db', titleColor: colors.slate800 },
  medium: { bg: '#fef3c7', border: '#fcd34d', titleColor: '#78350f' },
  high: { bg: '#fef2f2', border: '#fecaca', titleColor: '#7f1d1d' },
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
    // 先乐观移除
    setAlerts((cur) => cur.filter((a) => a.id !== id))
    try {
      await api.acknowledgeGuardianAlert(id)
    } catch {
      // 失败重新加载, 保证一致
      load()
    }
  }

  if (!loaded || alerts.length === 0) return null

  return (
    <View style={styles.container}>
      {alerts.map((a) => {
        const s = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.low
        return (
          <View
            key={a.id}
            style={[
              styles.card,
              { backgroundColor: s.bg, borderColor: s.border },
            ]}
          >
            <View style={styles.headerRow}>
              <Text style={[styles.title, { color: s.titleColor }]}>
                {a.title}
              </Text>
              <Pressable
                style={styles.ackBtn}
                onPress={() => ack(a.id)}
                hitSlop={8}
              >
                <Text style={styles.ackText}>知道了</Text>
              </Pressable>
            </View>
            {a.message ? (
              <Text style={styles.message}>{a.message}</Text>
            ) : null}
          </View>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  card: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    flexShrink: 1,
  },
  ackBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  ackText: { fontSize: 12, color: colors.slate700 },
  message: {
    fontSize: 13,
    color: colors.slate700,
    marginTop: 6,
    lineHeight: 19,
  },
})
