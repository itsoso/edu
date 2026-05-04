/**
 * 周目标仪式 — RN 版, 对齐 web 的状态机:
 *  - 已有 goal → 折叠卡片 + 编辑
 *  - 没 goal 未展开 → 虚线入口
 *  - 展开 → 4 个 focus 选项 + textarea + 保存/清除
 */
import React, { useEffect, useState } from 'react'
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { api, WeeklyGoal } from '../lib/api'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useToast } from './Toast'

type FocusType = 'redo_mistakes' | 'learn_new' | 'challenge' | 'custom'

const FOCUS_OPTIONS: {
  key: FocusType
  icon: string
  label: string
  hint: string
  placeholder: string
}[] = [
  {
    key: 'redo_mistakes',
    icon: '🔁',
    label: '重做错题',
    hint: '把上周没懂的那几道题再做一遍',
    placeholder: '例: 把上周数学错的 5 道方程题再做一遍',
  },
  {
    key: 'learn_new',
    icon: '🌱',
    label: '学点新东西',
    hint: '一个具体的知识点 / 一个新概念',
    placeholder: '例: 学会一元二次方程的判别式',
  },
  {
    key: 'challenge',
    icon: '💪',
    label: '挑战更难的',
    hint: '敢不敢试一道更难的题 / 更高级的方法',
    placeholder: '例: 做一道去年中考压轴题',
  },
  {
    key: 'custom',
    icon: '✍️',
    label: '我有自己的想法',
    hint: '写下你这周真正想做的事',
    placeholder: '写下你这周真正想做的事...',
  },
]

