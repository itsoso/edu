/**
 * CuratorBlock — "今天值得做的"
 *
 * 区分于 TutorCard (紫蓝): 用浅黄绿背景.
 * 内部自己 fetch /api/curator/today, pending 项渲染卡片,
 * 完成 / 跳过后更新本地状态.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
} from 'react-native'
import { api, CuratedItem } from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import MathText from './MathText'

type Props = {
  onNavigate?: (route: string, params?: any) => void
}

const KIND_EMOJI: Record<CuratedItem['kind'], string> = {
  review_mistake: '🔁',
  pattern_drill: '🎯',
  goal_aligned: '🎪',
  challenge: '🚀',
  rest_recommended: '🌿',
}

function safeRationale(item: CuratedItem): string | null {
  const r = item.rationale
  if (!r) return null
  // 防 LLM 乱码污染 UI
  if (r.length >= 100) return null
  // 简单去除控制字符
  if (/[\u0000-\u0008\u000b-\u001f]/.test(r)) return null
  return r
}

function routeFromSource(
  table: string | null
): { route: string; params?: any } | null {
  if (!table) return null
  switch (table) {
    case 'mistakes':
      return { route: 'Mistakes' }
    case 'practice_sets':
      return { route: 'Practice' }
    case 'weekly_goals':
      return { route: 'Plan' }
    default:
      return null
  }
}

export default function CuratorBlock({ onNavigate }: Props) {
  const { gridCols } = useResponsive()
  const [items, setItems] = useState<CuratedItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [open, setOpen] = useState(true)
  const [completedCount, setCompletedCount] = useState(0)
  const [dismissedCount, setDismissedCount] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.getCuratedToday()
      const all = r.items || []
      setItems(all)
      setCompletedCount(all.filter((i) => i.status === 'completed').length)
      setDismissedCount(all.filter((i) => i.status === 'dismissed').length)
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const pending = useMemo(
    () => (items || []).filter((i) => i.status === 'pending'),
    [items]
  )

  // 自动收起当全部完成
  useEffect(() => {
    if (items !== null && pending.length === 0 && (completedCount + dismissedCount) > 0) {
      setOpen(false)
    }
  }, [pending.length, items, completedCount, dismissedCount])

  if (items === null && loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator color={colors.slate500} />
      </View>
    )
  }
  if (items === null || (items.length === 0 && !loading)) {
    return null
  }

  async function handleRefresh() {
    setRefreshing(true)
    try {
      await api.refreshCuratedToday()
      await load()
      setOpen(true)
    } catch {
      /* ignore */
    } finally {
      setRefreshing(false)
    }
  }

  async function handleDo(item: CuratedItem) {
    try {
      await api.completeCuratedItem(item.id)
    } catch {
      /* ignore */
    }
    if (item.kind !== 'rest_recommended') {
      const r = routeFromSource(item.source_table)
      if (r && onNavigate) {
        if (r.route === 'Practice' && item.source_id) {
          onNavigate(r.route, { openSetId: item.source_id })
        } else {
          onNavigate(r.route, r.params)
        }
      }
    }
    // 本地更新
    setItems((prev) =>
      prev
        ? prev.map((x) =>
            x.id === item.id ? { ...x, status: 'completed' } : x
          )
        : prev
    )
    setCompletedCount((c) => c + 1)
  }

  async function handleSkip(item: CuratedItem) {
    try {
      await api.dismissCuratedItem(item.id)
    } catch {
      /* ignore */
    }
    setItems((prev) =>
      prev
        ? prev.map((x) =>
            x.id === item.id ? { ...x, status: 'dismissed' } : x
          )
        : prev
    )
    setDismissedCount((d) => d + 1)
  }

  const useTwoCol = gridCols >= 3 && pending.length > 1

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Pressable
          onPress={() => setOpen((o) => !o)}
          style={styles.headerTouch}
        >
          <Text style={styles.headerTitle}>💡 今天值得做的</Text>
          <Text style={styles.chev}>{open ? '▾' : '▸'}</Text>
        </Pressable>
        <Pressable
          onPress={handleRefresh}
          disabled={refreshing}
          style={styles.refreshBtn}
        >
          <Text style={styles.refreshBtnText}>
            {refreshing ? '换中…' : '换一批'}
          </Text>
        </Pressable>
      </View>

      {(completedCount > 0 || dismissedCount > 0) && (
        <Text style={styles.countLine}>
          今天已完成 {completedCount} · 跳过 {dismissedCount}
        </Text>
      )}

      {open && (
        <>
          {pending.length === 0 ? (
            <Text style={styles.emptyText}>
              {completedCount + dismissedCount > 0
                ? '今天的小任务都处理完了, 休息一下.'
                : '今天暂无推荐.'}
            </Text>
          ) : (
            <View style={[styles.grid, useTwoCol && styles.gridTwoCol]}>
              {pending.map((item) => {
                const isRest = item.kind === 'rest_recommended'
                const rationale = safeRationale(item)
                return (
                  <View
                    key={item.id}
                    style={[
                      styles.item,
                      useTwoCol && styles.itemHalf,
                    ]}
                  >
                    <View style={styles.itemTitleRow}>
                      <Text style={styles.itemEmoji}>
                        {KIND_EMOJI[item.kind] || '✨'}
                      </Text>
                      <View style={{ flex: 1 }}>
                        <MathText text={item.title} style={styles.itemTitle} />
                      </View>
                    </View>
                    {item.description && (
                      <MathText text={item.description} style={styles.itemDesc} />
                    )}
                    {rationale && (
                      <Text style={styles.itemRationale}>💭 {rationale}</Text>
                    )}
                    <View style={styles.metaRow}>
                      {item.estimated_minutes != null && (
                        <View style={styles.minTag}>
                          <Text style={styles.minTagText}>
                            ~{item.estimated_minutes} 分
                          </Text>
                        </View>
                      )}
                    </View>
                    <View style={styles.actionRow}>
                      {isRest ? (
                        <Pressable
                          style={[styles.btn, styles.btnDo]}
                          onPress={() => handleDo(item)}
                        >
                          <Text style={styles.btnDoText}>知道了</Text>
                        </Pressable>
                      ) : (
                        <>
                          <Pressable
                            style={[styles.btn, styles.btnDo]}
                            onPress={() => handleDo(item)}
                          >
                            <Text style={styles.btnDoText}>去做</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.btn, styles.btnSkip]}
                            onPress={() => handleSkip(item)}
                          >
                            <Text style={styles.btnSkipText}>跳过</Text>
                          </Pressable>
                        </>
                      )}
                    </View>
                  </View>
                )
              })}
            </View>
          )}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f0fdf4', // 浅黄绿
    borderWidth: 1,
    borderColor: '#bbf7d0',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTouch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#14532d',
  },
  chev: { fontSize: 12, color: '#16a34a' },
  refreshBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#86efac',
  },
  refreshBtnText: { fontSize: 12, color: '#15803d' },
  countLine: {
    fontSize: 11,
    color: colors.slate500,
  },
  emptyText: {
    fontSize: 13,
    color: colors.slate500,
    paddingVertical: 8,
  },
  grid: {
    gap: 10,
    marginTop: 4,
  },
  gridTwoCol: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  item: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#dcfce7',
    gap: 6,
  },
  itemHalf: {
    width: '48.5%',
  },
  itemTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemEmoji: { fontSize: 18 },
  itemTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: colors.slate900,
    lineHeight: 20,
  },
  itemDesc: {
    fontSize: 12,
    color: colors.slate500,
    lineHeight: 17,
  },
  itemRationale: {
    fontSize: 12,
    fontStyle: 'italic',
    color: '#7c3aed',
    lineHeight: 17,
  },
  metaRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  minTag: {
    backgroundColor: '#ecfccb',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  minTagText: {
    fontSize: 11,
    color: '#4d7c0f',
    fontWeight: '500',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  btn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  btnDo: {
    backgroundColor: '#16a34a',
  },
  btnDoText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  btnSkip: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.divider,
  },
  btnSkipText: { color: colors.slate500, fontSize: 13 },
})
