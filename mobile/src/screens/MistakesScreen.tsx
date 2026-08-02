import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  FlatList,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { api, Mistake } from '../lib/api'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import { cachedFetch } from '../lib/offlineCache'
import MathText from '../components/MathText'
import SplitView from '../components/SplitView'
import ReflectionPrompt from '../components/ReflectionPrompt'

const SUBJECTS = ['数学', '科学', '英语', '语文', '社会']
const REASONS = ['粗心', '概念不清', '思路错误', '知识盲区', '其他']

type Form = {
  subject: string
  exam_name: string
  question_text: string
  wrong_answer: string
  correct_answer: string
  reason: string
  knowledge_point: string
}

const EMPTY_FORM: Form = {
  subject: '数学',
  exam_name: '',
  question_text: '',
  wrong_answer: '',
  correct_answer: '',
  reason: '粗心',
  knowledge_point: '',
}

const PAGE_SIZE = 20

export default function MistakesScreen() {
  const navigation = useNavigation<any>()
  const { hPadding, isTablet } = useResponsive()

  const [mistakes, setMistakes] = useState<Mistake[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [err, setErr] = useState('')

  const [filterSubject, setFilterSubject] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<'' | '0' | '1'>('')

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<Form>({ ...EMPTY_FORM })
  const [submitting, setSubmitting] = useState(false)

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [generatingId, setGeneratingId] = useState<number | null>(null)
  const [offlineHint, setOfflineHint] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setErr('')
    setOfflineHint(false)
    try {
      const cacheKey = `mistakes:list:s=${filterSubject || ''}&m=${filterStatus}`
      const { data: pageResult, fromCache } = await cachedFetch(
        cacheKey,
        () =>
          api.listMistakesPaged({
            subject: filterSubject || undefined,
            mastered: filterStatus === '' ? undefined : (Number(filterStatus) as 0 | 1),
            limit: PAGE_SIZE,
            offset: 0,
          })
      )
      setMistakes(pageResult.items)
      setTotal(pageResult.total)
      if (fromCache) setOfflineHint(true)
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [filterSubject, filterStatus])

  useEffect(() => {
    reload()
  }, [reload])

  async function loadMore() {
    if (loadingMore || mistakes.length >= total) return
    setLoadingMore(true)
    try {
      const result = await api.listMistakesPaged({
        subject: filterSubject || undefined,
        mastered: filterStatus === '' ? undefined : (Number(filterStatus) as 0 | 1),
        limit: PAGE_SIZE,
        offset: mistakes.length,
      })
      setMistakes((prev) => [...prev, ...result.items])
      setTotal(result.total)
    } catch (e: any) {
      Alert.alert('加载失败', String(e?.message || e))
    } finally {
      setLoadingMore(false)
    }
  }

  async function submit() {
    if (!form.question_text && !form.knowledge_point) {
      Alert.alert('提示', '题目或知识点至少填一个')
      return
    }
    setSubmitting(true)
    try {
      await api.createMistake(form)
      signals.track('mistake.create', {
        related_table: 'mistakes',
        payload: {
          subject: form.subject,
          reason: form.reason,
          source: 'manual',
        },
      })
      setForm({ ...EMPTY_FORM })
      setShowAdd(false)
      await reload()
    } catch (e: any) {
      Alert.alert('保存失败', String(e?.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleMastered(m: Mistake) {
    try {
      const wasMastered = !!m.mastered
      await api.updateMistake(m.id, { mastered: wasMastered ? 0 : 1 })
      if (!wasMastered) {
        const created = new Date(m.created_at).getTime()
        const days = Math.max(
          0,
          Math.floor((Date.now() - created) / (24 * 3600 * 1000))
        )
        signals.track('mistake.mark_mastered', {
          related_table: 'mistakes',
          related_id: m.id,
          payload: { days_since_create: days },
        })
      }
      await reload()
    } catch (e: any) {
      Alert.alert('更新失败', String(e?.message || e))
    }
  }

  function remove(id: number) {
    Alert.alert('删除?', '确认删除这道错题', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMistake(id)
            if (selectedId === id) setSelectedId(null)
            await reload()
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  async function generatePractice(id: number) {
    setGeneratingId(id)
    try {
      const set = await api.generatePractice(id, 3)
      // 直接跳到训练 tab + 打开这一套
      navigation.navigate('Practice' as never, { openSetId: set.id } as never)
    } catch (e: any) {
      Alert.alert('生成失败', String(e?.message || e))
    } finally {
      setGeneratingId(null)
    }
  }

  function renderItem({ item: m }: { item: Mistake }) {
    const isSelected = selectedId === m.id
    // iPad: tap selects (right pane shows detail), no inline expand.
    // iPhone: tap toggles inline-expand (legacy behavior).
    const expanded = !isTablet && isSelected
    return (
      <Pressable
        onPress={() => {
          if (!isSelected) {
            signals.track('mistake.view_detail', {
              related_table: 'mistakes',
              related_id: m.id,
              payload: { subject: m.subject },
            })
          }
          setSelectedId(isSelected ? null : m.id)
        }}
        style={[
          styles.card,
          m.mastered ? styles.cardMastered : null,
          isTablet && isSelected ? styles.cardSelected : null,
        ]}
      >
        <View style={styles.badgeRow}>
          <View style={styles.subjectBadge}>
            <Text style={styles.subjectBadgeText}>{m.subject}</Text>
          </View>
          <View style={styles.reasonBadge}>
            <Text style={styles.reasonBadgeText}>{m.reason}</Text>
          </View>
          {m.exam_name ? (
            <Text style={styles.metaText}>来自: {m.exam_name}</Text>
          ) : null}
          {m.mastered ? <Text style={styles.masteredTag}>✓ 已掌握</Text> : null}
        </View>

        {m.question_text ? (
          <MathText text={m.question_text} style={styles.questionText} />
        ) : null}
        {m.knowledge_point ? (
          <Text style={styles.kpText}>知识点: {m.knowledge_point}</Text>
        ) : null}

        {(m.wrong_answer || m.correct_answer) && (
          <View style={styles.answerBlock}>
            {m.wrong_answer ? (
              <View style={styles.answerRow}>
                <Text style={styles.answerPrefix}>错:</Text>
                <View style={styles.answerContent}>
                  <MathText text={m.wrong_answer} style={styles.wrongAns} />
                </View>
              </View>
            ) : null}
            {m.correct_answer ? (
              <View style={styles.answerRow}>
                <Text style={styles.answerPrefix}>对:</Text>
                <View style={styles.answerContent}>
                  <MathText text={m.correct_answer} style={styles.correctAns} />
                </View>
              </View>
            ) : null}
          </View>
        )}

        {expanded && (
          <ExpandedDetail
            mistake={m}
            generating={generatingId === m.id}
            onGenerate={() => generatePractice(m.id)}
            onToggleMastered={() => toggleMastered(m)}
            onDelete={() => remove(m.id)}
          />
        )}
      </Pressable>
    )
  }

  const selectedMistake =
    selectedId != null ? mistakes.find((m) => m.id === selectedId) ?? null : null

  const listNode = (
    <>
      {/* Filter pills */}
      <View style={[styles.filterWrap, { paddingHorizontal: hPadding }]}>
        <Text style={styles.filterLabel}>科目:</Text>
        <View style={styles.pillsRow}>
          <FilterPill
            label="全部"
            active={filterSubject === ''}
            onPress={() => setFilterSubject('')}
          />
          {SUBJECTS.map((s) => (
            <FilterPill
              key={s}
              label={s}
              active={filterSubject === s}
              onPress={() => setFilterSubject(s)}
            />
          ))}
        </View>
        <Text style={styles.filterLabel}>状态:</Text>
        <View style={styles.pillsRow}>
          <FilterPill
            label="全部"
            active={filterStatus === ''}
            onPress={() => setFilterStatus('')}
          />
          <FilterPill
            label="未掌握"
            active={filterStatus === '0'}
            onPress={() => setFilterStatus('0')}
          />
          <FilterPill
            label="已掌握"
            active={filterStatus === '1'}
            onPress={() => setFilterStatus('1')}
          />
        </View>
      </View>

      {err ? <Text style={styles.errorText}>{err}</Text> : null}
      {offlineHint ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>
            📴 网络未连接,显示本地缓存(可能不是最新)
          </Text>
        </View>
      ) : null}

      {loading && mistakes.length === 0 ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.brand} />
      ) : (
        <FlatList
          data={mistakes}
          keyExtractor={(m) => String(m.id)}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.listContent,
            { paddingHorizontal: isTablet ? 12 : hPadding },
          ]}
          onEndReached={loadMore}
          onEndReachedThreshold={0.3}
          refreshing={loading}
          onRefresh={reload}
          ListHeaderComponent={
            total > 0 ? (
              <Text style={styles.totalText}>
                共 {total} 道 · 已加载 {mistakes.length}
              </Text>
            ) : null
          }
          ListEmptyComponent={
            !loading ? (
              <Text style={styles.emptyText}>还没有错题记录</Text>
            ) : null
          }
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator style={{ marginVertical: 16 }} color={colors.brand} />
            ) : null
          }
        />
      )}
    </>
  )

  const detailNode =
    isTablet && selectedMistake ? (
      <ScrollView contentContainerStyle={styles.detailScroll}>
        <Pressable
          onPress={() => setSelectedId(null)}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <Text style={styles.closeBtnText}>← 关闭</Text>
        </Pressable>

        <View style={styles.badgeRow}>
          <View style={styles.subjectBadge}>
            <Text style={styles.subjectBadgeText}>{selectedMistake.subject}</Text>
          </View>
          <View style={styles.reasonBadge}>
            <Text style={styles.reasonBadgeText}>{selectedMistake.reason}</Text>
          </View>
          {selectedMistake.exam_name ? (
            <Text style={styles.metaText}>来自: {selectedMistake.exam_name}</Text>
          ) : null}
          {selectedMistake.mastered ? (
            <Text style={styles.masteredTag}>✓ 已掌握</Text>
          ) : null}
        </View>

        {selectedMistake.question_text ? (
          <MathText
            text={selectedMistake.question_text}
            style={styles.questionText}
          />
        ) : null}
        {selectedMistake.knowledge_point ? (
          <Text style={styles.kpText}>
            知识点: {selectedMistake.knowledge_point}
          </Text>
        ) : null}

        {(selectedMistake.wrong_answer || selectedMistake.correct_answer) && (
          <View style={styles.answerBlock}>
            {selectedMistake.wrong_answer ? (
              <View style={styles.answerRow}>
                <Text style={styles.answerPrefix}>错:</Text>
                <View style={styles.answerContent}>
                  <MathText
                    text={selectedMistake.wrong_answer}
                    style={styles.wrongAns}
                  />
                </View>
              </View>
            ) : null}
            {selectedMistake.correct_answer ? (
              <View style={styles.answerRow}>
                <Text style={styles.answerPrefix}>对:</Text>
                <View style={styles.answerContent}>
                  <MathText
                    text={selectedMistake.correct_answer}
                    style={styles.correctAns}
                  />
                </View>
              </View>
            ) : null}
          </View>
        )}

        <ExpandedDetail
          key={selectedMistake.id}
          mistake={selectedMistake}
          generating={generatingId === selectedMistake.id}
          onGenerate={() => generatePractice(selectedMistake.id)}
          onToggleMastered={() => toggleMastered(selectedMistake)}
          onDelete={() => remove(selectedMistake.id)}
        />
      </ScrollView>
    ) : null

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <View style={[styles.header, { paddingHorizontal: hPadding }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>错题本</Text>
          <Text style={styles.subtitle}>记录 → 归因 → 重做 → 标记掌握</Text>
        </View>
        <Pressable
          onPress={() => navigation.navigate('ScanSolve' as never)}
          style={styles.scanSolveButton}
          hitSlop={8}
        >
          <Text style={styles.scanSolveButtonText}>📷 拍解题</Text>
        </Pressable>
        <Pressable
          onPress={() => navigation.navigate('Scan' as never)}
          style={styles.scanButton}
          hitSlop={8}
        >
          <Text style={styles.scanButtonText}>📸 扫试卷</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowAdd(true)}
          style={styles.addButton}
          hitSlop={8}
        >
          <Text style={styles.addButtonText}>+ 添加</Text>
        </Pressable>
      </View>

      {isTablet ? (
        <SplitView
          list={listNode}
          detail={detailNode}
          emptyHint="选一道错题查看反思和操作"
        />
      ) : (
        listNode
      )}

      {/* Create modal */}
      <Modal
        visible={showAdd}
        animationType="slide"
        onRequestClose={() => setShowAdd(false)}
        transparent={false}
      >
        <SafeAreaView style={styles.modalContainer} edges={['top', 'left', 'right']}>
          <View style={styles.modalHeader}>
            <Pressable onPress={() => setShowAdd(false)} hitSlop={8}>
              <Text style={styles.modalCancel}>取消</Text>
            </Pressable>
            <Text style={styles.modalTitle}>添加错题</Text>
            <Pressable onPress={submit} disabled={submitting} hitSlop={8}>
              <Text
                style={[
                  styles.modalSave,
                  submitting && { opacity: 0.5 },
                ]}
              >
                保存
              </Text>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody}>
            <Text style={styles.formLabel}>科目</Text>
            <View style={styles.pillsRow}>
              {SUBJECTS.map((s) => (
                <FilterPill
                  key={s}
                  label={s}
                  active={form.subject === s}
                  onPress={() => setForm({ ...form, subject: s })}
                />
              ))}
            </View>

            <Text style={styles.formLabel}>失分归因</Text>
            <View style={styles.pillsRow}>
              {REASONS.map((r) => (
                <FilterPill
                  key={r}
                  label={r}
                  active={form.reason === r}
                  onPress={() => setForm({ ...form, reason: r })}
                />
              ))}
            </View>

            <Text style={styles.formLabel}>来源 (如: 5月月考)</Text>
            <TextInput
              style={styles.input}
              value={form.exam_name}
              onChangeText={(t) => setForm({ ...form, exam_name: t })}
              placeholder="可选"
              placeholderTextColor={colors.slate400}
            />

            <Text style={styles.formLabel}>题目描述</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={form.question_text}
              onChangeText={(t) => setForm({ ...form, question_text: t })}
              placeholder="题目描述 / 简述"
              placeholderTextColor={colors.slate400}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.formLabel}>我的错答</Text>
            <TextInput
              style={styles.input}
              value={form.wrong_answer}
              onChangeText={(t) => setForm({ ...form, wrong_answer: t })}
              placeholder="可选"
              placeholderTextColor={colors.slate400}
            />

            <Text style={styles.formLabel}>正确答案</Text>
            <TextInput
              style={styles.input}
              value={form.correct_answer}
              onChangeText={(t) => setForm({ ...form, correct_answer: t })}
              placeholder="可选"
              placeholderTextColor={colors.slate400}
            />

            <Text style={styles.formLabel}>涉及知识点</Text>
            <TextInput
              style={styles.input}
              value={form.knowledge_point}
              onChangeText={(t) => setForm({ ...form, knowledge_point: t })}
              placeholder="可选"
              placeholderTextColor={colors.slate400}
            />
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function FilterPill({
  label,
  active,
  onPress,
}: {
  label: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </Pressable>
  )
}

