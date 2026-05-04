import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native'
import { api, PracticeSet, PracticeItem } from '../lib/api'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import SolutionSteps from '../components/SolutionSteps'
import MathText from '../components/MathText'
import SplitView from '../components/SplitView'
import ReflectionPrompt from '../components/ReflectionPrompt'

export default function PracticeScreen() {
  const { hPadding, isTablet } = useResponsive()
  const [sets, setSets] = useState<PracticeSet[]>([])
  const [active, setActive] = useState<PracticeSet | null>(null)
  const [loading, setLoading] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await api.listPracticeSets()
      setSets(data)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // 每次切到此 tab 时刷新, 确保从错题页生成新 set 后回来看到
  useFocusEffect(
    useCallback(() => {
      reload()
    }, [reload])
  )

  const openSet = useCallback(async (id: number, summary?: PracticeSet) => {
    const base = summary
    if (base) {
      setActive((prev) =>
        prev?.id === id ? { ...prev, ...base } : { ...base, items: base.items || [] }
      )
    }
    setDetailLoading(true)
    try {
      const detail = await api.getPracticeSet(id)
      setActive(detail)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  // 支持 navigate('Practice', { openSetId }) 直接打开某个 set
  const route = useRoute()
  const params = route.params as { openSetId?: number } | undefined
  const pendingOpenRef = useRef<number | null>(null)
  useEffect(() => {
    if (params?.openSetId && params.openSetId !== pendingOpenRef.current) {
      pendingOpenRef.current = params.openSetId
      openSet(params.openSetId)
    }
  }, [params?.openSetId, openSet])

  // 轮询 generating — 两种情况:
  //   1. 详情里 active.status === 'generating'
  //   2. 列表里任一 set.status === 'generating' (用户可能已退回列表)
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    const activeGenerating = active?.status === 'generating'
    const listGenerating = sets.some((s) => s.status === 'generating')
    if (!activeGenerating && !listGenerating) return

    pollRef.current = setInterval(async () => {
      try {
        // 刷新列表
        const list = await api.listPracticeSets()
        setSets(list)
        // 如果当前打开的 set 在生成中, 也更新 active
        if (active && active.status === 'generating') {
          const s = await api.getPracticeSet(active.id)
          setActive((prev) => (prev && prev.id === s.id ? s : prev))
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
  }, [active?.id, active?.status, sets])

  const removeSet = useCallback(
    (id: number) => {
      Alert.alert('删除这份训练题?', '已作答的记录将一并删除', [
        { text: '取消', style: 'cancel' },
        {
          text: '删除',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.deletePracticeSet(id)
              if (active?.id === id) setActive(null)
              reload()
            } catch (e: any) {
              Alert.alert('删除失败', String(e?.message || e))
            }
          },
        },
      ])
    },
    [active?.id, reload]
  )

  const handleItemGraded = useCallback((updated: PracticeItem) => {
    setActive((prev) =>
      prev
        ? { ...prev, items: prev.items.map((x) => (x.id === updated.id ? updated : x)) }
        : prev
    )
    api.listPracticeSets().then(setSets).catch(() => {})
  }, [])

  // iPad: 双栏布局
  if (isTablet) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <SplitView
          list={
            <PracticeListView
              sets={sets}
              onSelect={(s) => openSet(s.id, s)}
              activeId={active?.id}
              refreshing={loading}
              onRefresh={reload}
              error={error}
              hPadding={hPadding}
            />
          }
          detail={
            active ? (
              <PracticeDetailView
                set={active}
                detailLoading={detailLoading}
                onBack={() => setActive(null)}
                onRemove={() => removeSet(active.id)}
                onItemGraded={handleItemGraded}
                onRefreshDetail={() => openSet(active.id)}
                hPadding={hPadding}
                showBack={false}
              />
            ) : null
          }
          emptyHint="选一份训练开始"
        />
      </SafeAreaView>
    )
  }

  // iPhone: 详情视图
  if (active) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <PracticeDetailView
          set={active}
          detailLoading={detailLoading}
          onBack={() => setActive(null)}
          onRemove={() => removeSet(active.id)}
          onItemGraded={handleItemGraded}
          onRefreshDetail={() => openSet(active.id)}
          hPadding={hPadding}
          showBack={true}
        />
      </SafeAreaView>
    )
  }

  // iPhone: 列表视图
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <PracticeListView
        sets={sets}
        onSelect={(s) => openSet(s.id, s)}
        refreshing={loading}
        onRefresh={reload}
        error={error}
        hPadding={hPadding}
      />
    </SafeAreaView>
  )
}

