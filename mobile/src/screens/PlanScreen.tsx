/**
 * 计划 (Plan) — 一周任务总览, 支持本周跳过 / 替换 / 恢复默认.
 *
 * 端口自 frontend/src/pages/Plan.tsx. 保持相同文案与交互语义:
 *   - 周选择 1-4, 展示 WEEK_THEMES 标题与建议目标
 *   - 按天 (周一-周日) 分组渲染任务卡片
 *   - 只有"今天"的任务可打卡, 其他天只读 (提示"今天可打卡")
 *   - 跳过的任务半透明 + "已跳过 · 恢复"按钮
 *   - 每张卡带小操作按钮: 跳过本周 / 替换 / 恢复默认
 *   - 替换弹 Modal, 编辑标题 / 描述 / 分钟
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, Task, Checkin } from '../lib/api'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import { useToast } from '../components/Toast'

const WEEK_THEMES: Record<number, { title: string; goal: string }> = {
  1: { title: '第 1 周 · 摸底与修复', goal: '找到数学失分规律' },
  2: { title: '第 2 周 · 数学稳基 + 社会框架', goal: '把该拿的分拿稳' },
  3: { title: '第 3 周 · 语文止下滑 + 英语精进', goal: '语文答题模板 + 英语句型库' },
  4: { title: '第 4 周 · 综合模考 + 查漏', goal: '全真模考并制定下阶段目标' },
}

const DOW_LABEL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dowFromDate(d: Date): number {
  const js = d.getDay()
  return js === 0 ? 7 : js
}

function currentWeekStart(): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export default function PlanScreen() {
  const toast = useToast()
  const { hPadding } = useResponsive()
  const [week, setWeek] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 替换编辑弹窗
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editDesc, setEditDesc] = useState('')
  const [editMinutes, setEditMinutes] = useState('')
  const [saving, setSaving] = useState(false)

  const weekStart = currentWeekStart()
  const today = todayStr()
  const todayDow = dowFromDate(new Date())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ts, cks] = await Promise.all([
        api.listTasks(week, undefined, weekStart),
        api.listCheckins(today),
      ])
      setTasks(ts)
      setCheckins(cks)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [week, weekStart, today])

  useEffect(() => {
    load()
  }, [load])

  const grouped = useMemo(() => {
    const out: Record<number, Task[]> = {}
    for (const t of tasks) {
      ;(out[t.day_of_week] ||= []).push(t)
    }
    return out
  }, [tasks])

  const doneSet = useMemo(
    () => new Set(checkins.map((c) => c.task_id)),
    [checkins]
  )

  async function toggle(t: Task) {
    if (t.override_action === 'skip') {
      toast.info('这个任务本周已跳过. 先恢复默认才能打卡.')
      return
    }
    if (t.day_of_week !== todayDow) {
      toast.info('今天可打卡. 其他天只能查看.')
      return
    }
    try {
      const nextCompleted = !doneSet.has(t.id)
      await api.upsertCheckin({
        task_id: t.id,
        checkin_date: today,
        completed: nextCompleted,
      })
      signals.track('task.checkin.toggle', {
        related_table: 'tasks',
        related_id: t.id,
        payload: {
          completed: nextCompleted,
          hour_of_day: new Date().getHours(),
        },
      })
      const cks = await api.listCheckins(today)
      setCheckins(cks)
    } catch (e: any) {
      toast.error('打卡失败: ' + (e?.message || e))
    }
  }

  async function skipTask(t: Task) {
    try {
      await api.overrideTask(t.id, { week_start: weekStart, action: 'skip' })
      signals.track('task.override.skip', {
        related_table: 'tasks',
        related_id: t.id,
        payload: { week: t.week },
      })
      toast.success('本周跳过')
      load()
    } catch (e: any) {
      toast.error('操作失败: ' + (e?.message || e))
    }
  }

  async function restoreDefault(t: Task) {
    try {
      await api.clearTaskOverride(t.id, weekStart)
      toast.success('已恢复默认')
      load()
    } catch (e: any) {
      toast.error('恢复失败: ' + (e?.message || e))
    }
  }

  function startEdit(t: Task) {
    setEditingTask(t)
    setEditTitle(t.effective_title || t.title)
    setEditDesc(t.effective_description || t.description || '')
    setEditMinutes(String(t.effective_minutes || t.minutes))
  }

  function cancelEdit() {
    setEditingTask(null)
    setEditTitle('')
    setEditDesc('')
    setEditMinutes('')
  }

  async function saveEdit() {
    if (!editingTask) return
    const title = editTitle.trim()
    if (!title) {
      toast.error('标题不能为空')
      return
    }
    const minsNum = parseInt(editMinutes, 10)
    setSaving(true)
    try {
      await api.overrideTask(editingTask.id, {
        week_start: weekStart,
        action: 'replace',
        custom_title: title,
        custom_description: editDesc.trim() || undefined,
        custom_minutes: Number.isFinite(minsNum) && minsNum > 0 ? minsNum : undefined,
      })
      signals.track('task.override.replace', {
        related_table: 'tasks',
        related_id: editingTask.id,
        payload: { week: editingTask.week },
      })
      toast.success('换成了你自己的版本')
      cancelEdit()
      load()
    } catch (e: any) {
      toast.error('保存失败: ' + (e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  const theme = WEEK_THEMES[week]

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>4 周执行计划</Text>
          <Text style={styles.subtitle}>
            这是一份建议模板. 任何任务你都可以跳过 / 换成自己的话.
          </Text>
        </View>

        {/* 周选择 */}
        <View style={styles.weekRow}>
          {[1, 2, 3, 4].map((w) => (
            <Pressable
              key={w}
              onPress={() => setWeek(w)}
              style={[styles.weekPill, week === w && styles.weekPillActive]}
            >
              <Text
                style={[
                  styles.weekPillText,
                  week === w && styles.weekPillTextActive,
                ]}
              >
                第 {w} 周
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 主题卡 */}
        <View style={styles.themeCard}>
          <Text style={styles.themeTitle}>{theme.title}</Text>
          <Text style={styles.themeGoal}>建议核心目标: {theme.goal}</Text>
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* 分天任务 */}
        {[1, 2, 3, 4, 5, 6, 7].map((d) => {
          const dayTasks = grouped[d] || []
          if (dayTasks.length === 0) return null
          const activeTasks = dayTasks.filter((t) => t.override_action !== 'skip')
          const doneOfDay = activeTasks.filter((t) => doneSet.has(t.id)).length
          const mins = activeTasks.reduce(
            (s, t) => s + (t.effective_minutes || t.minutes),
            0
          )
          const isToday = d === todayDow
          return (
            <View
              key={d}
              style={[styles.daySection, isToday && styles.daySectionToday]}
            >
              <View style={styles.dayHeader}>
                <View style={styles.dayHeaderLeft}>
                  <Text style={styles.dayLabel}>{DOW_LABEL[d - 1]}</Text>
                  {isToday && (
                    <View style={styles.todayBadge}>
                      <Text style={styles.todayBadgeText}>今天</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.dayMeta}>
                  {doneOfDay} / {activeTasks.length} · {mins} 分钟
                </Text>
              </View>
              <View style={styles.dayBody}>
                {dayTasks.map((t, idx) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    done={doneSet.has(t.id)}
                    checkable={isToday}
                    isLast={idx === dayTasks.length - 1}
                    onToggle={() => toggle(t)}
                    onSkip={() => skipTask(t)}
                    onEdit={() => startEdit(t)}
                    onRestore={() => restoreDefault(t)}
                  />
                ))}
              </View>
            </View>
          )
        })}

        {!loading && tasks.length === 0 && !error && (
          <Text style={styles.emptyText}>本周暂无任务.</Text>
        )}
      </ScrollView>

      {/* 替换编辑 Modal */}
      <Modal
        visible={editingTask !== null}
        animationType="slide"
        transparent
        onRequestClose={cancelEdit}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalBackdrop}
        >
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>换成你自己的版本</Text>
            {editingTask && (
              <Text style={styles.modalHint}>原模板: {editingTask.title}</Text>
            )}
            <Text style={styles.fieldLabel}>标题</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="用你自己的话写这个任务"
              placeholderTextColor={colors.slate400}
              style={styles.input}
            />
            <Text style={styles.fieldLabel}>描述 (可选)</Text>
            <TextInput
              value={editDesc}
              onChangeText={setEditDesc}
              placeholder="详细说明"
              placeholderTextColor={colors.slate400}
              style={[styles.input, styles.inputMultiline]}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />
            <Text style={styles.fieldLabel}>分钟</Text>
            <TextInput
              value={editMinutes}
              onChangeText={setEditMinutes}
              placeholder="30"
              placeholderTextColor={colors.slate400}
              style={styles.input}
              keyboardType="number-pad"
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={cancelEdit}
                style={[styles.btn, styles.btnGhost]}
                disabled={saving}
              >
                <Text style={styles.btnGhostText}>取消</Text>
              </Pressable>
              <Pressable
                onPress={saveEdit}
                style={[styles.btn, styles.btnPrimary, saving && { opacity: 0.6 }]}
                disabled={saving}
              >
                <Text style={styles.btnPrimaryText}>
                  {saving ? '保存中…' : '保存'}
                </Text>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