function ExpandedDetail({
  mistake,
  generating,
  onGenerate,
  onToggleMastered,
  onDelete,
}: {
  mistake: Mistake
  generating: boolean
  onGenerate: () => void
  onToggleMastered: () => void
  onDelete: () => void
}) {
  const navigation = useNavigation<any>()

  return (
    <View
      style={styles.detailBlock}
      // prevent parent Pressable collapsing when tapping inside
      onStartShouldSetResponder={() => true}
    >
      {mistake.solution_steps ? (
        <View style={styles.solutionBox}>
          <Text style={styles.solutionLabel}>参考思路</Text>
          <MathText text={mistake.solution_steps} style={styles.solutionText} />
        </View>
      ) : null}

      <ReflectionPrompt
        sourceTable="mistakes"
        sourceId={mistake.id}
        storeKind="mistake_note"
      />

      <View style={styles.actionRow}>
        <Pressable
          onPress={onGenerate}
          disabled={generating}
          style={[styles.actionBtn, styles.actionBtnPrimary, generating && { opacity: 0.6 }]}
        >
          <Text style={styles.actionBtnPrimaryText}>
            {generating ? '出题中...' : '生成类题训练'}
          </Text>
        </Pressable>
        <Pressable
          onPress={() =>
            navigation.navigate('Feynman', {
              source_table: 'mistakes',
              source_id: mistake.id,
            })
          }
          style={[styles.actionBtn, styles.actionBtnFeynman]}
        >
          <Text style={styles.actionBtnFeynmanText}>🎓 给我讲讲这道题</Text>
        </Pressable>
        <Pressable onPress={onToggleMastered} style={styles.actionBtn}>
          <Text style={styles.actionBtnText}>
            {mistake.mastered ? '标记未掌握' : '标记掌握'}
          </Text>
        </Pressable>
        <Pressable onPress={onDelete} style={[styles.actionBtn, styles.actionBtnDanger]}>
          <Text style={styles.actionBtnDangerText}>删除</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },
  addButton: {
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
  },
  addButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  scanButton: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  scanButtonText: { color: colors.slate700, fontSize: 13, fontWeight: '500' },
  scanSolveButton: {
    backgroundColor: '#10b981',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  scanSolveButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },

  filterWrap: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 6,
  },
  filterLabel: { fontSize: 12, color: colors.slate500, marginTop: 4 },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  pillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  pillText: { fontSize: 12, color: colors.slate700 },
  pillTextActive: { color: '#fff', fontWeight: '600' },

  listContent: { padding: 16, paddingTop: 8, paddingBottom: 48 },
  totalText: { fontSize: 12, color: colors.slate500, marginBottom: 8 },
  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    fontSize: 14,
    paddingVertical: 40,
  },
  errorText: {
    color: colors.red500,
    fontSize: 13,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  offlineBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    marginHorizontal: 16,
    marginVertical: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  offlineText: { color: '#92400e', fontSize: 12 },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10,
  },
  cardMastered: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  cardSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
    borderWidth: 2,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginBottom: 6,
  },
  subjectBadge: {
    backgroundColor: colors.brandLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  subjectBadgeText: { fontSize: 11, color: colors.brand, fontWeight: '500' },
  reasonBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  reasonBadgeText: { fontSize: 11, color: '#b91c1c', fontWeight: '500' },
  metaText: { fontSize: 11, color: colors.slate500 },
  masteredTag: { fontSize: 11, color: colors.green600, fontWeight: '600' },

  questionText: { fontSize: 14, color: colors.slate800, marginBottom: 4 },
  kpText: { fontSize: 12, color: colors.slate500, marginBottom: 4 },

  answerBlock: { marginTop: 6, gap: 2 },
  answerLine: { fontSize: 12, color: colors.slate600 },
  answerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  answerPrefix: { fontSize: 12, color: colors.slate600, paddingTop: 1 },
  answerContent: { flex: 1 },
  wrongAns: { color: colors.red500, fontSize: 12 },
  correctAns: { color: colors.green600, fontSize: 12 },

  detailBlock: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 8,
  },
  detailScroll: {
    padding: 16,
    paddingBottom: 48,
  },
  closeBtn: {
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingHorizontal: 6,
    marginBottom: 8,
  },
  closeBtnText: { fontSize: 13, color: colors.brand, fontWeight: '500' },
  solutionBox: {
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 6,
    padding: 10,
  },
  solutionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#7c3aed',
    marginBottom: 4,
  },
  solutionText: { fontSize: 13, color: colors.slate700, lineHeight: 20 },

  formLabel: {
    fontSize: 12,
    color: colors.slate600,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
    backgroundColor: '#fff',
  },
  textArea: { minHeight: 72, textAlignVertical: 'top' },
  savingText: { fontSize: 11, color: colors.slate400 },

  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  actionBtnText: { fontSize: 12, color: colors.slate700 },
  actionBtnPrimary: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  actionBtnPrimaryText: { fontSize: 12, color: '#fff', fontWeight: '600' },
  actionBtnDanger: { borderColor: '#fecaca' },
  actionBtnDangerText: { fontSize: 12, color: colors.red500 },
  actionBtnFeynman: {
    backgroundColor: '#faf5ff',
    borderColor: '#e9d5ff',
  },
  actionBtnFeynmanText: { fontSize: 12, color: '#7c3aed', fontWeight: '500' },

  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: '#fff',
  },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.slate900 },
  modalCancel: { fontSize: 14, color: colors.slate500 },
  modalSave: { fontSize: 14, color: colors.brand, fontWeight: '600' },
  modalBody: { padding: 16, paddingBottom: 48, gap: 4 },
})
