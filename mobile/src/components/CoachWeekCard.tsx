/**
 * CoachWeekCard — Dashboard 的本周复盘预览卡.
 *
 * 不存在 → 不渲染.
 * generating → 灰色等待卡.
 * done → 显示 focus_for_next_week + 跳转完整复盘的入口.
 */
import React, { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { api, CoachReview } from '../lib/api'
import { colors } from '../lib/theme'

export default function CoachWeekCard() {
  const [review, setReview] = useState<CoachReview | null>(null)
  const navigation = useNavigation<any>()

  useEffect(() => {
    let cancelled = false
    api
      .getCoachThisWeek()
      .then((r) => {
        if (cancelled) return
        setReview(r)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!review || !review.exists) return null

  if (review.status === 'generating') {
    return (
      <View style={[styles.card, styles.cardMuted]}>
        <Text style={styles.mutedText}>
          本周复盘 AI 写作中, 一会儿来看
        </Text>
      </View>
    )
  }

  if (review.status !== 'done') return null

  const focus = review.highlights?.focus_for_next_week || ''

  return (
    <Pressable
      style={styles.card}
      onPress={() => navigation.navigate('Coach')}
    >
      <View style={styles.headerRow}>
        <Text style={styles.title}>📅 本周回顾</Text>
        <Text style={styles.weekStart}>{review.week_start}</Text>
      </View>
      {focus ? (
        <Text style={styles.focus}>{focus}</Text>
      ) : (
        <Text style={styles.mutedText}>本周复盘已生成</Text>
      )}
      <Text style={styles.cta}>看完整复盘 →</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 16,
  },
  cardMuted: {
    backgroundColor: '#f8fafc',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  weekStart: { fontSize: 11, color: colors.slate400 },
  focus: {
    fontSize: 16,
    color: colors.slate800,
    lineHeight: 24,
    fontWeight: '500',
  },
  mutedText: {
    fontSize: 13,
    color: colors.slate500,
  },
  cta: {
    fontSize: 12,
    color: colors.brand,
    marginTop: 10,
  },
})