export default function WeeklyGoalCeremony({ weekStart }: { weekStart: string }) {
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [existing, setExisting] = useState<WeeklyGoal | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selectedFocus, setSelectedFocus] = useState<FocusType | null>(null)
  const [goalText, setGoalText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getWeeklyGoal(weekStart)
      .then((r) => {
        if (r.exists) {
          setExisting(r as WeeklyGoal)
          setGoalText((r as any).goal_text || '')
          setSelectedFocus(((r as any).focus_type as FocusType) || null)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [weekStart])

  async function submit() {
    const text = goalText.trim()
    if (!text) {
      toast.error('写一句话告诉自己想攻克什么')
      return
    }
    setSaving(true)
    try {
      const saved = await api.upsertWeeklyGoal({
        week_start: weekStart,
        goal_text: text,
        focus_type: selectedFocus || undefined,
      })
      signals.track('weekly_goal.set', {
        related_table: 'weekly_goals',
        related_id: saved.id,
        payload: {
          focus_type: selectedFocus || 'custom',
          week_start: weekStart,
        },
      })
      setExisting(saved)
      setExpanded(false)
      toast.success('这周目标已定 · 开始吧')
    } catch (e: any) {
      toast.error('保存失败: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  function clearConfirm() {
    Alert.alert('清除本周目标?', '你可以再重新设定', [
      { text: '取消', style: 'cancel' },
      {
        text: '清除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteWeeklyGoal(weekStart)
            setExisting(null)
            setGoalText('')
            setSelectedFocus(null)
            setExpanded(false)
          } catch (e: any) {
            toast.error('失败: ' + (e?.message || e))
          }
        },
      },
    ])
  }

  if (!loaded) return null

  // 状态 1: 已有 goal
  if (existing && !expanded) {
    const focusMeta = FOCUS_OPTIONS.find((o) => o.key === existing.focus_type)
    return (
      <View style={styles.doneCard}>
        <Text style={styles.doneIcon}>{focusMeta?.icon || '🎯'}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.doneLabel}>这周的目标</Text>
          <Text style={styles.doneText}>{existing.goal_text}</Text>
        </View>
        <Pressable onPress={() => setExpanded(true)} hitSlop={8}>
          <Text style={styles.editBtn}>编辑</Text>
        </Pressable>
      </View>
    )
  }

  // 状态 2: 入口
  if (!existing && !expanded) {
    return (
      <Pressable onPress={() => setExpanded(true)} style={styles.entryCard}>
        <Text style={styles.entryIcon}>🎯</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.entryTitle}>这周你最想攻克什么?</Text>
          <Text style={styles.entryHint}>
            30 秒定一个小目标 · 这周的任务会围绕它展开
          </Text>
        </View>
        <Text style={styles.entryArrow}>→</Text>
      </Pressable>
    )
  }

  const placeholder =
    FOCUS_OPTIONS.find((o) => o.key === selectedFocus)?.placeholder ||
    '写下你这周真正想做的事...'

  return (
    <View style={styles.expandedCard}>
      <View style={styles.headerRow}>
        <Text style={styles.expandedTitle}>这周你想攻克什么?</Text>
        <Pressable
          onPress={() => {
            setExpanded(false)
            if (!existing) {
              setGoalText('')
              setSelectedFocus(null)
            }
          }}
          hitSlop={8}
        >
          <Text style={styles.laterBtn}>先不设 ·</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {FOCUS_OPTIONS.map((o) => {
          const active = selectedFocus === o.key
          return (
            <Pressable
              key={o.key}
              onPress={() => setSelectedFocus(o.key)}
              style={[styles.focusCard, active && styles.focusCardActive]}
            >
              <Text style={styles.focusIcon}>{o.icon}</Text>
              <Text style={styles.focusLabel}>{o.label}</Text>
              <Text style={styles.focusHint}>{o.hint}</Text>
            </Pressable>
          )
        })}
      </View>

      <View>
        <Text style={styles.textareaLabel}>
          用一句话说清楚这周的目标 · 越具体越好
        </Text>
        <TextInput
          value={goalText}
          onChangeText={setGoalText}
          placeholder={placeholder}
          placeholderTextColor={colors.slate400}
          multiline
          maxLength={500}
          style={styles.textarea}
        />
        <Text style={styles.counter}>{goalText.length} / 500</Text>
      </View>

      <View style={styles.footerRow}>
        <Pressable
          onPress={submit}
          disabled={saving || !goalText.trim()}
          style={[
            styles.saveBtn,
            (saving || !goalText.trim()) && styles.saveBtnDisabled,
          ]}
        >
          <Text style={styles.saveBtnText}>
            {saving ? '保存中...' : '定下来, 开始'}
          </Text>
        </Pressable>
        {existing && (
          <Pressable onPress={clearConfirm} hitSlop={8}>
            <Text style={styles.clearBtn}>清除</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  doneCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 10,
    padding: 14,
  },
  doneIcon: { fontSize: 22 },
  doneLabel: { fontSize: 11, color: '#b45309', fontWeight: '600' },
  doneText: { fontSize: 14, color: colors.slate800, marginTop: 4, lineHeight: 20 },
  editBtn: { fontSize: 12, color: colors.slate500 },

  entryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderStyle: 'dashed',
    borderRadius: 10,
    padding: 14,
  },
  entryIcon: { fontSize: 22 },
  entryTitle: { fontSize: 15, fontWeight: '500', color: colors.slate800 },
  entryHint: { fontSize: 11, color: colors.slate500, marginTop: 2 },
  entryArrow: { fontSize: 16, color: colors.slate400 },

  expandedCard: {
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#93c5fd',
    borderRadius: 10,
    padding: 16,
    gap: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  expandedTitle: { fontSize: 15, fontWeight: '600', color: colors.slate800 },
  laterBtn: { fontSize: 11, color: colors.slate400 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  focusCard: {
    width: '48%',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: '#fff',
  },
  focusCardActive: { backgroundColor: colors.brandLight, borderColor: colors.brand },
  focusIcon: { fontSize: 18 },
  focusLabel: { fontSize: 13, fontWeight: '500', color: colors.slate800, marginTop: 4 },
  focusHint: { fontSize: 11, color: colors.slate500, marginTop: 2, lineHeight: 15 },

  textareaLabel: { fontSize: 11, color: colors.slate600 },
  textarea: {
    marginTop: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
    minHeight: 60,
    textAlignVertical: 'top',
  },
  counter: { fontSize: 10, color: colors.slate400, textAlign: 'right', marginTop: 4 },

  footerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  saveBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.brand,
    borderRadius: 6,
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  clearBtn: { fontSize: 11, color: colors.red500 },
})