type TaskRowProps = {
  task: Task
  done: boolean
  checkable: boolean
  isLast: boolean
  onToggle: () => void
  onSkip: () => void
  onEdit: () => void
  onRestore: () => void
}

function TaskRow({
  task: t,
  done,
  checkable,
  isLast,
  onToggle,
  onSkip,
  onEdit,
  onRestore,
}: TaskRowProps) {
  const skipped = t.override_action === 'skip'
  const replaced = t.override_action === 'replace'
  const title = t.effective_title || t.title
  const desc = t.effective_description || t.description
  const mins = t.effective_minutes || t.minutes

  if (skipped) {
    return (
      <View
        style={[
          styles.row,
          !isLast && styles.rowDivider,
          { opacity: 0.55 },
        ]}
      >
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            {t.subject && (
              <View style={styles.subjectBadge}>
                <Text style={styles.subjectBadgeText}>{t.subject}</Text>
              </View>
            )}
            <Text style={[styles.taskTitle, styles.strikethrough]}>{title}</Text>
            <Text style={styles.minutes}>{mins} 分</Text>
          </View>
          {desc ? <Text style={styles.desc}>{desc}</Text> : null}
        </View>
        <Pressable onPress={onRestore} style={styles.skipRestoreBtn} hitSlop={6}>
          <Text style={styles.skipRestoreText}>已跳过 · 恢复</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <View style={[styles.row, !isLast && styles.rowDivider]}>
      <Pressable
        onPress={onToggle}
        style={[
          styles.checkbox,
          done && styles.checkboxDone,
          !checkable && styles.checkboxDisabled,
        ]}
        hitSlop={6}
      >
        {done && <Text style={styles.checkmark}>✓</Text>}
      </Pressable>
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          {t.subject && (
            <View style={styles.subjectBadge}>
              <Text style={styles.subjectBadgeText}>{t.subject}</Text>
            </View>
          )}
          {replaced && (
            <View style={styles.replacedBadge}>
              <Text style={styles.replacedBadgeText}>我的版本</Text>
            </View>
          )}
          <Text
            style={[
              styles.taskTitle,
              done && styles.strikethrough,
              done && { color: colors.slate400 },
            ]}
          >
            {title}
          </Text>
          <Text style={styles.minutes}>{mins} 分</Text>
        </View>
        {desc ? (
          <Text
            style={[styles.desc, done && { color: colors.slate400 }]}
          >
            {desc}
          </Text>
        ) : null}
        {replaced && (
          <Text style={styles.origTemplate}>原模板: {t.title}</Text>
        )}
        {!checkable && (
          <Text style={styles.readonlyHint}>今天可打卡</Text>
        )}
        <View style={styles.actionRow}>
          {!replaced && (
            <Pressable onPress={onEdit} hitSlop={6}>
              <Text style={styles.actionText}>替换</Text>
            </Pressable>
          )}
          {replaced && (
            <>
              <Pressable onPress={onEdit} hitSlop={6}>
                <Text style={styles.actionText}>再改</Text>
              </Pressable>
              <Pressable onPress={onRestore} hitSlop={6}>
                <Text style={styles.actionText}>恢复默认</Text>
              </Pressable>
            </>
          )}
          {!replaced && (
            <Pressable onPress={onSkip} hitSlop={6}>
              <Text style={[styles.actionText, styles.actionDanger]}>
                跳过本周
              </Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },

  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },

  weekRow: { flexDirection: 'row', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  weekPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  weekPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  weekPillText: { fontSize: 13, color: colors.slate700, fontWeight: '500' },
  weekPillTextActive: { color: '#fff' },

  themeCard: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: '#dbeafe',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  themeTitle: { fontSize: 15, fontWeight: '600', color: '#1d4ed8' },
  themeGoal: { fontSize: 13, color: colors.slate600, marginTop: 4 },

  daySection: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    marginBottom: 12,
    overflow: 'hidden',
  },
  daySectionToday: {
    borderColor: colors.brand,
    borderWidth: 2,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#f8fafc',
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  dayHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dayLabel: { fontSize: 14, fontWeight: '600', color: colors.slate800 },
  todayBadge: {
    backgroundColor: colors.brand,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  todayBadgeText: { color: '#fff', fontSize: 10, fontWeight: '600' },
  dayMeta: { fontSize: 11, color: colors.slate500 },

  dayBody: {},

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxDisabled: { opacity: 0.4 },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 13 },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  subjectBadge: {
    backgroundColor: colors.brandLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  subjectBadgeText: { fontSize: 11, color: colors.brand, fontWeight: '500' },
  replacedBadge: {
    backgroundColor: '#fef3c7',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  replacedBadgeText: { fontSize: 11, color: '#b45309', fontWeight: '500' },
  taskTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.slate900,
    flexShrink: 1,
  },
  strikethrough: { textDecorationLine: 'line-through' },
  minutes: { fontSize: 11, color: colors.slate400 },
  desc: { fontSize: 13, color: colors.slate600, marginTop: 4 },
  origTemplate: { fontSize: 10, color: colors.slate400, marginTop: 4 },
  readonlyHint: { fontSize: 11, color: colors.slate400, marginTop: 6 },

  actionRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
  },
  actionText: { fontSize: 12, color: colors.slate500 },
  actionDanger: { color: colors.red500 },

  skipRestoreBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    alignSelf: 'flex-start',
  },
  skipRestoreText: { fontSize: 12, color: colors.slate600 },

  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    paddingVertical: 40,
    fontSize: 14,
  },
  errorText: {
    color: colors.red500,
    fontSize: 13,
    padding: 12,
    textAlign: 'center',
  },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 32,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: colors.slate900 },
  modalHint: { fontSize: 12, color: colors.slate500, marginTop: 4, marginBottom: 12 },
  fieldLabel: {
    fontSize: 12,
    color: colors.slate600,
    marginTop: 10,
    marginBottom: 4,
    fontWeight: '500',
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.slate900,
    backgroundColor: '#fff',
  },
  inputMultiline: { minHeight: 72 },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  btn: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
  },
  btnGhost: { borderWidth: 1, borderColor: colors.border, backgroundColor: '#fff' },
  btnGhostText: { color: colors.slate700, fontSize: 14, fontWeight: '500' },
  btnPrimary: { backgroundColor: colors.brand },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
})
