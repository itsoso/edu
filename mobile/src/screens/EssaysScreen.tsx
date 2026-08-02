/**
 * 作文管理页 (RN) — 三种录入 (📸/📄/✍️) + 列表 + 详情.
 * iPhone: 详情走 Modal. iPad: 左右分栏 (SplitView).
 */
import React, { useCallback, useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  Modal,
  Image,
  Alert,
  ActivityIndicator,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import DocumentPicker from 'react-native-document-picker'
import { api, Essay } from '../lib/api'
import { API_BASE_URL } from '../lib/config'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import { pickImage, pickImagesMulti } from '../lib/imageCompress'
import { cachedFetch } from '../lib/offlineCache'
import EssayAnalysisView from '../components/EssayAnalysisView'
import SplitView from '../components/SplitView'
import Share from 'react-native-share'

type InputTab = 'photo' | 'document' | 'text'
const ESSAY_TYPES = ['记叙文', '议论文', '说明文', '应用文']
const PAGE_SIZE = 20

const TABS: { key: InputTab; icon: string; label: string }[] = [
  { key: 'photo', icon: '📸', label: '拍照' },
  { key: 'document', icon: '📄', label: '导入文件' },
  { key: 'text', icon: '✍️', label: '粘贴文本' },
]

function sourceIcon(t: Essay['source_type']): string {
  return t === 'photo' ? '📸' : t === 'document' ? '📄' : '✍️'
}

type DetailProps = {
  essay: Essay
  editing: boolean
  editTitle: string
  editType: string
  editTopic: string
  setEditTitle: (s: string) => void
  setEditType: (s: string) => void
  setEditTopic: (s: string) => void
  startEdit: () => void
  cancelEdit: () => void
  saveEdit: () => void
  triggerOcr: () => void
  triggerAnalysis: () => void
  shareEssay: (e: Essay) => void
  confirmDelete: (id: number) => void
  onClose: () => void
  isProcessing: boolean
  /** iPad 模式下不走 SafeAreaView+Modal, 仅占据右栏 */
  embedded: boolean
}

function EssayDetail(props: DetailProps) {
  const {
    essay,
    editing,
    editTitle,
    editType,
    editTopic,
    setEditTitle,
    setEditType,
    setEditTopic,
    startEdit,
    cancelEdit,
    saveEdit,
    triggerOcr,
    triggerAnalysis,
    shareEssay,
    confirmDelete,
    onClose,
    isProcessing,
  } = props
  const photoUrls = essay.file_urls?.length
    ? essay.file_urls
    : essay.file_url
    ? [essay.file_url]
    : []

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <View style={styles.modalHeader}>
        <Text style={styles.modalTitle} numberOfLines={1}>
          {essay.title || '(无标题)'}
        </Text>
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.modalClose}>关闭</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {editing ? (
          <View style={{ gap: 8, marginBottom: 12 }}>
            <TextInput
              style={styles.input}
              placeholder="标题"
              placeholderTextColor={colors.slate400}
              value={editTitle}
              onChangeText={setEditTitle}
            />
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              {ESSAY_TYPES.map((t) => (
                <Pressable
                  key={t}
                  onPress={() => setEditType(editType === t ? '' : t)}
                  style={[styles.typePill, editType === t && styles.typePillActive]}
                >
                  <Text
                    style={[
                      styles.typePillText,
                      editType === t && styles.typePillTextActive,
                    ]}
                  >
                    {t}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              style={styles.input}
              placeholder="话题"
              placeholderTextColor={colors.slate400}
              value={editTopic}
              onChangeText={setEditTopic}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={saveEdit} style={styles.primaryBtn}>
                <Text style={styles.primaryBtnText}>保存</Text>
              </Pressable>
              <Pressable onPress={cancelEdit} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>取消</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.detailMetaRow}>
            {!!essay.essay_type && (
              <View style={styles.typeBadge}>
                <Text style={styles.typeBadgeText}>{essay.essay_type}</Text>
              </View>
            )}
            {!!essay.topic && (
              <Text style={styles.detailMetaText}>{essay.topic}</Text>
            )}
            <Text style={styles.detailMetaText}>{essay.word_count} 字</Text>
            <Text style={styles.detailMetaText}>
              {sourceIcon(essay.source_type)}
              {essay.source_type === 'photo'
                ? ' 拍照'
                : essay.source_type === 'document'
                ? ' Word'
                : ' 粘贴'}
            </Text>
          </View>
        )}

        {/* 操作 */}
        {!editing && (
          <View style={styles.actionRow}>
            {essay.source_type === 'photo' && essay.status === 'uploaded' && (
              <Pressable
                onPress={triggerOcr}
                disabled={isProcessing}
                style={[styles.primaryBtn, isProcessing && styles.btnDisabled]}
              >
                <Text style={styles.primaryBtnText}>🔍 识别文字 (OCR)</Text>
              </Pressable>
            )}
            {essay.status === 'ocr_processing' && (
              <View style={styles.statusPill}>
                <ActivityIndicator size="small" color={colors.brand} />
                <Text style={styles.statusText}>正在识别文字...</Text>
              </View>
            )}
            {(essay.status === 'ocr_done' ||
              (!!essay.content &&
                essay.status !== 'analyzing' &&
                essay.status !== 'analyzed' &&
                essay.status !== 'ocr_processing')) && (
              <Pressable
                onPress={triggerAnalysis}
                disabled={isProcessing}
                style={[styles.purpleBtn, isProcessing && styles.btnDisabled]}
              >
                <Text style={styles.primaryBtnText}>🧠 AI 批改</Text>
              </Pressable>
            )}
            {essay.status === 'analyzing' && (
              <View style={styles.statusPill}>
                <ActivityIndicator size="small" color="#7c3aed" />
                <Text style={[styles.statusText, { color: '#6d28d9' }]}>
                  AI 批改中...
                </Text>
              </View>
            )}
            {essay.status === 'analyzed' && (
              <Pressable onPress={triggerAnalysis} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>🔄 重新批改</Text>
              </Pressable>
            )}
            <Pressable onPress={startEdit} style={styles.secondaryBtn}>
              <Text style={styles.secondaryBtnText}>编辑</Text>
            </Pressable>
            <Pressable
              onPress={() => shareEssay(essay)}
              style={styles.secondaryBtn}
            >
              <Text style={styles.secondaryBtnText}>📤 分享</Text>
            </Pressable>
            <Pressable onPress={() => confirmDelete(essay.id)} style={styles.dangerBtn}>
              <Text style={styles.dangerBtnText}>删除</Text>
            </Pressable>
          </View>
        )}

        {essay.status === 'failed' && !!essay.error_message && (
          <Text style={styles.errorText}>失败: {essay.error_message.slice(0, 200)}</Text>
        )}

        {essay.source_type === 'photo' && photoUrls.map((url, index) => (
          <Image
            key={url}
            source={{ uri: url.startsWith('http') ? url : API_BASE_URL + url }}
            accessibilityLabel={`作文第 ${index + 1} 页`}
            style={styles.essayImage}
            resizeMode="contain"
          />
        ))}

        {!!essay.content && (
          <View style={styles.contentBox}>
            <Text style={styles.contentLabel}>正文 ({essay.word_count} 字)</Text>
            <Text style={styles.contentText}>{essay.content}</Text>
          </View>
        )}

        {!!essay.analysis && (
          <View style={{ marginTop: 16 }}>
            <Text style={styles.sectionHeader}>AI 批改结果</Text>
            <EssayAnalysisView analysis={essay.analysis} />
          </View>
        )}
      </ScrollView>
    </View>
  )
}

export default function EssaysScreen() {
  const { hPadding, isTablet } = useResponsive()
  const [essays, setEssays] = useState<Essay[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState<Essay | null>(null)
  const [tab, setTab] = useState<InputTab>('text')
  const [busy, setBusy] = useState('')
  const [filterType, setFilterType] = useState('')
  const [offlineHint, setOfflineHint] = useState(false)

  // 粘贴文本
  const [textTitle, setTextTitle] = useState('')
  const [textContent, setTextContent] = useState('')
  const [textType, setTextType] = useState('')
  const [textTopic, setTextTopic] = useState('')

  // 编辑
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editType, setEditType] = useState('')
  const [editTopic, setEditTopic] = useState('')

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const cacheKey = `essays:list:t=${filterType || ''}`
      const { data: r, fromCache } = await cachedFetch(cacheKey, () =>
        api.listEssays({
          essay_type: filterType || undefined,
          limit: PAGE_SIZE,
        })
      )
      setEssays(r.items)
      setTotal(r.total)
      setOfflineHint(fromCache)
      if (active) {
        const u = r.items.find((e) => e.id === active.id)
        if (u) setActive(u)
      }
    } catch (e: any) {
      Alert.alert('加载失败', String(e?.message || e))
    } finally {
      setLoading(false)
    }
  }, [filterType, active])

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType])

  // 轮询 OCR / 分析中状态
  useEffect(() => {
    if (!active) return
    if (active.status !== 'ocr_processing' && active.status !== 'analyzing') return
    const timer = setInterval(async () => {
      try {
        const u = await api.getEssay(active.id)
        setActive(u)
        if (u.status !== 'ocr_processing' && u.status !== 'analyzing') {
          reload()
        }
      } catch {
        /* ignore */
      }
    }, 3000)
    return () => clearInterval(timer)
  }, [active, reload])

  async function pickMultiFromLibrary() {
    try {
      const assets = await pickImagesMulti('essay', 9)
      if (assets.length === 0) return
      if (assets.length === 1) {
        await doUploadPhoto(assets[0])
        return
      }
      const items = assets
        .filter((a) => !!a.uri)
        .map((a, i) => ({
          uri: a.uri as string,
          name: a.fileName || `essay-${Date.now()}-${i}.jpg`,
          mime: a.type || 'image/jpeg',
        }))
      setBusy(`上传 ${items.length} 张...`)
      try {
        const essay = await api.uploadEssayPhotos(items)
        signals.track('essay.create', {
          related_table: 'essays',
          related_id: essay.id,
          payload: {
            source_type: 'photo',
            word_count: essay.word_count || 0,
            pages: items.length,
          },
        })
        setActive(essay)
        Alert.alert('上传成功', `${items.length} 张已上传, 点 "识别文字" 按顺序拼接`)
        reload()
      } catch (e: any) {
        Alert.alert('上传失败', String(e?.message || e))
      } finally {
        setBusy('')
      }
    } catch (e: any) {
      Alert.alert('选择失败', String(e?.message || e))
    }
  }

  async function pickFromCamera() {
    try {
      const asset = await pickImage('camera', 'essay')
      if (!asset) return
      await doUploadPhoto(asset)
    } catch (e: any) {
      Alert.alert('拍照失败', String(e?.message || e))
    }
  }

  async function doUploadPhoto(asset: { uri?: string; fileName?: string; type?: string; fileSize?: number }) {
    if (!asset.uri) return
    const sizeKb = asset.fileSize ? Math.round(asset.fileSize / 1024) : null
    setBusy(sizeKb ? `上传中 (${sizeKb}KB)...` : '上传中...')
    try {
      const essay = await api.uploadEssayFile(
        asset.uri,
        asset.fileName || `photo-${Date.now()}.jpg`,
        asset.type || 'image/jpeg',
        'photo'
      )
      signals.track('essay.create', {
        related_table: 'essays',
        related_id: essay.id,
        payload: {
          source_type: 'photo',
          word_count: essay.word_count || 0,
        },
      })
      setActive(essay)
      Alert.alert('上传成功', '点 "识别文字" 开始 OCR')
      reload()
    } catch (e: any) {
      Alert.alert('上传失败', String(e?.message || e))
    } finally {
      setBusy('')
    }
  }

  async function pickDocument() {
    try {
      const res = await DocumentPicker.pickSingle({
        type: [
          DocumentPicker.types.docx,
          DocumentPicker.types.doc,
          'org.openxmlformats.wordprocessingml.document',
        ],
        copyTo: 'cachesDirectory',
      })
      setBusy('上传中...')
      try {
        const essay = await api.uploadEssayFile(
          res.fileCopyUri || res.uri,
          res.name || 'essay.docx',
          res.type ||
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'document'
        )
        signals.track('essay.create', {
          related_table: 'essays',
          related_id: essay.id,
          payload: {
            source_type: 'document',
            word_count: essay.word_count || 0,
          },
        })
        setActive(essay)
        Alert.alert('上传成功', 'Word 文档已上传')
        reload()
      } catch (e: any) {
        Alert.alert('上传失败', String(e?.message || e))
      } finally {
        setBusy('')
      }
    } catch (e: any) {
      if (DocumentPicker.isCancel(e)) return
      Alert.alert('选择失败', String(e?.message || e))
    }
  }

  async function handleTextSubmit() {
    if (!textContent.trim()) {
      Alert.alert('作文内容不能为空')
      return
    }
    setBusy('保存中...')
    try {
      const essay = await api.createEssayFromText({
        content: textContent.trim(),
        title: textTitle.trim() || undefined,
        essay_type: textType || undefined,
        topic: textTopic.trim() || undefined,
      })
      signals.track('essay.create', {
        related_table: 'essays',
        related_id: essay.id,
        payload: {
          source_type: 'text',
          word_count: essay.word_count || 0,
        },
      })
      setActive(essay)
      setTextContent('')
      setTextTitle('')
      setTextType('')
      setTextTopic('')
      reload()
    } catch (e: any) {
      Alert.alert('保存失败', String(e?.message || e))
    } finally {
      setBusy('')
    }
  }

  async function triggerOcr() {
    if (!active) return
    try {
      const u = await api.triggerEssayOcr(active.id)
      setActive(u)
    } catch (e: any) {
      Alert.alert('OCR 失败', String(e?.message || e))
    }
  }

  async function triggerAnalysis() {
    if (!active) return
    try {
      const u = await api.triggerEssayAnalysis(active.id)
      setActive(u)
    } catch (e: any) {
      Alert.alert('批改失败', String(e?.message || e))
    }
  }

  function startEdit() {
    if (!active) return
    setEditTitle(active.title || '')
    setEditType(active.essay_type || '')
    setEditTopic(active.topic || '')
    setEditing(true)
  }

  async function saveEdit() {
    if (!active) return
    try {
      const u = await api.updateEssay(active.id, {
        title: editTitle.trim() || undefined,
        essay_type: editType || undefined,
        topic: editTopic.trim() || undefined,
      })
      setActive(u)
      setEditing(false)
      reload()
    } catch (e: any) {
      Alert.alert('更新失败', String(e?.message || e))
    }
  }

  async function shareEssay(e: Essay) {
    const parts: string[] = []
    if (e.title) parts.push(`# ${e.title}\n`)
    else parts.push(`# 作文 (${e.essay_type || '未分类'})\n`)
    if (e.content) parts.push(e.content)
    if (e.analysis) {
      const a = e.analysis
      parts.push(`\n\n---\n\n## AI 批改结果\n`)
      parts.push(`**评分**: ${a.score} (${a.grade})\n`)
      if (a.overall_comment) parts.push(`**总评**: ${a.overall_comment}\n`)
      if (a.strengths?.length) parts.push(`\n**亮点**:\n${a.strengths.map((s) => `- ${s}`).join('\n')}`)
      if (a.weaknesses?.length) parts.push(`\n\n**不足**:\n${a.weaknesses.map((s) => `- ${s}`).join('\n')}`)
      if (a.improvement_suggestions?.length)
        parts.push(`\n\n**改进建议**:\n${a.improvement_suggestions.map((s) => `- ${s}`).join('\n')}`)
    }
    try {
      await Share.open({
        title: e.title || '作文',
        subject: e.title || '作文',
        message: parts.join('\n'),
        failOnCancel: false,
      })
    } catch (err: any) {
      if (err?.message && !/user did not share|cancell/i.test(err.message)) {
        Alert.alert('分享失败', err.message)
      }
    }
  }

  function confirmDelete(id: number) {
    Alert.alert('删除这篇作文?', undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteEssay(id)
            if (active?.id === id) setActive(null)
            reload()
          } catch (e: any) {
            Alert.alert('删除失败', String(e?.message || e))
          }
        },
      },
    ])
  }

  const isProcessing = active?.status === 'ocr_processing' || active?.status === 'analyzing'

  // 列表 ReactNode (header + 录入 tabs + 过滤 + 列表)
  const listNode = (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={reload} />}
    >
      <Text style={styles.title}>作文管理</Text>
      <Text style={styles.subtitle}>收集 · 分类 · AI 批改</Text>
      {offlineHint ? (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📴 网络未连接,显示本账号本地缓存(可能不是最新)</Text>
        </View>
      ) : null}

      {/* 录入 tabs */}
      <View style={styles.card}>
        <View style={styles.tabsRow}>
          {TABS.map((t) => (
            <Pressable
              key={t.key}
              onPress={() => setTab(t.key)}
              style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            >
              <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>
                {t.icon} {t.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.tabBody}>
          {!!busy && <Text style={styles.busyText}>{busy}</Text>}

          {tab === 'photo' && (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Text style={styles.bigEmoji}>📸</Text>
              <Text style={styles.hintText}>
                单张:拍照或选 1 张{'\n'}多张:相册选最多 9 张, AI 按顺序拼接
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                <Pressable
                  onPress={pickFromCamera}
                  disabled={!!busy}
                  style={[styles.primaryBtn, !!busy && styles.btnDisabled]}
                >
                  <Text style={styles.primaryBtnText}>拍照</Text>
                </Pressable>
                <Pressable
                  onPress={pickMultiFromLibrary}
                  disabled={!!busy}
                  style={[styles.secondaryBtn, !!busy && styles.btnDisabled]}
                >
                  <Text style={styles.secondaryBtnText}>相册多张 (≤9)</Text>
                </Pressable>
              </View>
            </View>
          )}

          {tab === 'document' && (
            <View style={{ alignItems: 'center', gap: 10 }}>
              <Text style={styles.bigEmoji}>📄</Text>
              <Text style={styles.hintText}>选择一份 Word 文档 (.docx / .doc)</Text>
              <Pressable
                onPress={pickDocument}
                disabled={!!busy}
                style={[styles.primaryBtn, !!busy && styles.btnDisabled]}
              >
                <Text style={styles.primaryBtnText}>选择文件</Text>
              </Pressable>
            </View>
          )}

          {tab === 'text' && (
            <View style={{ gap: 8 }}>
              <TextInput
                style={styles.input}
                placeholder="标题 (可选)"
                placeholderTextColor={colors.slate400}
                value={textTitle}
                onChangeText={setTextTitle}
              />
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {ESSAY_TYPES.map((t) => (
                  <Pressable
                    key={t}
                    onPress={() => setTextType(textType === t ? '' : t)}
                    style={[styles.typePill, textType === t && styles.typePillActive]}
                  >
                    <Text
                      style={[
                        styles.typePillText,
                        textType === t && styles.typePillTextActive,
                      ]}
                    >
                      {t}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="话题 (可选, 如: 成长/亲情)"
                placeholderTextColor={colors.slate400}
                value={textTopic}
                onChangeText={setTextTopic}
              />
              <TextInput
                style={[styles.input, styles.textarea]}
                placeholder="在这里粘贴作文全文..."
                placeholderTextColor={colors.slate400}
                value={textContent}
                onChangeText={setTextContent}
                multiline
                maxLength={10000}
                textAlignVertical="top"
              />
              <View style={styles.submitRow}>
                <Text style={styles.charCount}>
                  {textContent.replace(/\s/g, '').length} 字
                </Text>
                <Pressable
                  onPress={handleTextSubmit}
                  disabled={!!busy || !textContent.trim()}
                  style={[
                    styles.primaryBtn,
                    (!!busy || !textContent.trim()) && styles.btnDisabled,
                  ]}
                >
                  <Text style={styles.primaryBtnText}>保存</Text>
                </Pressable>
              </View>
            </View>
          )}
        </View>
      </View>

      {/* 过滤 */}
      <View style={styles.filterRow}>
        <Pressable
          onPress={() => setFilterType('')}
          style={[styles.filterPill, filterType === '' && styles.filterPillActive]}
        >
          <Text style={[styles.filterPillText, filterType === '' && styles.filterPillTextActive]}>
            全部
          </Text>
        </Pressable>
        {ESSAY_TYPES.map((t) => (
          <Pressable
            key={t}
            onPress={() => setFilterType(filterType === t ? '' : t)}
            style={[styles.filterPill, filterType === t && styles.filterPillActive]}
          >
            <Text style={[styles.filterPillText, filterType === t && styles.filterPillTextActive]}>
              {t}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.totalText}>共 {total} 篇</Text>
      </View>

      {/* 列表 */}
      {essays.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.bigEmoji}>📝</Text>
          <Text style={styles.emptyTitle}>还没有作文</Text>
          <Text style={styles.emptyDesc}>上传照片、或直接粘贴</Text>
        </View>
      ) : (
        essays.map((e) => {
          const selected = isTablet && active?.id === e.id
          return (
            <Pressable
              key={e.id}
              onPress={() => {
                setActive(e)
                setEditing(false)
              }}
              style={[styles.listItem, selected && styles.listItemSelected]}
            >
              <View style={styles.listItemHeader}>
                {e.essay_type && (
                  <View style={styles.typeBadge}>
                    <Text style={styles.typeBadgeText}>{e.essay_type}</Text>
                  </View>
                )}
                {e.analysis && (
                  <Text
                    style={[
                      styles.scoreTag,
                      {
                        color:
                          e.analysis.score >= 80
                            ? colors.green600
                            : e.analysis.score >= 60
                            ? colors.brand
                            : colors.amber500,
                      },
                    ]}
                  >
                    {e.analysis.score}分
                  </Text>
                )}
                <Text style={styles.wordCount}>{e.word_count} 字</Text>
              </View>
              <Text style={styles.listItemTitle} numberOfLines={1}>
                {e.title || e.content?.slice(0, 30) || `#${e.id}`}
              </Text>
              <Text style={styles.listItemMeta}>
                {sourceIcon(e.source_type)} {new Date(e.created_at).toLocaleDateString()}
                {e.topic ? ` · ${e.topic}` : ''}
              </Text>
            </Pressable>
          )
        })
      )}
    </ScrollView>
  )

  // iPad: SplitView 双栏
  if (isTablet) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <SplitView
          list={listNode}
          detail={
            active ? (
              <EssayDetail
                essay={active}
                editing={editing}
                editTitle={editTitle}
                editType={editType}
                editTopic={editTopic}
                setEditTitle={setEditTitle}
                setEditType={setEditType}
                setEditTopic={setEditTopic}
                startEdit={startEdit}
                cancelEdit={() => setEditing(false)}
                saveEdit={saveEdit}
                triggerOcr={triggerOcr}
                triggerAnalysis={triggerAnalysis}
                shareEssay={shareEssay}
                confirmDelete={confirmDelete}
                onClose={() => setActive(null)}
                isProcessing={isProcessing}
                embedded
              />
            ) : null
          }
          emptyHint="选一篇作文查看详情 / AI 批改"
        />
      </SafeAreaView>
    )
  }

  // iPhone: 单列 + Modal 详情 (保留原行为)
  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {listNode}

      {/* 详情 Modal */}
      <Modal
        visible={!!active}
        animationType="slide"
        onRequestClose={() => setActive(null)}
        presentationStyle="pageSheet"
      >
        <SafeAreaView style={styles.container} edges={['top']}>
          {active && (
            <EssayDetail
              essay={active}
              editing={editing}
              editTitle={editTitle}
              editType={editType}
              editTopic={editTopic}
              setEditTitle={setEditTitle}
              setEditType={setEditType}
              setEditTopic={setEditTopic}
              startEdit={startEdit}
              cancelEdit={() => setEditing(false)}
              saveEdit={saveEdit}
              triggerOcr={triggerOcr}
              triggerAnalysis={triggerAnalysis}
              shareEssay={shareEssay}
              confirmDelete={confirmDelete}
              onClose={() => setActive(null)}
              isProcessing={isProcessing}
              embedded={false}
            />
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 2, marginBottom: 16 },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    overflow: 'hidden',
    marginBottom: 16,
  },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider },
  tabBtn: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabBtnActive: {
    backgroundColor: colors.brandLight,
    borderBottomWidth: 2,
    borderBottomColor: colors.brand,
  },
  tabText: { fontSize: 13, color: colors.slate500, fontWeight: '500' },
  tabTextActive: { color: colors.brand },
  tabBody: { padding: 16 },
  busyText: { fontSize: 13, color: colors.brand, marginBottom: 8 },
  bigEmoji: { fontSize: 40, textAlign: 'center' },
  hintText: { fontSize: 13, color: colors.slate600, textAlign: 'center' },

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
  textarea: { minHeight: 150, paddingTop: 10 },
  submitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  charCount: { fontSize: 11, color: colors.slate400 },

  typePill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  typePillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  typePillText: { fontSize: 12, color: colors.slate700 },
  typePillTextActive: { color: '#fff', fontWeight: '500' },

  primaryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  purpleBtn: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  secondaryBtnText: { color: colors.slate700, fontSize: 13 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  dangerBtnText: { color: colors.red500, fontSize: 13 },
  btnDisabled: { opacity: 0.5 },

  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    alignItems: 'center',
    marginBottom: 12,
  },
  filterPill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#fff',
  },
  filterPillActive: { backgroundColor: colors.brand, borderColor: colors.brand },
  filterPillText: { fontSize: 12, color: colors.slate700 },
  filterPillTextActive: { color: '#fff', fontWeight: '500' },
  totalText: { fontSize: 11, color: colors.slate500, marginLeft: 'auto' },

  emptyCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 32,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: colors.slate700 },
  emptyDesc: { fontSize: 12, color: colors.slate500 },

  listItem: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  listItemSelected: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  listItemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  typeBadge: {
    backgroundColor: '#f3e8ff',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  typeBadgeText: { fontSize: 11, color: '#7e22ce' },
  scoreTag: { fontSize: 12, fontWeight: '700' },
  wordCount: { fontSize: 11, color: colors.slate400, marginLeft: 'auto' },
  listItemTitle: { fontSize: 14, fontWeight: '500', color: colors.slate900 },
  listItemMeta: { fontSize: 11, color: colors.slate400, marginTop: 2 },

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
    backgroundColor: '#fff',
  },
  modalTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.slate900 },
  modalClose: { fontSize: 14, color: colors.brand },

  detailMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
    marginBottom: 12,
  },
  detailMetaText: { fontSize: 12, color: colors.slate500 },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: { fontSize: 13, color: colors.brand },
  errorText: { fontSize: 12, color: colors.red500, marginBottom: 12 },
  offlineBanner: {
    backgroundColor: '#fef3c7',
    borderColor: '#fcd34d',
    borderWidth: 1,
    marginVertical: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 6,
  },
  offlineText: { color: '#92400e', fontSize: 12 },
  essayImage: {
    width: '100%',
    height: 200,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    marginBottom: 12,
    backgroundColor: '#f8fafc',
  },
  contentBox: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 12,
    backgroundColor: '#fff',
  },
  contentLabel: { fontSize: 11, color: colors.slate500, marginBottom: 6 },
  contentText: { fontSize: 13, color: colors.slate800, lineHeight: 21 },
  sectionHeader: {
    fontSize: 14,
    fontWeight: '600',
    color: '#6d28d9',
    marginBottom: 8,
  },
})
