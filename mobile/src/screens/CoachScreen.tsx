/**
 * CoachScreen — P6 周日复盘完整页.
 *
 * 当前周 review (markdown + highlights) + 历史时间轴.
 * 学生本人可重新生成 / 删除本周.
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  api,
  CoachHistoryEntry,
  CoachReview,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { useResponsive } from '../lib/responsive'
import { colors } from '../lib/theme'
import MdViewer from '../components/MdViewer'

export default function CoachScreen() {
  const { user } = useAuth()
  const { hPadding, maxContent } = useResponsive()
  const isStudent = user?.role === 'student'

  const [review, setReview] = useState<CoachReview | null>(null)
  const [history, setHistory] = useState<CoachHistoryEntry[]>([])
  const [activeWeek, setActiveWeek] = useState<string | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const loadReview = useCallback(async (week?: string | null) => {
    setLoading(true)
    try {
      const r = week
        ? await api.getCoachWeek(week)
        : await api.getCoachThisWeek()
      setReview(r)
    } catch {
      setReview(null)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const data = await api.listCoachHistory()
      setHistory(Array.isArray(data) ? data : [])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadReview(null)
    loadHistory()
  }, [loadReview, loadHistory])

  async function onRefresh() {
    await Promise.all([loadReview(activeWeek), loadHistory()])
  }

  async function regenerate() {
    if (busy) return
    setBusy(true)
    try {
      await api.regenerateCoachThisWeek()
      setActiveWeek(null)
      await loadReview(null)
      await loadHistory()
    } catch (e: any) {
      Alert.alert('生成失败', String(e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function removeWeek() {
    const ws = review?.week_start
    if (!ws) return
    Alert.alert('删除本周复盘?', ws, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteCoachWeek(ws)
            setReview({ exists: false, week_start: ws })
            await loadHistory()
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  function pickWeek(ws: string) {
    setActiveWeek(ws)
    loadReview(ws)
  }

  const isCurrent = !activeWeek
  const isDone = review?.exists && review?.status === 'done'
  const isGenerating = review?.exists && review?.status === 'generating'
  const isFailed = review?.exists && review?.status === 'failed'

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} />
        }
      >
        <View
          style={[
            styles.body,
            maxContent ? { maxWidth: maxContent, alignSelf: 'center', width: '100%' } : null,
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>📅 周日复盘</Text>
            <Text style={styles.subtitle}>
              {review?.week_start
                ? `本周起始 ${review.week_start}`
                : '加载中...'}
            </Text>
          </View>

          {!review?.exists && !loading && (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyText}>
                本周还没有复盘. 等到周日 AI 会自动生成, 你也可以现在手动生成.
              </Text>
              {isStudent && isCurrent && (
                <Pressable
                  style={[styles.btnPrimary, busy && styles.btnDisabled]}
                  onPress={regenerate}
                  disabled={busy}
                >
                  <Text style={styles.btnPrimaryText}>
                    {busy ? '生成中...' : '生成本周复盘'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {isGenerating && (
            <View style={styles.infoCard}>
              <Text style={styles.infoText}>AI 正在写本周复盘, 一会儿来看.</Text>
            </View>
          )}

          {isFailed && (
            <View style={styles.failCard}>
              <Text style={styles.failTitle}>生成失败</Text>
              {review?.error_message ? (
                <Text style={styles.failMsg}>{review.error_message}</Text>
              ) : null}
              {isStudent && isCurrent && (
                <Pressable
                  style={[styles.btnPrimary, busy && styles.btnDisabled]}
                  onPress={regenerate}
                  disabled={busy}
                >
                  <Text style={styles.btnPrimaryText}>
                    {busy ? '...' : '重新生成'}
                  </Text>
                </Pressable>
              )}
            </View>
          )}

          {isDone && review?.highlights && (
            <View style={styles.highlightsGrid}>
              <HighlightBlock
                label="做得好的"
                items={review.highlights.strengths}
              />
              <HighlightBlock
                label="值得注意的"
                items={review.highlights.watchouts}
              />
              <HighlightBlock
                label="下周可以试试"
                items={
                  review.highlights.focus_for_next_week
                    ? [review.highlights.focus_for_next_week]
                    : []
                }
              />
            </View>
          )}

          {isDone && (
            <View style={styles.contentCard}>
              <MdViewer markdown={review?.content_md || ''} />
            </View>
          )}

          {isDone && isStudent && isCurrent && (
            <View style={styles.actionsRow}>
              <Pressable
                style={[styles.btnSecondary, busy && styles.btnDisabled]}
                onPress={regenerate}
                disabled={busy}
              >
                <Text style={styles.btnSecondaryText}>
                  {busy ? '...' : '重新生成'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.btnDanger}
                onPress={removeWeek}
              >
                <Text style={styles.btnDangerText}>删除本周</Text>
              </Pressable>
            </View>
          )}

          {/* 历史时间轴 */}
          <View style={styles.foldCard}>
            <Pressable
              onPress={() => setHistoryOpen((o) => !o)}
              style={styles.foldSummary}
            >
              <Text style={styles.foldSummaryText}>
                历史复盘 · 共 {history.length} 周
              </Text>
              <Text style={styles.foldChevron}>{historyOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {historyOpen && (
              <View style={styles.foldBody}>
                {history.length === 0 && (
                  <Text style={styles.mutedText}>还没有历史复盘.</Text>
                )}
                {history.map((h) => {
                  const active = activeWeek === h.week_start
                  return (
                    <Pressable
                      key={h.week_start}
                      style={[
                        styles.historyItem,
                        active && styles.historyItemActive,
                      ]}
                      onPress={() => pickWeek(h.week_start)}
                    >
                      <Text style={styles.historyWeek}>{h.week_start}</Text>
                      <Text style={styles.historyMeta}>
                        {h.status === 'done'
                          ? '已完成'
                          : h.status === 'generating'
                          ? '生成中'
                          : '失败'}
                      </Text>
                    </Pressable>
                  )
                })}
                {activeWeek && (
                  <Pressable
                    style={styles.historyBack}
                    onPress={() => {
                      setActiveWeek(null)
                      loadReview(null)
                    }}
                  >
                    <Text style={styles.historyBackText}>← 回到本周</Text>
                  </Pressable>
                )}
              </View>
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function HighlightBlock({
  label,
  items,
}: {
  label: string
  items: string[]
}) {
  return (
    <View style={styles.hCard}>
      <Text style={styles.hLabel}>{label}</Text>
      {items.length === 0 ? (
        <Text style={styles.hEmpty}>—</Text>
      ) : (
        items.map((s, i) => (
          <Text key={i} style={styles.hItem}>
            • {s}
          </Text>
        ))
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingVertical: 16, paddingBottom: 48, gap: 16 },
  body: { gap: 16 },

  header: { gap: 4 },
  title: { fontSize: 22, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500 },

  emptyCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  emptyText: { fontSize: 14, color: colors.slate600, lineHeight: 21 },

  infoCard: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
  },
  infoText: { fontSize: 13, color: colors.slate600 },

  failCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 14,
    gap: 8,
  },
  failTitle: { fontSize: 14, fontWeight: '600', color: '#7f1d1d' },
  failMsg: { fontSize: 13, color: colors.slate700 },

  highlightsGrid: { gap: 10 },
  hCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
    gap: 4,
  },
  hLabel: {
    fontSize: 12,
    color: colors.slate500,
    fontWeight: '600',
    marginBottom: 4,
  },
  hItem: { fontSize: 14, color: colors.slate800, lineHeight: 21 },
  hEmpty: { fontSize: 13, color: colors.slate400 },

  contentCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 16,
  },

  actionsRow: { flexDirection: 'row', gap: 10 },
  btnPrimary: {
    backgroundColor: colors.brand,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnSecondaryText: { color: colors.slate700, fontSize: 13 },
  btnDanger: {
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  btnDangerText: { color: colors.red500, fontSize: 13 },
  btnDisabled: { opacity: 0.5 },

  foldCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
  },
  foldSummary: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  foldSummaryText: { fontSize: 13, color: colors.slate600 },
  foldChevron: { fontSize: 12, color: colors.slate400 },
  foldBody: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  mutedText: {
    fontSize: 13,
    color: colors.slate500,
    paddingHorizontal: 4,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 6,
  },
  historyItemActive: {
    backgroundColor: colors.brandLight,
  },
  historyWeek: { fontSize: 14, color: colors.slate800 },
  historyMeta: { fontSize: 11, color: colors.slate500 },
  historyBack: {
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  historyBackText: { fontSize: 12, color: colors.brand },
})
