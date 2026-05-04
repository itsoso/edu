import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
  useWindowDimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { LineChart } from 'react-native-gifted-charts'
import { api, Exam } from '../lib/api'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

const SUBJECTS = [
  { key: '科学', color: '#10b981', full: 150 },
  { key: '英语', color: '#3b82f6', full: 120 },
  { key: '数学', color: '#ef4444', full: 120 },
  { key: '语文', color: '#f59e0b', full: 120 },
  { key: '社会', color: '#8b5cf6', full: 100 },
]

const STAGES = ['初二下', '初二上', '初一下', '初一上', '初三上', '初三下']

type ChartMode = 'subject' | 'total' | 'rank'

type AddForm = {
  exam_name: string
  exam_date: string
  stage: string
  notes: string
  scores: Record<string, string>
}

function emptyForm(): AddForm {
  return {
    exam_name: '',
    exam_date: '',
    stage: '初二下',
    notes: '',
    scores: Object.fromEntries(SUBJECTS.map((s) => [s.key, ''])) as Record<
      string,
      string
    >,
  }
}

function shortDate(iso: string | null, fallback: string): string {
  if (!iso) return fallback
  // YYYY-MM-DD → MM/DD
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return `${m[2]}/${m[3]}`
  return fallback
}

export default function TrendsScreen() {
  const { user } = useAuth()
  const isParent = user?.role === 'parent'
  const { width } = useWindowDimensions()
  const { hPadding } = useResponsive()

  const [exams, setExams] = useState<Exam[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [mode, setMode] = useState<ChartMode>('subject')
  const [activeSubject, setActiveSubject] = useState<string>(SUBJECTS[0].key)

  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState<AddForm>(emptyForm())
  const [gradeRank, setGradeRank] = useState('')
  const [examFeeling, setExamFeeling] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api.listExams()
      setExams(d)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Chart data for current mode
  const chartPoints = useMemo(() => {
    if (exams.length === 0) return []
    if (mode === 'subject') {
      const subj = SUBJECTS.find((s) => s.key === activeSubject)
      if (!subj) return []
      return exams.map((e, idx) => {
        const raw = e.scores[subj.key]
        const val = typeof raw === 'number' ? raw : null
        return {
          value: val ?? 0,
          hideDataPoint: val == null,
          label: shortDate(e.exam_date, `#${idx + 1}`),
          dataPointText: val != null ? String(val) : '',
        }
      })
    }
    if (mode === 'total') {
      return exams.map((e, idx) => ({
        value: e.total ?? 0,
        hideDataPoint: e.total == null,
        label: shortDate(e.exam_date, `#${idx + 1}`),
        dataPointText: e.total != null ? e.total.toFixed(0) : '',
      }))
    }
    // rank — smaller is visually higher on y (keep raw; no inversion message)
    return exams.map((e, idx) => ({
      value: e.grade_rank ?? 0,
      hideDataPoint: e.grade_rank == null,
      label: shortDate(e.exam_date, `#${idx + 1}`),
      dataPointText: e.grade_rank != null ? String(e.grade_rank) : '',
    }))
  }, [exams, mode, activeSubject])

  const chartColor = useMemo(() => {
    if (mode === 'subject') {
      return SUBJECTS.find((s) => s.key === activeSubject)?.color || colors.brand
    }
    if (mode === 'total') return '#2563eb'
    return '#dc2626'
  }, [mode, activeSubject])

  async function submit() {
    if (saving) return
    setSaving(true)
    try {
      const scores: Record<string, number> = {}
      Object.entries(form.scores).forEach(([k, v]) => {
        const n = parseFloat(v)
        if (!isNaN(n)) scores[k] = n
      })
      const created = await api.createExam({
        exam_name: form.exam_name || '新考试',
        exam_date: form.exam_date || null,
        stage: form.stage,
        notes: form.notes || null,
        grade_rank: gradeRank ? parseInt(gradeRank, 10) : null,
        scores,
      })
      if (examFeeling.trim()) {
        try {
          await api.upsertReflection({
            kind: 'exam_feeling',
            related_id: created.id,
            content: examFeeling.trim(),
          })
        } catch {
          /* ignore */
        }
      }
      setForm(emptyForm())
      setGradeRank('')
      setExamFeeling('')
      setShowAdd(false)
      await load()
    } catch (e: any) {
      Alert.alert('保存失败', String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  function confirmDelete(id: number) {
    Alert.alert('确定删除这次考试？', undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteExam(id)
            await load()
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  const chartWidth = Math.max(width - 80, chartPoints.length * 56)

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>成绩趋势</Text>
            <Text style={styles.subtitle}>{exams.length} 次考试记录</Text>
          </View>
          {!isParent && (
            <Pressable
              onPress={() => setShowAdd(true)}
              style={styles.addBtn}
              hitSlop={6}
            >
              <Text style={styles.addBtnText}>+ 录入</Text>
            </Pressable>
          )}
        </View>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {/* 模式切换 */}
        <View style={styles.tabRow}>
          {(
            [
              { k: 'subject', label: '各科' },
              { k: 'total', label: '总分' },
              { k: 'rank', label: '年排' },
            ] as { k: ChartMode; label: string }[]
          ).map((t) => (
            <Pressable
              key={t.k}
              onPress={() => setMode(t.k)}
              style={[styles.tabPill, mode === t.k && styles.tabPillActive]}
            >
              <Text
                style={[
                  styles.tabPillText,
                  mode === t.k && styles.tabPillTextActive,
                ]}
              >
                {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* 学科 rotator, 仅在 subject 模式下 */}
        {mode === 'subject' && (
          <View style={styles.subjectRow}>
            {SUBJECTS.map((s) => (
              <Pressable
                key={s.key}
                onPress={() => setActiveSubject(s.key)}
                style={[
                  styles.subjectPill,
                  activeSubject === s.key && {
                    backgroundColor: s.color,
                    borderColor: s.color,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.subjectPillText,
                    activeSubject === s.key && styles.subjectPillTextActive,
                  ]}
                >
                  {s.key}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* 图表 */}
        <View style={styles.chartCard}>
          {chartPoints.length === 0 ? (
            <Text style={styles.emptyText}>还没有考试数据</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <LineChart
                data={chartPoints}
                width={chartWidth}
                height={220}
                thickness={2}
                color={chartColor}
                dataPointsColor={chartColor}
                dataPointsRadius={4}
                yAxisColor={colors.divider}
                xAxisColor={colors.divider}
                yAxisTextStyle={{ color: colors.slate500, fontSize: 10 }}
                xAxisLabelTextStyle={{
                  color: colors.slate500,
                  fontSize: 10,
                }}
                rulesColor={colors.divider}
                rulesType="solid"
                noOfSections={4}
                curved={false}
                initialSpacing={16}
                spacing={52}
              />
            </ScrollView>
          )}
          <Text style={styles.chartCaption}>
            {mode === 'subject'
              ? `${activeSubject} · 原始分`
              : mode === 'total'
              ? '总分'
              : '年级排名 (数字越小名次越前)'}
          </Text>
        </View>

        {/* 考试列表 */}
        <Text style={styles.sectionTitle}>历次考试</Text>
        {exams.length === 0 && !loading ? (
          <Text style={styles.emptyText}>暂无记录</Text>
        ) : (
          exams.map((e) => (
            <View key={e.id} style={styles.examCard}>
              <View style={styles.examCardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.examName}>
                    {e.stage ? `${e.stage} · ` : ''}
                    {e.exam_name}
                  </Text>
                  <Text style={styles.examMeta}>
                    {e.exam_date || '—'}
                    {e.total != null ? ` · 总分 ${e.total.toFixed(1)}` : ''}
                    {e.grade_rank != null ? ` · 年排 ${e.grade_rank}` : ''}
                  </Text>
                </View>
                {!isParent && (
                  <Pressable
                    onPress={() => confirmDelete(e.id)}
                    hitSlop={8}
                    style={styles.deleteBtn}
                  >
                    <Text style={styles.deleteBtnText}>删</Text>
                  </Pressable>
                )}
              </View>
              <View style={styles.scoresRow}>
                {SUBJECTS.map((s) => {
                  const v = e.scores[s.key]
                  return (
                    <View key={s.key} style={styles.scoreCell}>
                      <Text style={styles.scoreLabel}>{s.key}</Text>
                      <Text
                        style={[
                          styles.scoreValue,
                          v == null && styles.scoreValueEmpty,
                        ]}
                      >
                        {v != null ? v : '-'}
                      </Text>
                    </View>
                  )
                })}
              </View>
              {e.notes ? (
                <Text style={styles.examNotes}>{e.notes}</Text>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

      {/* 录入 Modal — 仅学生 */}
      {!isParent && (
        <Modal
          visible={showAdd}
          animationType="slide"
          transparent={false}
          onRequestClose={() => setShowAdd(false)}
        >
          <SafeAreaView style={styles.modalContainer} edges={['top']}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setShowAdd(false)} hitSlop={8}>
                <Text style={styles.modalCancel}>取消</Text>
              </Pressable>
              <Text style={styles.modalTitle}>录入新成绩</Text>
              <Pressable
                onPress={submit}
                hitSlop={8}
                disabled={saving}
              >
                <Text
                  style={[
                    styles.modalSave,
                    saving && { opacity: 0.4 },
                  ]}
                >
                  保存
                </Text>
              </Pressable>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Text style={styles.formLabel}>考试名称</Text>
              <TextInput
                style={styles.input}
                placeholder="如: 5月月考"
                placeholderTextColor={colors.slate400}
                value={form.exam_name}
                onChangeText={(v) => setForm({ ...form, exam_name: v })}
              />

              <Text style={styles.formLabel}>考试日期 (YYYY-MM-DD)</Text>
              <TextInput
                style={styles.input}
                placeholder="2026-04-17"
                placeholderTextColor={colors.slate400}
                value={form.exam_date}
                onChangeText={(v) => setForm({ ...form, exam_date: v })}
                autoCapitalize="none"
              />

              <Text style={styles.formLabel}>阶段</Text>
              <View style={styles.stageRow}>
                {STAGES.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setForm({ ...form, stage: s })}
                    style={[
                      styles.stagePill,
                      form.stage === s && styles.stagePillActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.stagePillText,
                        form.stage === s && styles.stagePillTextActive,
                      ]}
                    >
                      {s}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.formLabel}>年级排名 (可选)</Text>
              <TextInput
                style={styles.input}
                placeholder="如: 35"
                placeholderTextColor={colors.slate400}
                keyboardType="number-pad"
                value={gradeRank}
                onChangeText={setGradeRank}
              />

              <Text style={styles.formLabel}>各科成绩</Text>
              {SUBJECTS.map((s) => (
                <View key={s.key} style={styles.scoreInputRow}>
                  <Text style={styles.scoreInputLabel}>
                    {s.key}
                    <Text style={styles.scoreInputFull}> / {s.full}</Text>
                  </Text>
                  <TextInput
                    style={[styles.input, styles.scoreInputField]}
                    placeholder="分数"
                    placeholderTextColor={colors.slate400}
                    keyboardType="decimal-pad"
                    value={form.scores[s.key]}
                    onChangeText={(v) =>
                      setForm({
                        ...form,
                        scores: { ...form.scores, [s.key]: v },
                      })
                    }
                  />
                </View>
              ))}

              <Text style={styles.formLabel}>备注 (可选)</Text>
              <TextInput
                style={styles.input}
                placeholder="备注"
                placeholderTextColor={colors.slate400}
                value={form.notes}
                onChangeText={(v) => setForm({ ...form, notes: v })}
              />

              <Text style={styles.formLabel}>
                这次考完的感受 (可选) · 只给你自己看
              </Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="考试当时的心情, 哪里紧张, 哪里满意..."
                placeholderTextColor={colors.slate400}
                value={examFeeling}
                onChangeText={setExamFeeling}
                multiline
                maxLength={500}
              />

              <View style={{ height: 40 }} />
            </ScrollView>
          </SafeAreaView>
        </Modal>
      )}
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },
  addBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  errorText: {
    color: colors.red500,
    fontSize: 13,
    padding: 8,
    textAlign: 'center',
  },

  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#e2e8f0',
  },
  tabPillActive: { backgroundColor: colors.brand },
  tabPillText: { fontSize: 13, color: colors.slate600 },
  tabPillTextActive: { color: '#fff', fontWeight: '600' },

  subjectRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 12,
  },
  subjectPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  subjectPillText: { fontSize: 12, color: colors.slate700 },
  subjectPillTextActive: { color: '#fff', fontWeight: '600' },

  chartCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
  },
  chartCaption: {
    fontSize: 11,
    color: colors.slate500,
    textAlign: 'center',
    marginTop: 8,
  },

  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.slate800,
    marginBottom: 8,
  },

  examCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  examCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  examName: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  examMeta: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  deleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  deleteBtnText: { color: colors.red500, fontSize: 12 },
  scoresRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scoreCell: {
    minWidth: 54,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: colors.bg,
    alignItems: 'center',
  },
  scoreLabel: { fontSize: 11, color: colors.slate500 },
  scoreValue: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.slate800,
    marginTop: 2,
  },
  scoreValueEmpty: { color: colors.slate400, fontWeight: '400' },
  examNotes: {
    fontSize: 12,
    color: colors.slate500,
    marginTop: 8,
    fontStyle: 'italic',
  },

  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    paddingVertical: 24,
    fontSize: 13,
  },

  // Modal
  modalContainer: { flex: 1, backgroundColor: colors.bg },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: '#fff',
  },
  modalTitle: { fontSize: 16, fontWeight: '600', color: colors.slate900 },
  modalCancel: { fontSize: 15, color: colors.slate500 },
  modalSave: { fontSize: 15, color: colors.brand, fontWeight: '600' },
  modalScroll: { padding: 16 },

  formLabel: {
    fontSize: 12,
    color: colors.slate600,
    marginTop: 12,
    marginBottom: 6,
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
  textArea: {
    minHeight: 72,
    textAlignVertical: 'top',
  },
  stageRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  stagePill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  stagePillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  stagePillText: { fontSize: 12, color: colors.slate700 },
  stagePillTextActive: { color: '#fff', fontWeight: '600' },

  scoreInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  scoreInputLabel: { fontSize: 13, color: colors.slate700, width: 90 },
  scoreInputFull: { color: colors.slate400, fontSize: 11 },
  scoreInputField: { flex: 1 },
})