function PracticeListView({
  sets,
  onSelect,
  activeId,
  refreshing,
  onRefresh,
  error,
  hPadding,
}: {
  sets: PracticeSet[]
  onSelect: (s: PracticeSet) => void
  activeId?: number
  refreshing: boolean
  onRefresh: () => void
  error: string
  hPadding: number
}) {
  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>二次训练</Text>
      <Text style={styles.subtitle}>
        在错题本页面点"生成类题"即可创建训练. 巩固后系统自动批改.
      </Text>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {sets.length === 0 && !refreshing ? (
        <Text style={styles.emptyText}>
          还没有训练题. 去错题本, 点任意一道错题的"生成类题".
        </Text>
      ) : (
        sets.map((s) => {
          const gen = s.status === 'generating'
          const failed = s.status === 'failed'
          const isActive = activeId !== undefined && s.id === activeId
          return (
            <Pressable
              key={s.id}
              style={[styles.setCard, isActive && styles.setCardActive]}
              onPress={() => onSelect(s)}
            >
              <Text style={styles.setCardTitle} numberOfLines={1}>
                {gen ? '⏳ ' : failed ? '⚠️ ' : ''}
                {s.title}
              </Text>
              <Text style={styles.setCardMeta}>
                {gen
                  ? 'AI 出题中...'
                  : failed
                  ? '生成失败'
                  : `${s.item_count ?? 0} 题 · 已做 ${s.graded_count ?? 0} · 对 ${
                      s.correct_count ?? 0
                    }`}
              </Text>
            </Pressable>
          )
        })
      )}
    </ScrollView>
  )
}

function PracticeDetailView({
  set,
  detailLoading,
  onBack,
  onRemove,
  onItemGraded,
  onRefreshDetail,
  hPadding,
  showBack,
}: {
  set: PracticeSet
  detailLoading: boolean
  onBack: () => void
  onRemove: () => void
  onItemGraded: (updated: PracticeItem) => void
  onRefreshDetail: () => void
  hPadding: number
  showBack: boolean
}) {
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.detailHeader}>
        {showBack ? (
          <Pressable onPress={onBack} hitSlop={8}>
            <Text style={styles.backText}>← 返回</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Pressable onPress={onRemove} hitSlop={8}>
          <Text style={styles.deleteText}>删除</Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={
          <RefreshControl refreshing={detailLoading} onRefresh={onRefreshDetail} />
        }
      >
        <Text style={styles.setTitle}>{set.title}</Text>
        <Text style={styles.setMeta}>
          {set.subject} · {set.knowledge_point}
        </Text>

        {set.status === 'generating' && (
          <View style={styles.genBox}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.genTitle}>AI 正在基于你的错题出题...</Text>
            <Text style={styles.genHint}>
              大约 15-25 秒. 你可以切到其他页面, 稍后回来看
            </Text>
          </View>
        )}

        {set.status === 'failed' && (
          <View style={styles.failBox}>
            <Text style={styles.failText}>
              生成失败: {set.error_message || '未知原因'}
            </Text>
            <Text style={styles.failHint}>请回到错题本重新点"生成类题"</Text>
          </View>
        )}

        {detailLoading && set.items.length === 0 && (
          <Text style={styles.loadingText}>正在加载这套训练题...</Text>
        )}

        {set.status !== 'generating' &&
          set.items.map((it, idx) => (
            <ItemCard
              key={it.id}
              index={idx}
              item={it}
              setSubject={set.subject}
              onGraded={onItemGraded}
            />
          ))}
      </ScrollView>
    </View>
  )
}

