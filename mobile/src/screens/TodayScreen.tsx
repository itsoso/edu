import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, Task, Checkin } from '../lib/api'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

function todayStr(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function dowFromDate(d: Date): number {
  const js = d.getDay()
  return js === 0 ? 7 : js
}

export default function TodayScreen() {
  const { user, logout } = useAuth()
  const { hPadding } = useResponsive()
  const [week, setWeek] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const today = todayStr()
  const dow = dowFromDate(new Date())

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [ts, cks] = await Promise.all([
        api.listTasks(week, dow),
        api.listCheckins(today),
      ])
      setTasks(ts)
      setCheckins(cks)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [week, dow, today])

  useEffect(() => {
    load()
  }, [load])

  async function toggleTask(task: Task) {
    const done = checkins.some((c) => c.task_id === task.id)
    try {
      await api.upsertCheckin({
        task_id: task.id,
        checkin_date: today,
        completed: !done,
      })
      const fresh = await api.listCheckins(today)
      setCheckins(fresh)
    } catch (e: any) {
      Alert.alert('打卡失败', String(e?.message || e))
    }
  }

  const doneSet = useMemo(
    () => new Set(checkins.map((c) => c.task_id)),
    [checkins]
  )
  const doneCount = tasks.filter((t) => doneSet.has(t.id)).length
  const totalMins = tasks.reduce((s, t) => s + t.minutes, 0)
  const doneMins = tasks
    .filter((t) => doneSet.has(t.id))
    .reduce((s, t) => s + t.minutes, 0)

  async function handleLogout() {
    Alert.alert('确认退出?', undefined, [
      { text: '取消', style: 'cancel' },
      { text: '退出', style: 'destructive', onPress: async () => await logout() },
    ])
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>今日 · {today}</Text>
            <Text style={styles.subtitle}>
              {user?.display_name} · 第 {week} 周 · 周
              {'一二三四五六日'[dow - 1]}
            </Text>
          </View>
          <Pressable onPress={handleLogout} hitSlop={8}>
            <Text style={styles.logoutText}>退出</Text>
          </Pressable>
        </View>

        {user?.role === 'student' && user.join_code && (
          <View style={styles.joinCard}>
            <Text style={styles.joinCardTitle}>👨‍👩‍👧 家长绑定码</Text>
            <Text style={styles.joinCode}>{user.join_code}</Text>
            <Text style={styles.joinHint}>
              让家长注册时输入这个 6 位码就能看到你的数据
            </Text>
          </View>
        )}

        {/* 周选择 */}
        <View style={styles.weekRow}>
          <Text style={styles.weekLabel}>第</Text>
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
                {w}
              </Text>
            </Pressable>
          ))}
          <Text style={styles.weekLabel}>周</Text>
        </View>

        {/* 进度条 */}
        {tasks.length > 0 && (
          <View style={styles.progressWrap}>
            <Text style={styles.progressText}>
              完成 <Text style={styles.progressNumber}>{doneCount}</Text> /{' '}
              {tasks.length} · 用时 {doneMins} / {totalMins} 分钟
            </Text>
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${
                      tasks.length ? (doneCount / tasks.length) * 100 : 0
                    }%`,
                  },
                ]}
              />
            </View>
          </View>
        )}

        {/* 任务列表 */}
        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : tasks.length === 0 ? (
          <Text style={styles.emptyText}>
            今天没有任务 (可能是周末补习日). 去计划页面看看其他天的任务.
          </Text>
        ) : (
          tasks.map((t) => {
            const done = doneSet.has(t.id)
            return (
              <Pressable
                key={t.id}
                onPress={() => toggleTask(t)}
                style={[styles.taskCard, done && styles.taskCardDone]}
              >
                <View style={[styles.checkbox, done && styles.checkboxDone]}>
                  {done && <Text style={styles.checkmark}>✓</Text>}
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.taskTitleRow}>
                    {t.subject && (
                      <View style={styles.subjectBadge}>
                        <Text style={styles.subjectBadgeText}>{t.subject}</Text>
                      </View>
                    )}
                    <Text
                      style={[styles.taskTitle, done && styles.taskTitleDone]}
                    >
                      {t.title}
                    </Text>
                    <Text style={styles.taskMinutes}>{t.minutes}分</Text>
                  </View>
                  {t.description && (
                    <Text
                      style={[styles.taskDesc, done && styles.taskDescDone]}
                    >
                      {t.description}
                    </Text>
                  )}
                </View>
              </Pressable>
            )
          })
        )}

        <Text style={styles.footer}>
          📱 这是 React Native 版本的 MVP{'\n'}完整功能请访问 Web 版
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 14, color: colors.slate500, marginTop: 4 },
  logoutText: { fontSize: 14, color: colors.slate500 },

  joinCard: {
    backgroundColor: '#fffbeb',
    borderWidth: 1,
    borderColor: '#fcd34d',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  joinCardTitle: { fontSize: 13, color: '#b45309', fontWeight: '600' },
  joinCode: {
    fontSize: 28,
    fontWeight: '700',
    color: '#b45309',
    letterSpacing: 6,
    marginTop: 8,
    fontFamily: 'Menlo',
  },
  joinHint: { fontSize: 12, color: colors.slate600, marginTop: 8 },

  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  weekLabel: { fontSize: 13, color: colors.slate500 },
  weekPill: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  weekPillText: { fontSize: 14, color: colors.slate700 },
  weekPillTextActive: { color: '#fff', fontWeight: '600' },

  progressWrap: { marginBottom: 16 },
  progressText: { fontSize: 13, color: colors.slate600, marginBottom: 6 },
  progressNumber: { color: colors.brand, fontWeight: '700' },
  progressTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  progressFill: { height: '100%', backgroundColor: colors.brand },

  taskCard: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    gap: 12,
  },
  taskCardDone: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxDone: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 14 },
  taskTitleRow: {
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
  taskTitle: { fontSize: 15, fontWeight: '500', color: colors.slate900, flex: 1 },
  taskTitleDone: {
    color: colors.slate400,
    textDecorationLine: 'line-through',
  },
  taskMinutes: { fontSize: 11, color: colors.slate400 },
  taskDesc: { fontSize: 13, color: colors.slate600, marginTop: 4 },
  taskDescDone: { color: colors.slate400 },

  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    paddingVertical: 40,
    fontSize: 14,
  },
  errorText: {
    color: colors.red500,
    fontSize: 13,
    padding: 16,
    textAlign: 'center',
  },
  footer: {
    textAlign: 'center',
    color: colors.slate400,
    fontSize: 11,
    marginTop: 32,
  },
})
