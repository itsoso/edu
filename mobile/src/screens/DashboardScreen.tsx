import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  api,
  Task,
  Checkin,
  DashboardSummary,
  DailyTip,
  AgentSuggestion,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import WeeklyGoalCeremony from '../components/WeeklyGoalCeremony'
import TutorCard from '../components/TutorCard'
import CuratorBlock from '../components/CuratorBlock'
import GuardianAlerts from '../components/GuardianAlerts'
import CoachWeekCard from '../components/CoachWeekCard'

type TabName =
  | 'Today'
  | 'Trends'
  | 'Mistakes'
  | 'Essays'
  | 'Scan'
  | 'Practice'
  | 'Journal'
  | 'Reports'
  | 'Methods'
  | 'Settings'

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function dowFromDate(d: Date): number {
  const js = d.getDay()
  return js === 0 ? 7 : js
}

function currentWeekStart(): string {
  const d = new Date()
  const dow = d.getDay() === 0 ? 7 : d.getDay()
  d.setDate(d.getDate() - (dow - 1))
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function describeRecent(summary: DashboardSummary): string {
  const { calendar_14d, month_distinct_days } = summary
  const days14 = calendar_14d.filter((d) => d.done > 0).length
  const total14 = calendar_14d.reduce((s, d) => s + d.done, 0)
  if (days14 === 0) {
    return '最近两周还没打卡. 任何时候开始都不算晚.'
  }
  const avg = total14 / Math.max(1, days14)
  return `最近两周你在 ${days14} 天里打卡, 平均每天 ${avg.toFixed(
    1
  )} 项. 本月共 ${month_distinct_days} 天.`
}

export default function DashboardScreen() {
  const { user, boundStudent } = useAuth()
  const { hPadding, isTablet, gridCols } = useResponsive()
  const navigation = useNavigation<any>()
  const isParent = user?.role === 'parent'
  const displayName = isParent ? boundStudent?.display_name : user?.display_name

  const today = todayStr()
  const dow = dowFromDate(new Date())
  const weekOf = currentWeekStart()

  const [week, setWeek] = useState(1)
  const [tasks, setTasks] = useState<Task[]>([])
  const [checkins, setCheckins] = useState<Checkin[]>([])
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [tip, setTip] = useState<DailyTip | null>(null)
  const [tipOpen, setTipOpen] = useState(false)
  const [joinOpen, setJoinOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  // 本周笔记
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null)

  const [weekNote, setWeekNote] = useState('')
  const [weekNoteLoaded, setWeekNoteLoaded] = useState(false)
  const [weekNoteSaved, setWeekNoteSaved] = useState(false)

  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [s, t] = await Promise.all([
        api.dashboardSummary().catch(() => null),
        api.dailyTip().catch(() => null),
      ])
      if (s) setSummary(s)
      if (t) setTip(t)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadTasks = useCallback(async () => {
    try {
      const [ts, cks] = await Promise.all([
        api.listTasks(week, dow),
        api.listCheckins(today),
      ])
      setTasks(ts)
      setCheckins(cks)
    } catch {
      /* ignore */
    }
  }, [week, dow, today])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  useEffect(() => {
    if (isParent) return
    loadTasks()
  }, [loadTasks, isParent])

  // 加载今日 Tutor 建议
  useEffect(() => {
    if (isParent) return
    let cancelled = false
    api
      .getTodaySuggestion()
      .then((r) => {
        if (cancelled) return
        if (r.exists && r.suggestion) setSuggestion(r.suggestion)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isParent])

  // 加载本周笔记
  useEffect(() => {
    if (!user?.id || isParent) return
    let cancelled = false
    api
      .listReflections({ kind: 'weekly_note', related_key: weekOf, limit: 1 })
      .then((items) => {
        if (cancelled) return
        if (items.length > 0) setWeekNote(items[0].content)
        setWeekNoteLoaded(true)
      })
      .catch(() => {
        if (!cancelled) setWeekNoteLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [weekOf, user?.id, isParent])

  // 800ms debounce 保存
  useEffect(() => {
    if (!user?.id || isParent || !weekNoteLoaded) return
    if (!weekNote.trim()) return
    const t = setTimeout(() => {
      api
        .upsertReflection({
          kind: 'weekly_note',
          related_key: weekOf,
          content: weekNote.trim(),
        })
        .then(() => {
          setWeekNoteSaved(true)
          setTimeout(() => setWeekNoteSaved(false), 1500)
        })
        .catch(() => {})
    }, 800)
    return () => clearTimeout(t)
  }, [weekNote, weekOf, user?.id, isParent, weekNoteLoaded])

  // Daily tip polling while generating
  const tipGenerating = tip?.status === 'generating'
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  useEffect(() => {
    if (!tipGenerating) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    pollRef.current = setInterval(async () => {
      try {
        const t = await api.dailyTip()
        setTip(t)
        if (t.status !== 'generating' && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch {
        /* ignore */
      }
    }, 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [tipGenerating])

  async function toggle(task: Task) {
    const done = checkins.some((c) => c.task_id === task.id)
    try {
      const nextCompleted = !done
      await api.upsertCheckin({
        task_id: task.id,
        checkin_date: today,
        completed: nextCompleted,
      })
      signals.track('task.checkin.toggle', {
        related_table: 'tasks',
        related_id: task.id,
        payload: {
          completed: nextCompleted,
          hour_of_day: new Date().getHours(),
        },
      })
      const updated = await api.listCheckins(today)
      setCheckins(updated)
      api.dashboardSummary().then(setSummary).catch(() => {})
    } catch (e: any) {
      Alert.alert('打卡失败', String(e?.message || e))
    }
  }

  async function onRefresh() {
    await Promise.all([loadAll(), isParent ? Promise.resolve() : loadTasks()])
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

  if (isParent) {
    return (
      <ParentHome
        displayName={displayName || '孩子'}
        today={today}
        onNavigate={(t) => navigation.navigate(t)}
        onRefresh={onRefresh}
        refreshing={loading}
        hPadding={hPadding}
        isTablet={isTablet}
        gridCols={gridCols}
      />
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} />}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>今日 · {today}</Text>
          <Text style={styles.subtitle}>
            {displayName}，今天是{' '}
            <Text style={styles.subtitleStrong}>
              第 {week} 周 · 周{'一二三四五六日'[dow - 1]}
            </Text>
          </Text>
        </View>

        {/* P7 Guardian — 异常监控提示 */}
        <GuardianAlerts />

        {/* Tutor Agent 主动建议 */}
        {suggestion && (
          <TutorCard
            suggestion={suggestion}
            onResolved={() => setSuggestion(null)}
          />
        )}

        {/* 今天值得做的 (Curator) */}
        <CuratorBlock onNavigate={(r, p) => navigation.navigate(r, p)} />

        {/* P6 Coach — 周日 (dow=7) / 周一 (dow=1) 显示本周复盘预览 */}
        {(dow === 7 || dow === 1) && <CoachWeekCard />}

        {/* 周目标仪式 */}
        <WeeklyGoalCeremony weekStart={weekOf} />

        {/* 主动讲知识点 — 正向输入 */}
        <Pressable
          onPress={() => navigation.navigate('FeynmanNew')}
          style={styles.feynmanCard}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.feynmanTitle}>🎓 今天学了什么新知识?</Text>
            <Text style={styles.feynmanHint}>
              讲给 AI 同学听,一两句话就够 — 讲完就知道自己是不是真的懂了。
            </Text>
          </View>
          <Text style={styles.feynmanArrow}>讲一个 →</Text>
        </Pressable>

        {/* 本周我学到了什么 */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardLabel}>本周我学到了什么</Text>
            <Text style={styles.cardHint}>
              {weekNoteSaved ? '已保存 ✓' : '只有你自己看得到 · 不会分析'}
            </Text>
          </View>
          <TextInput
            value={weekNote}
            onChangeText={setWeekNote}
            placeholder="一句话、几个词、一段话都行。周五回头看会很有意思。"
            placeholderTextColor={colors.slate400}
            style={styles.textarea}
            multiline
            maxLength={500}
            textAlignVertical="top"
          />
          <Text style={styles.counter}>{weekNote.length} / 500</Text>
        </View>

        {/* 今日任务 */}
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.sectionTitle}>今日任务</Text>
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
          </View>

          {tasks.length === 0 ? (
            <Text style={styles.emptyText}>
              没有任务（可能是周末补习日，去 计划 页面查看）
            </Text>
          ) : (
            <>
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
              <View style={{ gap: 8, marginTop: 12 }}>
                {tasks.map((t) => {
                  const done = doneSet.has(t.id)
                  return (
                    <Pressable
                      key={t.id}
                      onPress={() => toggle(t)}
                      style={[styles.taskCard, done && styles.taskCardDone]}
                    >
                      <View style={[styles.checkbox, done && styles.checkboxDone]}>
                        {done && <Text style={styles.checkmark}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <View style={styles.taskTitleRow}>
                          {t.subject && (
                            <View style={styles.subjectBadge}>
                              <Text style={styles.subjectBadgeText}>
                                {t.subject}
                              </Text>
                            </View>
                          )}
                          <Text
                            style={[styles.taskTitle, done && styles.taskTitleDone]}
                          >
                            {t.title}
                          </Text>
                          <Text style={styles.taskMinutes}>{t.minutes} 分钟</Text>
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
                })}
              </View>
            </>
          )}
        </View>

        {/* 近 14 天打卡 */}
        {summary && (
          <View style={styles.card}>
            <Text style={styles.recentText}>{describeRecent(summary)}</Text>
            <CalendarStrip days={summary.calendar_14d} today={today} />
          </View>
        )}

        {/* 折叠: AI 建议 */}
        {tip && !tip.skipped && (
          <View style={styles.foldCard}>
            <Pressable
              onPress={() => setTipOpen((o) => !o)}
              style={styles.foldSummary}
            >
              <Text style={styles.foldSummaryText}>
                💭 如果你想听 AI 说一句 (可选)
              </Text>
              <Text style={styles.foldChevron}>{tipOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {tipOpen && (
              <View style={styles.foldBody}>
                {tip.status === 'generating' && (
                  <Text style={styles.foldBodyTextMuted}>AI 正在写...</Text>
                )}
                {tip.status === 'done' && (
                  <Text style={styles.foldBodyText}>{tip.content}</Text>
                )}
                {tip.status === 'failed' && (
                  <Text style={styles.foldBodyTextMuted}>
                    AI 暂时没话说, 明天见
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {/* 折叠: Join code */}
        {user?.role === 'student' && user.join_code && (
          <View style={styles.foldCard}>
            <Pressable
              onPress={() => setJoinOpen((o) => !o)}
              style={styles.foldSummary}
            >
              <Text style={styles.foldSummaryText}>👨‍👩‍👧 家长绑定码</Text>
              <Text style={styles.foldChevron}>{joinOpen ? '▾' : '▸'}</Text>
            </Pressable>
            {joinOpen && (
              <View style={styles.foldBody}>
                <Text style={styles.joinHint}>
                  让家长注册时输入这 6 位码:
                </Text>
                <Text style={styles.joinCode}>{user.join_code}</Text>
              </View>
            )}
          </View>
        )}

        {/* 次要入口 */}
        <View style={styles.quickGrid}>
          <QuickLink
            icon="🕊️"
            title="日记"
            desc="写给自己 · 不会被分析"
            onPress={() => navigation.navigate('Journal')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
          <QuickLink
            icon="📓"
            title="错题本"
            desc="记录 + 归因 + 巩固"
            onPress={() => navigation.navigate('Mistakes')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
          <QuickLink
            icon="📸"
            title="扫试卷"
            desc="AI 识别错题"
            onPress={() => navigation.navigate('Scan')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
          <QuickLink
            icon="🏋️"
            title="训练"
            desc="基于错题的类题练习"
            onPress={() => navigation.navigate('Practice')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
          <QuickLink
            icon="📈"
            title="成绩趋势"
            desc="考试数据和走势"
            onPress={() => navigation.navigate('Trends')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
          <QuickLink
            icon="🎯"
            title="学习方法"
            desc="各科速查卡"
            onPress={() => navigation.navigate('Methods')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
          <QuickLink
            icon="📅"
            title="周计划"
            desc="编辑本周任务"
            onPress={() => navigation.navigate('Plan')}
            isTablet={isTablet}
            gridCols={gridCols}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

function CalendarStrip({
  days,
  today,
}: {
  days: { date: string; done: number }[]
  today: string
}) {
  const levelBg = [colors.divider, '#cbd5e1', colors.slate500, colors.slate700]
  return (
    <View style={styles.stripRow}>
      {days.map((d) => {
        const level = d.done === 0 ? 0 : d.done <= 2 ? 1 : d.done <= 4 ? 2 : 3
        const isToday = d.date === today
        const dayNum = d.date.slice(8)
        return (
          <View key={d.date} style={styles.stripCell}>
            <View
              style={[
                styles.stripBar,
                {
                  backgroundColor: levelBg[level],
                  height: 12 + level * 6,
                },
                isToday && styles.stripBarToday,
              ]}
            />
            <Text style={styles.stripDay}>{dayNum}</Text>
          </View>
        )
      })}
    </View>
  )
}

function QuickLink({
  icon,
  title,
  desc,
  onPress,
  isTablet,
  gridCols,
}: {
  icon: string
  title: string
  desc: string
  onPress: () => void
  isTablet: boolean
  gridCols: number
}) {
  const width = isTablet ? (gridCols === 4 ? '23%' : gridCols === 3 ? '31%' : '47.5%') : '47.5%'
  return (
    <Pressable style={[styles.quickCard, { width }]} onPress={onPress}>
      <Text style={styles.quickIcon}>{icon}</Text>
      <Text style={styles.quickTitle}>{title}</Text>
      <Text style={styles.quickDesc}>{desc}</Text>
    </Pressable>
  )
}

// -------- ParentHome --------

function ParentHome({
  displayName,
  today,
  onNavigate,
  onRefresh,
  refreshing,
  hPadding,
  isTablet,
  gridCols,
}: {
  displayName: string
  today: string
  onNavigate: (t: TabName) => void
  onRefresh: () => void | Promise<void>
  refreshing: boolean
  hPadding: number
  isTablet: boolean
  gridCols: number
}) {
  const linkWidth = isTablet ? (gridCols === 4 ? '23%' : gridCols === 3 ? '31%' : '47%') : '47%'
  const monthKey = `edu.parentPeeks.${today.slice(0, 7)}`
  const [peeks, setPeeks] = useState(0)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(monthKey)
      .then((v) => {
        const n = parseInt(v || '0', 10)
        if (!Number.isNaN(n)) setPeeks(n)
      })
      .catch(() => {})
  }, [monthKey])

  async function toggleOpen() {
    const next = !open
    setOpen(next)
    if (next) {
      const n = peeks + 1
      setPeeks(n)
      try {
        await AsyncStorage.setItem(monthKey, String(n))
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.headerBlock}>
          <Text style={styles.title}>今天 · {today}</Text>
          <Text style={styles.subtitle}>
            你是 <Text style={styles.subtitleStrong}>{displayName}</Text> 的家长视图
          </Text>
        </View>

        <GuardianAlerts />

        {(() => {
          const d = dowFromDate(new Date())
          return d === 7 || d === 1 ? <CoachWeekCard /> : null
        })()}

        <View style={styles.parentHero}>
          <Text style={styles.parentHeroTitle}>
            今天她没主动找你, 说明一切在她自己掌握中。
          </Text>
          <Text style={styles.parentHeroBody}>
            学习最重要的那部分, 数据从来看不出来——
            她在一道题卡住时皱的眉, 做对时轻微的得意, 这些数据都不知道。
          </Text>
          <Text style={styles.parentHeroBody}>
            你真正该观察的, 是她聊起学习时的表情, 不是她的打卡次数。
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.parentPromptTitle}>今天, 你可以问问自己:</Text>
          <View style={{ gap: 8 }}>
            <Text style={styles.parentPromptItem}>
              • 她这个月有没有提到过某件让她<Text style={styles.bold}>兴奋</Text>的事?
            </Text>
            <Text style={styles.parentPromptItem}>
              • 你最近一次和她聊"学习以外"的话题, 是什么时候?
            </Text>
            <Text style={styles.parentPromptItem}>
              • 如果她今天考砸了, 你会先问原因, 还是先听她感受?
            </Text>
            <Text style={styles.parentPromptItem}>
              • 这周你有没有<Text style={styles.bold}>没被问</Text>就给她建议?
            </Text>
          </View>
        </View>

        <View style={styles.foldCardWhite}>
          <Pressable onPress={toggleOpen} style={styles.foldSummary}>
            <Text style={styles.foldSummaryText}>🔍 如果你真的想看她的数据</Text>
            <Text style={styles.peekCount}>本月已展开 {peeks} 次</Text>
          </Pressable>
          {open && (
            <View style={styles.foldBody}>
              <Text style={styles.parentPeekHint}>
                以下链接会跳到她的学习数据. 你可以看, 但每次看都会累计到上面的计数里——
                不是为了羞辱, 是为了让你自己意识到"我又想查了".
              </Text>
              <View style={styles.parentLinksGrid}>
                <Pressable
                  style={[styles.parentLink, { width: linkWidth }]}
                  onPress={() => onNavigate('Trends')}
                >
                  <Text style={styles.parentLinkText}>📈 成绩趋势</Text>
                </Pressable>
                <Pressable
                  style={[styles.parentLink, { width: linkWidth }]}
                  onPress={() => onNavigate('Mistakes')}
                >
                  <Text style={styles.parentLinkText}>📓 错题本</Text>
                </Pressable>
                <Pressable
                  style={[styles.parentLink, { width: linkWidth }]}
                  onPress={() => onNavigate('Reports')}
                >
                  <Text style={styles.parentLinkText}>🧠 月度复盘</Text>
                </Pressable>
                <Pressable
                  style={[styles.parentLink, { width: linkWidth }]}
                  onPress={() => onNavigate('Today')}
                >
                  <Text style={styles.parentLinkText}>📅 计划</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48, gap: 16 },

  headerBlock: { marginBottom: 0 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 14, color: colors.slate500, marginTop: 4 },
  subtitleStrong: { color: colors.brand, fontWeight: '600' },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 16,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    flexWrap: 'wrap',
    gap: 8,
  },
  cardLabel: { fontSize: 14, fontWeight: '600', color: colors.slate800 },
  cardHint: { fontSize: 11, color: colors.slate400 },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: colors.slate900 },

  feynmanCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: 12,
    padding: 14,
  },
  feynmanTitle: { fontSize: 14, fontWeight: '600', color: colors.brand },
  feynmanHint: { fontSize: 12, color: colors.slate600, marginTop: 4, lineHeight: 17 },
  feynmanArrow: { fontSize: 12, fontWeight: '600', color: colors.brand },

  textarea: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
    minHeight: 72,
  },
  counter: {
    fontSize: 11,
    color: colors.slate400,
    textAlign: 'right',
    marginTop: 4,
  },

  weekRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  weekLabel: { fontSize: 13, color: colors.slate500 },
  weekPill: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  weekPillText: { fontSize: 13, color: colors.slate700 },
  weekPillTextActive: { color: '#fff', fontWeight: '600' },

  emptyText: {
    color: colors.slate400,
    fontSize: 13,
    paddingVertical: 12,
  },
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
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 12,
    gap: 12,
  },
  taskCardDone: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
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
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 13 },
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
  taskTitle: { fontSize: 15, fontWeight: '500', color: colors.slate900, flexShrink: 1 },
  taskTitleDone: {
    color: colors.slate400,
    textDecorationLine: 'line-through',
  },
  taskMinutes: { fontSize: 11, color: colors.slate400 },
  taskDesc: { fontSize: 13, color: colors.slate600, marginTop: 4 },
  taskDescDone: { color: colors.slate400 },

  recentText: { fontSize: 11, color: colors.slate500, marginBottom: 8 },
  stripRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  stripCell: { flex: 1, alignItems: 'center', gap: 4 },
  stripBar: { width: '100%', borderRadius: 4 },
  stripBarToday: {
    borderWidth: 2,
    borderColor: colors.brand,
  },
  stripDay: { fontSize: 9, color: colors.slate400 },

  foldCard: {
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
  },
  foldCardWhite: {
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
  foldSummaryText: { fontSize: 13, color: colors.slate600, flexShrink: 1 },
  foldChevron: { fontSize: 12, color: colors.slate400 },
  foldBody: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    paddingTop: 2,
  },
  foldBodyText: { fontSize: 14, color: colors.slate700, lineHeight: 20 },
  foldBodyTextMuted: { fontSize: 14, color: colors.slate500 },

  joinHint: { fontSize: 11, color: colors.slate500, marginBottom: 4 },
  joinCode: {
    fontSize: 20,
    fontWeight: '700',
    color: '#b45309',
    letterSpacing: 6,
    fontFamily: 'Menlo',
  },

  quickGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  quickCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 14,
    width: '47.5%',
  },
  quickIcon: { fontSize: 22, marginBottom: 4 },
  quickTitle: { fontSize: 14, fontWeight: '600', color: colors.slate900 },
  quickDesc: { fontSize: 11, color: colors.slate500, marginTop: 2 },

  // ParentHome
  parentHero: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  parentHeroTitle: {
    fontSize: 17,
    color: colors.slate800,
    lineHeight: 26,
    fontWeight: '500',
  },
  parentHeroBody: {
    fontSize: 13,
    color: colors.slate600,
    lineHeight: 21,
  },
  parentPromptTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.slate800,
    marginBottom: 10,
  },
  parentPromptItem: {
    fontSize: 13,
    color: colors.slate700,
    lineHeight: 21,
  },
  bold: { fontWeight: '700' },
  peekCount: { fontSize: 11, color: colors.slate400 },
  parentPeekHint: {
    fontSize: 11,
    color: colors.slate500,
    lineHeight: 17,
    marginBottom: 12,
  },
  parentLinksGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  parentLink: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 12,
    width: '47%',
  },
  parentLinkText: { fontSize: 13, color: colors.slate700 },
})
