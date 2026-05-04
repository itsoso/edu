import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  Image,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api, ExamUpload, ExtractedMistake, ExamAnalysis } from '../lib/api'
import { colors } from '../lib/theme'
import { API_BASE_URL } from '../lib/config'
import { useResponsive } from '../lib/responsive'
import { pickImage } from '../lib/imageCompress'
import MathText from '../components/MathText'

function statusLabel(s: string): string {
  return (
    (
      {
        uploaded: '待识别',
        extracting: '识别中...',
        extracted: '已识别',
        analyzing: '分析中...',
        analyzed: '已分析',
        failed: '失败',
      } as Record<string, string>
    )[s] || s
  )
}

function imageSrc(u: ExamUpload): string {
  const url = u.image_url || ''
  if (/^https?:\/\//i.test(url)) return url
  return API_BASE_URL + url
}

function previewSrc(u: ExamUpload): string {
  const url = (u as any).preview_url || u.image_url || ''
  if (/^https?:\/\//i.test(url)) return url
  return API_BASE_URL + url
}

export default function ScanScreen() {
  const { hPadding } = useResponsive()
  const [uploads, setUploads] = useState<ExamUpload[]>([])
  const [examName, setExamName] = useState('')
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [active, setActive] = useState<ExamUpload | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [thumbFailed, setThumbFailed] = useState<Set<number>>(new Set())

  const activeIdRef = useRef<number | null>(null)
  activeIdRef.current = active?.id ?? null

  const reload = useCallback(async () => {
    try {
      const list = await api.listUploads()
      setUploads(list)
      if (activeIdRef.current != null) {
        const u = list.find((x) => x.id === activeIdRef.current)
        if (u) setActive(u)
      }
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // Polling every 3s while active is extracting/analyzing
  useEffect(() => {
    if (!active) return
    if (active.status !== 'extracting' && active.status !== 'analyzing') return
    const id = active.id
    const timer = setInterval(async () => {
      try {
        const u = await api.getUpload(id)
        setActive((prev) => (prev && prev.id === id ? u : prev))
        setUploads((prev) => prev.map((x) => (x.id === id ? u : x)))
      } catch {
        /* ignore */
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [active?.id, active?.status])

  // Auto-select all mistakes when extraction finishes
  useEffect(() => {
    if (
      active?.status === 'extracted' &&
      active.extracted?.mistakes?.length
    ) {
      setSelected(new Set(active.extracted.mistakes.map((_, i) => i)))
    }
  }, [active?.id, active?.status, active?.extracted?.mistakes?.length])

  async function pickAndUpload(source: 'camera' | 'library') {
    setErr('')
    try {
      setBusy(source === 'camera' ? '拍照中...' : '选择中...')
      const asset = await pickImage(source, 'scan')
      if (!asset?.uri) {
        setBusy('')
        return
      }
      const sizeKb = asset.fileSize ? Math.round(asset.fileSize / 1024) : null
      setBusy(sizeKb ? `上传中 (${sizeKb}KB)...` : '上传中...')
      const u = await api.uploadExamImage(
        asset.uri,
        asset.fileName || 'scan.jpg',
        asset.type || 'image/jpeg',
        examName || undefined
      )
      setExamName('')
      setActive(u)
      setSelected(new Set())
      await reload()
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setBusy('')
    }
  }

  async function extract() {
    if (!active) return
    setErr('')
    try {
      const u = await api.extractMistakes(active.id)
      setActive(u)
      setSelected(new Set())
      await reload()
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  async function analyze() {
    if (!active) return
    setErr('')
    try {
      const u = await api.analyzeUpload(active.id)
      setActive(u)
      await reload()
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  async function save() {
    if (!active) return
    if (selected.size === 0) {
      Alert.alert('提示', '请至少选择一道要保存的错题')
      return
    }
    setBusy('保存中...')
    try {
      const res = await api.saveExtractedMistakes(
        active.id,
        Array.from(selected)
      )
      Alert.alert('成功', `已保存 ${res.saved} 道错题到错题本`)
    } catch (e: any) {
      Alert.alert('保存失败', e?.message || String(e))
    } finally {
      setBusy('')
    }
  }

  function remove(id: number) {
    Alert.alert('删除这份试卷?', '错题本里已保存的错题不会被删除', [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteUpload(id)
            if (active?.id === id) setActive(null)
            await reload()
          } catch (e: any) {
            Alert.alert('删除失败', e?.message || String(e))
          }
        },
      },
    ])
  }

  function toggleSelected(i: number) {
    const s = new Set(selected)
    if (s.has(i)) s.delete(i)
    else s.add(i)
    setSelected(s)
  }

  const mistakes: ExtractedMistake[] = active?.extracted?.mistakes || []
  const analysis: ExamAnalysis | null | undefined = active?.analysis
  const isProcessing =
    active?.status === 'extracting' || active?.status === 'analyzing'

  const renderUploadItem = ({ item }: { item: ExamUpload }) => {
    const isActive = active?.id === item.id
    const failed = thumbFailed.has(item.id)
    return (
      <Pressable
        onPress={() => {
          setActive(item)
          setSelected(
            new Set(item.extracted?.mistakes?.map((_, i) => i) || [])
          )
        }}
        style={[styles.listItem, isActive && styles.listItemActive]}
      >
        {failed ? (
          <View style={[styles.thumb, styles.thumbPlaceholder]}>
            <Text style={styles.thumbPlaceholderText}>图</Text>
          </View>
        ) : (
          <Image
            source={{ uri: previewSrc(item) }}
            style={styles.thumb}
            onError={() => {
              setThumbFailed((prev) => {
                const s = new Set(prev)
                s.add(item.id)
                return s
              })
            }}
          />
        )}
        <View style={{ flex: 1 }}>
          <View style={styles.rowCenter}>
            <View style={styles.statusBadge}>
              <Text style={styles.statusBadgeText}>
                {statusLabel(item.status)}
              </Text>
            </View>
            <Text style={styles.listTitle} numberOfLines={1}>
              {item.exam_name || item.file_name || `#${item.id}`}
            </Text>
          </View>
          <Text style={styles.listMeta}>
            {(item.subject || '') +
              ' · ' +
              new Date(item.created_at).toLocaleDateString()}
          </Text>
        </View>
      </Pressable>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <FlatList
        data={uploads}
        keyExtractor={(u) => String(u.id)}
        renderItem={renderUploadItem}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>试卷扫描</Text>
            <Text style={styles.subtitle}>
              拍照上传 → AI 识别错题 → 全卷分析 → 二次训练
            </Text>

            {/* 上传区 */}
            <View style={styles.card}>
              <Text style={styles.hint}>
                💡 拍照或从相册选一张试卷, AI 会自动识别错题
              </Text>
              <TextInput
                style={styles.input}
                placeholder="考试名称 (可选, 如: 5月月考)"
                placeholderTextColor={colors.slate400}
                value={examName}
                onChangeText={setExamName}
              />
              <View style={styles.btnRow}>
                <Pressable
                  onPress={() => pickAndUpload('camera')}
                  disabled={!!busy}
                  style={[styles.primaryBtn, !!busy && styles.btnDisabled]}
                >
                  <Text style={styles.primaryBtnText}>📸 拍照</Text>
                </Pressable>
                <Pressable
                  onPress={() => pickAndUpload('library')}
                  disabled={!!busy}
                  style={[styles.secondaryBtn, !!busy && styles.btnDisabled]}
                >
                  <Text style={styles.secondaryBtnText}>🖼 从相册选</Text>
                </Pressable>
              </View>
              {!!busy && (
                <View style={styles.rowCenter}>
                  <ActivityIndicator size="small" color={colors.brand} />
                  <Text style={styles.busyText}>{busy}</Text>
                </View>
              )}
              {!!err && <Text style={styles.errorText}>{err}</Text>}
            </View>

            {/* 详情 */}
            {active && (
              <View style={styles.card}>
                <View style={styles.rowTop}>
                  {thumbFailed.has(active.id) ? (
                    <View style={[styles.activeThumb, styles.thumbPlaceholder]}>
                      <Text style={styles.thumbPlaceholderText}>图</Text>
                    </View>
                  ) : (
                    <Image
                      source={{ uri: imageSrc(active) }}
                      style={styles.activeThumb}
                      onError={() => {
                        setThumbFailed((prev) => {
                          const s = new Set(prev)
                          s.add(active.id)
                          return s
                        })
                      }}
                    />
                  )}
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activeTitle} numberOfLines={2}>
                      {active.exam_name || active.file_name}
                    </Text>
                    <Text style={styles.activeMeta}>
                      {(active.subject || '未识别科目') +
                        ' · ' +
                        new Date(active.created_at).toLocaleString()}
                    </Text>
                    <Text style={styles.activeStatus}>
                      状态:{' '}
                      <Text style={{ fontWeight: '600' }}>
                        {statusLabel(active.status)}
                      </Text>
                    </Text>
                    {!!active.error_message && (
                      <Text style={styles.errorText}>
                        错误: {active.error_message}
                      </Text>
                    )}
                  </View>
                  <Pressable onPress={() => remove(active.id)} hitSlop={8}>
                    <Text style={styles.deleteLink}>删除</Text>
                  </Pressable>
                </View>

                <View style={styles.btnRow}>
                  <Pressable
                    onPress={extract}
                    disabled={!!busy || isProcessing}
                    style={[
                      styles.primaryBtn,
                      (!!busy || isProcessing) && styles.btnDisabled,
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>
                      {active.status === 'extracting'
                        ? '⏳ 识别中...'
                        : mistakes.length
                        ? '🔄 重新识别'
                        : '🔍 识别错题'}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={analyze}
                    disabled={!!busy || isProcessing}
                    style={[
                      styles.purpleBtn,
                      (!!busy || isProcessing) && styles.btnDisabled,
                    ]}
                  >
                    <Text style={styles.primaryBtnText}>
                      {active.status === 'analyzing'
                        ? '⏳ 分析中...'
                        : analysis
                        ? '🔄 重新分析'
                        : '📊 全卷分析'}
                    </Text>
                  </Pressable>
                </View>
                {isProcessing && (
                  <Text style={styles.hint}>
                    AI 处理大约 10-40 秒, 你可以切到其他页面, 稍后回来看结果
                  </Text>
                )}

                {/* 错题列表 */}
                {mistakes.length > 0 && (
                  <View style={{ marginTop: 12 }}>
                    <View style={styles.rowCenter}>
                      <Text style={styles.sectionTitle}>
                        识别到 {mistakes.length} 道错题
                      </Text>
                      <Pressable
                        onPress={() =>
                          setSelected(
                            selected.size === mistakes.length
                              ? new Set()
                              : new Set(mistakes.map((_, i) => i))
                          )
                        }
                      >
                        <Text style={styles.linkText}>
                          {selected.size === mistakes.length
                            ? '取消全选'
                            : '全选'}
                        </Text>
                      </Pressable>
                    </View>
                    {mistakes.map((m, i) => {
                      const checked = selected.has(i)
                      return (
                        <Pressable
                          key={i}
                          onPress={() => toggleSelected(i)}
                          style={[
                            styles.mistakeCard,
                            checked && styles.mistakeCardChecked,
                          ]}
                        >
                          <View
                            style={[
                              styles.checkbox,
                              checked && styles.checkboxChecked,
                            ]}
                          >
                            {checked && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={styles.mistakeHeader}>
                              <Text style={styles.mistakeQn}>
                                {m.question_number || '题'}
                              </Text>
                              {!!m.reason_guess && (
                                <View style={styles.reasonBadge}>
                                  <Text style={styles.reasonBadgeText}>
                                    {m.reason_guess}
                                  </Text>
                                </View>
                              )}
                              {!!m.knowledge_point && (
                                <Text style={styles.kp}>
                                  · {m.knowledge_point}
                                </Text>
                              )}
                              {m.confidence !== undefined && (
                                <Text style={styles.confidence}>
                                  置信度 {(m.confidence * 100).toFixed(0)}%
                                </Text>
                              )}
                            </View>
                            {!!m.question_text && (
                              <MathText
                                text={m.question_text}
                                style={styles.qText}
                              />
                            )}
                            {!!m.wrong_answer && (
                              <View style={styles.ansRow}>
                                <Text style={styles.small}>错: </Text>
                                <View style={styles.ansFill}>
                                  <MathText
                                    text={m.wrong_answer}
                                    style={{ fontSize: 12, color: colors.red500 }}
                                  />
                                </View>
                              </View>
                            )}
                            {!!m.correct_answer && (
                              <View style={styles.ansRow}>
                                <Text style={styles.small}>对: </Text>
                                <View style={styles.ansFill}>
                                  <MathText
                                    text={m.correct_answer}
                                    style={{ fontSize: 12, color: colors.green600 }}
                                  />
                                </View>
                              </View>
                            )}
                          </View>
                        </Pressable>
                      )
                    })}
                    <Pressable
                      onPress={save}
                      disabled={!!busy || selected.size === 0}
                      style={[
                        styles.saveBtn,
                        (!!busy || selected.size === 0) && styles.btnDisabled,
                      ]}
                    >
                      <Text style={styles.primaryBtnText}>
                        💾 保存选中的 {selected.size} 道到错题本
                      </Text>
                    </Pressable>
                  </View>
                )}

                {/* 全卷分析 */}
                {analysis && (
                  <View style={styles.analysisBox}>
                    <Text style={styles.sectionTitle}>全卷分析</Text>
                    {!!analysis.estimated_score && (
                      <Text style={styles.analysisLine}>
                        估分:{' '}
                        <Text style={{ fontWeight: '700' }}>
                          {analysis.estimated_score}
                        </Text>
                      </Text>
                    )}
                    {!!analysis.priority_focus && (
                      <Text style={styles.analysisLine}>
                        <Text style={{ fontWeight: '700' }}>最该专攻: </Text>
                        {analysis.priority_focus}
                      </Text>
                    )}
                    {!!analysis.strengths?.length && (
                      <View style={styles.analysisSection}>
                        <Text style={{ fontWeight: '700' }}>亮点:</Text>
                        {analysis.strengths.map((s, i) => (
                          <Text key={i} style={styles.bullet}>
                            • {s}
                          </Text>
                        ))}
                      </View>
                    )}
                    {!!analysis.weaknesses?.length && (
                      <View style={styles.analysisSection}>
                        <Text style={{ fontWeight: '700' }}>薄弱点:</Text>
                        {analysis.weaknesses.map((s, i) => (
                          <Text key={i} style={styles.bullet}>
                            • {s}
                          </Text>
                        ))}
                      </View>
                    )}
                    {!!analysis.knowledge_gaps?.length && (
                      <View style={styles.analysisSection}>
                        <Text style={{ fontWeight: '700' }}>
                          需要补的知识点:
                        </Text>
                        {analysis.knowledge_gaps.map((s, i) => (
                          <Text key={i} style={styles.bullet}>
                            • {s}
                          </Text>
                        ))}
                      </View>
                    )}
                    {!!analysis.advice && (
                      <View style={styles.analysisSection}>
                        <Text style={{ fontWeight: '700' }}>建议:</Text>
                        <Text style={styles.analysisLine}>
                          {analysis.advice}
                        </Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}

            <Text style={styles.historyHeader}>历史上传</Text>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            还没有上传记录. 上传一张试卷, AI 会帮你挑出所有错题.
          </Text>
        }
      />
    </SafeAreaView>
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
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
    gap: 10,
  },
  hint: { fontSize: 12, color: colors.slate500 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
  },
  btnRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  primaryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  secondaryBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  secondaryBtnText: { color: colors.slate700, fontSize: 14, fontWeight: '600' },
  purpleBtn: {
    backgroundColor: '#9333ea',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  btnDisabled: { opacity: 0.5 },
  saveBtn: {
    backgroundColor: colors.green600,
    paddingVertical: 12,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 8,
  },
  busyText: { marginLeft: 8, fontSize: 13, color: colors.brand },
  errorText: { fontSize: 13, color: colors.red500 },
  rowCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  rowTop: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  activeThumb: {
    width: 72,
    height: 72,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.divider,
  },
  activeTitle: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  activeMeta: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  activeStatus: { fontSize: 12, color: colors.slate700, marginTop: 2 },
  deleteLink: { fontSize: 12, color: colors.red500 },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.slate900,
    flex: 1,
  },
  linkText: { fontSize: 12, color: colors.brand },
  mistakeCard: {
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: '#f8fafc',
    borderRadius: 6,
    padding: 10,
    marginTop: 8,
  },
  mistakeCardChecked: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxChecked: {
    backgroundColor: colors.green600,
    borderColor: colors.green600,
  },
  checkmark: { color: '#fff', fontWeight: '700', fontSize: 12 },
  mistakeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  mistakeQn: { fontSize: 12, fontWeight: '700', color: colors.slate900 },
  reasonBadge: {
    backgroundColor: '#fee2e2',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  reasonBadgeText: { fontSize: 11, color: '#b91c1c' },
  kp: { fontSize: 11, color: colors.slate500 },
  confidence: { fontSize: 11, color: colors.slate400, marginLeft: 'auto' },
  qText: { fontSize: 13, color: colors.slate800, marginTop: 4 },
  small: { fontSize: 12, color: colors.slate600, marginTop: 2 },
  ansRow: { flexDirection: 'row', alignItems: 'flex-start', marginTop: 2 },
  ansFill: { flex: 1 },
  analysisBox: {
    marginTop: 12,
    backgroundColor: '#faf5ff',
    borderWidth: 1,
    borderColor: '#e9d5ff',
    borderRadius: 6,
    padding: 10,
    gap: 6,
  },
  analysisSection: { marginTop: 4 },
  analysisLine: { fontSize: 13, color: colors.slate700, lineHeight: 20 },
  bullet: { fontSize: 13, color: colors.slate700, marginLeft: 8, marginTop: 2 },
  historyHeader: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.slate600,
    marginBottom: 8,
  },
  listItem: {
    flexDirection: 'row',
    gap: 10,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
    alignItems: 'center',
  },
  listItemActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  thumb: {
    width: 48,
    height: 48,
    borderRadius: 4,
    backgroundColor: colors.divider,
  },
  thumbPlaceholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.divider,
  },
  thumbPlaceholderText: { fontSize: 14, color: colors.slate500 },
  statusBadge: {
    backgroundColor: colors.divider,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  statusBadgeText: { fontSize: 11, color: colors.slate700 },
  listTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.slate900,
    flexShrink: 1,
  },
  listMeta: { fontSize: 11, color: colors.slate400, marginTop: 2 },
  emptyText: {
    textAlign: 'center',
    color: colors.slate500,
    paddingVertical: 24,
    fontSize: 13,
  },
})