function ItemCard({
  index,
  item,
  setSubject,
  onGraded,
}: {
  index: number
  item: PracticeItem
  setSubject: string | null
  onGraded: (updated: PracticeItem) => void
}) {
  const navigation = useNavigation<any>()
  const [answer, setAnswer] = useState(item.student_answer || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [showHint, setShowHint] = useState(false)
  const done = item.is_correct !== null

  // 信号埋点 — 计时与 pause 检测
  const mountedAtRef = useRef<number>(Date.now())
  const submittedRef = useRef<boolean>(done)
  const pauseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pauseStartRef = useRef<number | null>(null)
  const pauseCountRef = useRef<number>(0)
  const hintTrackedRef = useRef<boolean>(false)

  useEffect(() => {
    signals.track('practice.item.start', {
      related_table: 'practice_items',
      related_id: item.id,
      payload: {
        subject: setSubject || 'unknown',
        difficulty: item.difficulty || 'unknown',
      },
    })
    return () => {
      if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
      if (!submittedRef.current) {
        const elapsed = Math.round((Date.now() - mountedAtRef.current) / 1000)
        signals.track('practice.item.skip', {
          related_table: 'practice_items',
          related_id: item.id,
          payload: { elapsed_secs: elapsed },
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleAnswerChange(t: string) {
    setAnswer(t)
    pauseStartRef.current = Date.now()
    if (pauseTimerRef.current) clearTimeout(pauseTimerRef.current)
    pauseTimerRef.current = setTimeout(() => {
      const start = pauseStartRef.current
      if (start == null) return
      const pauseSecs = Math.round((Date.now() - start) / 1000)
      pauseCountRef.current += 1
      signals.track('practice.item.input_pause', {
        related_table: 'practice_items',
        related_id: item.id,
        payload: {
          pause_count_so_far: pauseCountRef.current,
          pause_secs: pauseSecs,
        },
      })
    }, 5000)
  }

  function handleHintToggle() {
    setShowHint((v) => {
      const next = !v
      if (next && !hintTrackedRef.current) {
        hintTrackedRef.current = true
        const secs = Math.round((Date.now() - mountedAtRef.current) / 1000)
        signals.track('practice.item.hint_used', {
          related_table: 'practice_items',
          related_id: item.id,
          payload: { time_before_hint_secs: secs },
        })
      }
      return next
    })
  }

  async function submit() {
    if (!answer.trim()) {
      setErr('请输入你的作答')
      return
    }
    setBusy(true)
    setErr('')
    try {
      const updated = await api.gradePracticeItem(item.id, answer.trim())
      submittedRef.current = true
      const elapsed = Math.round((Date.now() - mountedAtRef.current) / 1000)
      signals.track('practice.item.submit', {
        related_table: 'practice_items',
        related_id: item.id,
        payload: {
          elapsed_secs: elapsed,
          answer_length: answer.trim().length,
          hint_used: hintTrackedRef.current,
        },
      })
      onGraded(updated)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.itemCard}>
      <View style={styles.itemHeader}>
        <Text style={styles.itemIndex}>第 {index + 1} 题</Text>
        {item.difficulty && (
          <View style={styles.diffBadge}>
            <Text style={styles.diffBadgeText}>
              {item.difficulty === 'easy'
                ? '简单'
                : item.difficulty === 'hard'
                ? '难'
                : '中等'}
            </Text>
          </View>
        )}
        {done &&
          (item.is_correct ? (
            <View style={[styles.resultBadge, styles.resultOk]}>
              <Text style={styles.resultOkText}>✓ 对 · {item.score}</Text>
            </View>
          ) : (
            <View style={[styles.resultBadge, styles.resultBad]}>
              <Text style={styles.resultBadText}>✗ 错 · {item.score}</Text>
            </View>
          ))}
      </View>

      <MathText text={item.question_text} style={styles.question} />

      <TextInput
        value={answer}
        onChangeText={handleAnswerChange}
        placeholder="在这里写你的作答 (可多行)"
        placeholderTextColor={colors.slate400}
        multiline
        numberOfLines={3}
        style={styles.textInput}
        editable={!done}
      />

      {err ? <Text style={styles.errText}>{err}</Text> : null}

      {!done && (
        <View style={styles.actionRow}>
          <Pressable
            onPress={submit}
            disabled={busy}
            style={[styles.submitBtn, busy && styles.submitBtnDisabled]}
          >
            <Text style={styles.submitBtnText}>
              {busy ? 'AI 批改中...' : '提交作答'}
            </Text>
          </Pressable>
          {(item.expected_answer || item.solution_steps) && (
            <Pressable
              onPress={handleHintToggle}
              style={styles.hintBtn}
            >
              <Text style={styles.hintBtnText}>
                {showHint ? '隐藏思路' : '卡住了? 看思路'}
              </Text>
            </Pressable>
          )}
        </View>
      )}

      {done && item.feedback ? (
        <View
          style={[
            styles.feedbackBox,
            item.is_correct ? styles.feedbackOk : styles.feedbackBad,
          ]}
        >
          <Text style={styles.feedbackLabel}>点评</Text>
          <MathText text={item.feedback} style={styles.feedbackText} />
        </View>
      ) : null}

      {(done || showHint) && (item.expected_answer || item.solution_steps) ? (
        <SolutionSteps
          expectedAnswer={item.expected_answer}
          solutionSteps={item.solution_steps}
          defaultOpen={showHint || done}
        />
      ) : null}

      {done && !item.is_correct ? (
        <ReflectionPrompt
          sourceTable="practice_items"
          sourceId={item.id}
          storeKind="free_write"
          storeRelatedKey={`pi_${item.id}`}
        />
      ) : null}

      {done && item.is_correct ? (
        <Pressable
          onPress={() =>
            navigation.navigate('Feynman', {
              source_table: 'practice_items',
              source_id: item.id,
            })
          }
          style={styles.feynmanBtn}
        >
          <Text style={styles.feynmanBtnText}>
            🎓 教教我? (你讲, 我装作刚学的同学问你)
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },

  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: {
    fontSize: 13,
    color: colors.slate500,
    marginTop: 4,
    marginBottom: 16,
  },

  errorText: { color: colors.red500, fontSize: 13, marginBottom: 12 },
  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    paddingVertical: 40,
    fontSize: 14,
  },

  setCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
  },
  setCardActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  setCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.slate900,
  },
  setCardMeta: {
    fontSize: 12,
    color: colors.slate500,
    marginTop: 4,
  },

  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: '#fff',
  },
  backText: { fontSize: 15, color: colors.brand },
  deleteText: { fontSize: 14, color: colors.red500 },

  setTitle: { fontSize: 20, fontWeight: '700', color: colors.slate900 },
  setMeta: {
    fontSize: 12,
    color: colors.slate500,
    marginTop: 4,
    marginBottom: 16,
  },

  genBox: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  genTitle: { fontSize: 14, fontWeight: '600', color: colors.brand },
  genHint: { fontSize: 12, color: colors.slate500, textAlign: 'center' },

  failBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  failText: { fontSize: 13, color: '#b91c1c' },
  failHint: { fontSize: 12, color: colors.slate500, marginTop: 6 },

  loadingText: {
    color: colors.slate500,
    fontSize: 14,
    paddingVertical: 24,
    textAlign: 'center',
  },

  itemCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
    gap: 8,
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  itemIndex: { fontSize: 12, fontWeight: '700', color: colors.slate600 },
  diffBadge: {
    backgroundColor: colors.divider,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  diffBadgeText: { fontSize: 11, color: colors.slate700 },
  resultBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  resultOk: { backgroundColor: '#dcfce7' },
  resultBad: { backgroundColor: '#fee2e2' },
  resultOkText: { fontSize: 11, color: colors.green600, fontWeight: '600' },
  resultBadText: { fontSize: 11, color: '#b91c1c', fontWeight: '600' },

  question: {
    fontSize: 14,
    lineHeight: 22,
    color: colors.slate900,
  },

  textInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
    minHeight: 72,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  errText: { fontSize: 12, color: colors.red500 },

  submitBtn: {
    alignSelf: 'flex-start',
    backgroundColor: colors.brand,
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  hintBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#e9d5ff',
    backgroundColor: '#faf5ff',
  },
  hintBtnText: { fontSize: 13, color: '#7c3aed', fontWeight: '500' },

  feedbackBox: {
    borderRadius: 6,
    borderWidth: 1,
    padding: 10,
    marginTop: 4,
  },
  feedbackOk: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  feedbackBad: { backgroundColor: '#fffbeb', borderColor: '#fde68a' },

  feynmanBtn: {
    marginTop: 8,
    backgroundColor: '#faf5ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignSelf: 'flex-start',
  },
  feynmanBtnText: {
    fontSize: 13,
    color: '#7c3aed',
    fontWeight: '500',
  },
  feedbackLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate700,
    marginBottom: 2,
  },
  feedbackText: { fontSize: 13, color: colors.slate700, lineHeight: 20 },
})
