/**
 * FeynmanHistoryScreen — 你讲过的 (反向教学历史).
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useFocusEffect } from '@react-navigation/native'
import { api, FeynmanSessionSummary } from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

export default function FeynmanHistoryScreen() {
  const navigation = useNavigation<any>()
  const { hPadding } = useResponsive()
  const [items, setItems] = useState<FeynmanSessionSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listFeynmanSessions()
      setItems(data)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload])
  )

  function confirmDelete(id: number) {
    Alert.alert('删除这次对话?', '记录将永久删除', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteFeynmanSession(id)
            setItems((prev) => prev.filter((x) => x.id !== id))
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  function renderItem({ item }: { item: FeynmanSessionSummary }) {
    const u = item.assessment?.understood
    const dotColor =
      u === 'understood'
        ? '#16a34a'
        : u === 'mechanical'
        ? '#f59e0b'
        : u === 'confused'
        ? colors.slate400
        : colors.slate400

    const statusText =
      item.status === 'in_progress'
        ? '进行中'
        : item.status === 'abandoned'
        ? '已放弃'
        : '已结束'

    return (
      <Pressable
        onPress={() =>
          navigation.navigate('Feynman', { sessionId: item.id })
        }
        onLongPress={() => confirmDelete(item.id)}
        style={styles.card}
      >
        <View style={styles.cardHead}>
          <View style={[styles.dot, { backgroundColor: dotColor }]} />
          <Text style={styles.cardTitle} numberOfLines={2}>
            {item.topic_seed || '(未命名话题)'}
          </Text>
        </View>
        <Text style={styles.cardMeta}>
          {statusText} · {item.turn_count} 轮
          {item.assessment
            ? u === 'understood'
              ? ' · 讲清楚了'
              : u === 'mechanical'
              ? ' · 步骤会, 没讲透'
              : ' · 还乱'
            : ''}
        </Text>
        <Text style={styles.cardTime}>
          {(item.created_at || '').slice(0, 16).replace('T', ' ')}
        </Text>
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <View style={[styles.header, { paddingHorizontal: hPadding }]}>
        <View style={styles.headerRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>你讲过的</Text>
            <Text style={styles.subtitle}>
              回看你给 AI 讲过的题. 长按删除.
            </Text>
          </View>
          <Pressable
            onPress={() => navigation.navigate('FeynmanNew')}
            style={styles.newBtn}
          >
            <Text style={styles.newBtnText}>+ 讲一个新知识点</Text>
          </Pressable>
        </View>
      </View>

      {error ? (
        <Text style={[styles.errorText, { paddingHorizontal: hPadding }]}>
          {error}
        </Text>
      ) : null}

      {loading && items.length === 0 ? (
        <ActivityIndicator
          color={colors.brand}
          style={{ marginTop: 40 }}
        />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(x) => String(x.id)}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingHorizontal: hPadding },
          ]}
          refreshControl={
            <RefreshControl refreshing={loading} onRefresh={reload} />
          }
          ListEmptyComponent={
            !loading ? (
              <Pressable
                onPress={() => navigation.navigate('FeynmanNew')}
                style={styles.emptyCard}
              >
                <Text style={styles.emptyEmoji}>🎓</Text>
                <Text style={styles.emptyTitle}>还没有讲过题</Text>
                <Text style={styles.emptyText}>
                  点这里主动讲一个新学的知识点,或者从错题本/训练里"教教我"进入.
                </Text>
                <Text style={styles.emptyCTA}>主动讲一个 →</Text>
              </Pressable>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { paddingTop: 12, paddingBottom: 8 },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  newBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    marginTop: 2,
  },
  newBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  list: { padding: 16, paddingTop: 8, paddingBottom: 48, gap: 8 },
  errorText: { color: colors.red500, fontSize: 13, paddingVertical: 8 },
  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    fontSize: 13,
    marginTop: 8,
    paddingHorizontal: 8,
    lineHeight: 19,
  },
  emptyCard: {
    marginTop: 32,
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    borderRadius: 12,
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  emptyEmoji: { fontSize: 40, opacity: 0.7 },
  emptyTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.slate800,
    marginTop: 8,
  },
  emptyCTA: {
    marginTop: 16,
    fontSize: 13,
    fontWeight: '600',
    color: colors.brand,
  },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
  },
  cardHead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.slate900,
    lineHeight: 20,
  },
  cardMeta: { fontSize: 12, color: colors.slate600, marginTop: 4 },
  cardTime: { fontSize: 11, color: colors.slate400, marginTop: 2 },
})
