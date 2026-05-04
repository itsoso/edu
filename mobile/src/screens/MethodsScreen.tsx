/**
 * MethodsScreen — 学习方法速查卡.
 * 对齐 web 的 frontend/src/pages/Methods.tsx.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import MdViewer from '../components/MdViewer'

type ContentItem = { name: string; title: string }

export default function MethodsScreen() {
  const { hPadding } = useResponsive()
  const [items, setItems] = useState<ContentItem[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [body, setBody] = useState<string>('')
  const [loadingList, setLoadingList] = useState(false)
  const [loadingBody, setLoadingBody] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    api
      .listContent()
      .then((list) => {
        if (cancelled) return
        setItems(list)
        if (list.length && !active) {
          const first = list[0].name
          setActive(first)
        }
      })
      .catch((e: any) => {
        if (!cancelled) setErr(e?.message || String(e))
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadBody = useCallback(async (name: string) => {
    setLoadingBody(true)
    setErr('')
    try {
      const r = await api.getContent(name)
      setBody(r.content || '')
    } catch (e: any) {
      setErr(e?.message || String(e))
      setBody('')
    } finally {
      setLoadingBody(false)
    }
  }, [])

  useEffect(() => {
    if (active) loadBody(active)
  }, [active, loadBody])

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}>
        <View style={styles.header}>
          <Text style={styles.title}>学习方法速查卡</Text>
          <Text style={styles.subtitle}>卡住了？翻卡片找对应的方法</Text>
        </View>

        {loadingList ? (
          <ActivityIndicator color={colors.brand} />
        ) : (
          <View style={styles.grid}>
            {items.map((c) => {
              const isActive = c.name === active
              return (
                <Pressable
                  key={c.name}
                  onPress={() => setActive(c.name)}
                  style={[styles.cardBtn, isActive && styles.cardBtnActive]}
                >
                  <Text
                    style={[
                      styles.cardBtnText,
                      isActive && styles.cardBtnTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {c.title}
                  </Text>
                </Pressable>
              )
            })}
          </View>
        )}

        <View style={styles.bodyCard}>
          {loadingBody ? (
            <ActivityIndicator color={colors.brand} />
          ) : err ? (
            <Text style={styles.errText}>{err}</Text>
          ) : body ? (
            <MdViewer markdown={body} />
          ) : (
            <Text style={styles.emptyText}>点击上方卡片查看方法</Text>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48, gap: 16 },
  header: {},
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },

  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cardBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  cardBtnActive: {
    backgroundColor: colors.brandLight,
    borderColor: colors.brand,
  },
  cardBtnText: { fontSize: 13, color: colors.slate700, fontWeight: '500' },
  cardBtnTextActive: { color: colors.brand, fontWeight: '700' },

  bodyCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 16,
    minHeight: 120,
  },
  errText: { fontSize: 13, color: colors.red500 },
  emptyText: {
    fontSize: 13,
    color: colors.slate500,
    textAlign: 'center',
    paddingVertical: 24,
  },
})
