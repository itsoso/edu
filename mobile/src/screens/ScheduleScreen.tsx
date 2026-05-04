/**
 * ScheduleScreen — 课程日历.
 *
 * 展示潘立言 / 潘友闻的周末课程, 方便家长接送.
 * 查看为主, 简单的添加/删除; 详细编辑走 web 端.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, Course } from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

const WEEKDAY_LABELS = ['', '周一', '周二', '周三', '周四', '周五', '周六', '周日']
const WEEKEND = [5, 6, 7]

function todayDow() {
  const js = new Date().getDay()
  return js === 0 ? 7 : js
}

export default function ScheduleScreen() {
  const { hPadding, maxContent } = useResponsive()
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [weekendOnly, setWeekendOnly] = useState(true)
  const [filterChild, setFilterChild] = useState<string>('all')
  const [children, setChildren] = useState<{ name: string; count: number }[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [cs, kids] = await Promise.all([
        api.listCourses(),
        api.listCourseChildren(),
      ])
      setCourses(cs)
      setChildren(kids)
    } catch (e: any) {
      Alert.alert('加载失败', e?.message || String(e))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const filtered = useMemo(() => {
    return courses.filter((c) => {
      if (weekendOnly && !WEEKEND.includes(c.weekday)) return false
      if (filterChild !== 'all' && c.child_name !== filterChild) return false
      return true
    })
  }, [courses, weekendOnly, filterChild])

  const grouped = useMemo(() => {
    const byChild = new Map<string, Map<number, Course[]>>()
    for (const c of filtered) {
      if (!byChild.has(c.child_name)) byChild.set(c.child_name, new Map())
      const byDay = byChild.get(c.child_name)!
      if (!byDay.has(c.weekday)) byDay.set(c.weekday, [])
      byDay.get(c.weekday)!.push(c)
    }
    return byChild
  }, [filtered])

  async function seed() {
    setBusy(true)
    try {
      const r = await api.seedFamilyCourses()
      Alert.alert('导入完成', `新增 ${r.inserted} 门 · 跳过 ${r.skipped} 门`)
      await load()
    } catch (e: any) {
      Alert.alert('导入失败', e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  async function remove(c: Course) {
    Alert.alert(
      '删除课程',
      `要删除「${c.child_name} · ${c.course_name}」吗?`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deleteCourse(c.id)
              await load()
            } catch (e: any) {
              Alert.alert('删除失败', e?.message || String(e))
            }
          },
        },
      ],
    )
  }

  const today = todayDow()

  if (loading) {
    return (
      <SafeAreaView style={styles.root} edges={['top']}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingHorizontal: hPadding, maxWidth: maxContent, alignSelf: 'center', width: '100%' },
        ]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              load()
            }}
          />
        }
      >
        <Text style={styles.h1}>课程日历</Text>
        <Text style={styles.subtitle}>周末接送一眼看清</Text>

        <View style={styles.toolbar}>
          <View style={styles.row}>
            <Text style={styles.toolbarLabel}>只看周末</Text>
            <Switch
              value={weekendOnly}
              onValueChange={setWeekendOnly}
              trackColor={{ true: colors.brand, false: colors.divider }}
            />
          </View>

          <View style={[styles.row, { flexWrap: 'wrap', gap: 6 }]}>
            <Pressable
              onPress={() => setFilterChild('all')}
              style={[styles.chip, filterChild === 'all' && styles.chipActive]}
            >
              <Text
                style={[
                  styles.chipText,
                  filterChild === 'all' && styles.chipTextActive,
                ]}
              >
                全部
              </Text>
            </Pressable>
            {children.map((k) => (
              <Pressable
                key={k.name}
                onPress={() => setFilterChild(k.name)}
                style={[styles.chip, filterChild === k.name && styles.chipActive]}
              >
                <Text
                  style={[
                    styles.chipText,
                    filterChild === k.name && styles.chipTextActive,
                  ]}
                >
                  {k.name} ({k.count})
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {courses.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>还没有课程记录</Text>
            <Pressable
              disabled={busy}
              onPress={seed}
              style={[styles.primaryBtn, busy && { opacity: 0.5 }]}
            >
              <Text style={styles.primaryBtnText}>
                {busy ? '导入中...' : '一键导入家庭课表'}
              </Text>
            </Pressable>
            <Text style={styles.hint}>
              （包含潘立言、潘友闻的周末课）
            </Text>
          </View>
        ) : filtered.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyText}>当前筛选下没有课程</Text>
          </View>
        ) : (
          <View>
            {Array.from(grouped.entries()).map(([child, byDay]) => {
              const days = Array.from(byDay.keys()).sort((a, b) => a - b)
              return (
                <View key={child} style={styles.childCard}>
                  <Text style={styles.childTitle}>👧 {child}</Text>
                  {days.map((d) => (
                    <View key={d} style={styles.dayGroup}>
                      <Text
                        style={[
                          styles.dayLabel,
                          (d === 6 || d === 7) && styles.dayLabelWeekend,
                          d === today && styles.dayLabelToday,
                        ]}
                      >
                        {WEEKDAY_LABELS[d]}
                        {d === today ? ' · 今天' : ''}
                      </Text>
                      {byDay.get(d)!.map((c) => (
                        <CourseRow
                          key={c.id}
                          course={c}
                          onDelete={() => remove(c)}
                        />
                      ))}
                    </View>
                  ))}
                </View>
              )
            })}
          </View>
        )}

        <Text style={styles.footerHint}>
          详细编辑（接送备注、时间修改）请在 Web 端 /schedule 页面操作。
        </Text>
      </ScrollView>
    </SafeAreaView>
  )
}

function CourseRow({
  course,
  onDelete,
}: {
  course: Course
  onDelete: () => void
}) {
  return (
    <View style={styles.courseRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.courseName}>{course.course_name}</Text>
        <Text style={styles.courseTime}>
          {course.start_time} - {course.end_time}
        </Text>
        {!!course.location && (
          <Text style={styles.courseMeta}>📍 {course.location}</Text>
        )}
        {!!course.pickup_note && (
          <Text style={styles.coursePickup}>🚗 {course.pickup_note}</Text>
        )}
      </View>
      <Pressable onPress={onDelete} style={styles.delBtn}>
        <Text style={styles.delBtnText}>删除</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { paddingVertical: 16, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  h1: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { marginTop: 4, fontSize: 13, color: colors.slate500 },
  toolbar: {
    marginTop: 14,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  toolbarLabel: { fontSize: 14, color: colors.slate700, flex: 1 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  chipActive: { backgroundColor: colors.brandLight, borderColor: colors.brand },
  chipText: { fontSize: 12, color: colors.slate600 },
  chipTextActive: { color: colors.brand, fontWeight: '600' },
  empty: {
    marginTop: 20,
    padding: 24,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.divider,
    borderStyle: 'dashed',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
  },
  emptyText: { color: colors.slate500 },
  primaryBtn: {
    backgroundColor: colors.amber500,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  primaryBtnText: { color: '#fff', fontWeight: '600' },
  hint: { fontSize: 12, color: colors.slate500 },
  childCard: {
    marginTop: 14,
    padding: 14,
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  childTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.brand,
    marginBottom: 8,
  },
  dayGroup: { marginTop: 8 },
  dayLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.slate600,
    marginBottom: 4,
  },
  dayLabelWeekend: { color: '#e11d48' },
  dayLabelToday: { color: colors.brand },
  courseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.bg,
    marginTop: 6,
  },
  courseName: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  courseTime: { fontSize: 13, color: colors.slate600, marginTop: 2 },
  courseMeta: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  coursePickup: { fontSize: 12, color: '#b45309', marginTop: 2 },
  delBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  delBtnText: { color: colors.red500, fontSize: 12 },
  footerHint: {
    marginTop: 20,
    fontSize: 12,
    color: colors.slate500,
    textAlign: 'center',
  },
})
