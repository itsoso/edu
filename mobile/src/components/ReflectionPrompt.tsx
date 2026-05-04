/**
 * ReflectionPrompt — "想想看" (元认知伙伴 P4)
 *
 * 折叠区块. 顶部一行始终可见; 展开后显示 AI 引导问题 + 学生输入框.
 *
 * 隐私关键: 学生的回答永远不传给 reflector — 只走 /api/reflections.
 * UI 上明确告知 "回答只有你能看到, 不会被 AI 分析".
 */
import React, { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  Alert,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native'
import { api, Reflection } from '../lib/api'
import { colors } from '../lib/theme'

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true)
}

type Props = {
  sourceTable: 'mistakes' | 'practice_items'
  sourceId: number
  /** kind for storing the answer in reflections table.
   *  'mistake_note' for mistakes (pre-existing kind, related_id=mistake.id)
   *  'free_write' for practice_items (no upsert, just append) */
  storeKind: 'mistake_note' | 'free_write'
  /** practice items: 用 'free_write' + related_key (e.g. `pi_${id}`)
   *  mistakes: 用 'mistake_note' + related_id */
  storeRelatedKey?: string
}

const MAX_LEN = 2000

export default function ReflectionPrompt({
  sourceTable,
  sourceId,
  storeKind,
  storeRelatedKey,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const [question, setQuestion] = useState<string>('')
  const [loadingQ, setLoadingQ] = useState(false)
  const [qErr, setQErr] = useState('')

  const [content, setContent] = useState('')
  const [loadedExisting, setLoadedExisting] = useState(false)
  const [existing, setExisting] = useState<Reflection | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  const fetchedQuestionRef = useRef(false)

  // Pre-load existing reflection (so 重新打开时能看到旧答案)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const params: Parameters<typeof api.listReflections>[0] = {
          kind: storeKind,
          limit: 1,
        }
        if (storeKind === 'mistake_note') {
          params.related_id = sourceId
        } else if (storeRelatedKey) {
          params.related_key = storeRelatedKey
        }
        const list = await api.listReflections(params)
        if (cancelled) return
        if (list.length > 0) {
          setExisting(list[0])
          setContent(list[0].content)
          setSavedAt(list[0].updated_at)
        }
        setLoadedExisting(true)
      } catch {
        if (!cancelled) setLoadedExisting(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [storeKind, sourceId, storeRelatedKey])

  async function fetchQuestion(force = false) {
    if (loadingQ) return
    if (!force && fetchedQuestionRef.current && question) return
    setLoadingQ(true)
    setQErr('')
    try {
      const r = await api.reflectorQuestion({
        source_table: sourceTable,
        source_id: sourceId,
      })
      setQuestion(r.question)
      fetchedQuestionRef.current = true
    } catch (e: any) {
      setQErr(e?.message || String(e))
    } finally {
      setLoadingQ(false)
    }
  }

  function toggleExpand() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut)
    const next = !expanded
    setExpanded(next)
    if (next && !fetchedQuestionRef.current) {
      fetchQuestion()
    }
  }

  async function save() {
    const trimmed = content.trim()
    if (!trimmed) {
      Alert.alert('提示', '写一点再保存吧')
      return
    }
    setSaving(true)
    try {
      const payload: Parameters<typeof api.upsertReflection>[0] = {
        kind: storeKind,
        content: trimmed,
      }
      if (storeKind === 'mistake_note') {
        payload.related_id = sourceId
      } else if (storeRelatedKey) {
        payload.related_key = storeRelatedKey
      }
      const r = await api.upsertReflection(payload)
      setExisting(r)
      setSavedAt(r.updated_at)
    } catch (e: any) {
      Alert.alert('保存失败', String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <View
      style={styles.container}
      onStartShouldSetResponder={() => true}
    >
      <Pressable onPress={toggleExpand} style={styles.header} hitSlop={4}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>💭 想想看</Text>
          <Text style={styles.subtitle}>
            回答只有你能看到, 不会被 AI 分析
          </Text>
        </View>
        <Text style={styles.chev}>{expanded ? '▼' : '▶'}</Text>
      </Pressable>

      {expanded && (
        <View style={styles.body}>
          {loadingQ ? (
            <View style={styles.qLoadingRow}>
              <ActivityIndicator color="#7c3aed" />
              <Text style={styles.qLoadingText}>在想问题...</Text>
            </View>
          ) : qErr ? (
            <View>
              <Text style={styles.errText}>问题加载失败: {qErr}</Text>
              <Pressable onPress={() => fetchQuestion(true)} hitSlop={6}>
                <Text style={styles.linkText}>重试</Text>
              </Pressable>
            </View>
          ) : question ? (
            <View style={styles.qRow}>
              <Text style={styles.questionText}>{question}</Text>
              <Pressable onPress={() => fetchQuestion(true)} hitSlop={6}>
                <Text style={styles.linkText}>换一个</Text>
              </Pressable>
            </View>
          ) : null}

          {loadedExisting ? (
            <TextInput
              style={styles.input}
              value={content}
              onChangeText={(t) =>
                setContent(t.length > MAX_LEN ? t.slice(0, MAX_LEN) : t)
              }
              placeholder="写给自己看. 没有标准答案."
              placeholderTextColor={colors.slate400}
              multiline
              numberOfLines={4}
              maxLength={MAX_LEN}
            />
          ) : (
            <ActivityIndicator color="#7c3aed" />
          )}

          <View style={styles.footerRow}>
            <Text style={styles.counter}>
              {content.length}/{MAX_LEN}
            </Text>
            {savedAt ? (
              <Text style={styles.savedHint}>
                已保存 · {formatTime(savedAt)} · 仅你可见
              </Text>
            ) : null}
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={save}
              disabled={saving}
              style={[styles.saveBtn, saving && { opacity: 0.5 }]}
            >
              <Text style={styles.saveBtnText}>
                {saving ? '保存中...' : existing ? '更新' : '保存'}
              </Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  )
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso)
    const now = new Date()
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    if (sameDay) return `今天 ${hh}:${mm}`
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    return `${m}/${dd} ${hh}:${mm}`
  } catch {
    return iso
  }
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#faf5ff',
    borderWidth: 1,
    borderColor: '#d8b4fe',
    borderRadius: 8,
    marginTop: 8,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  title: { fontSize: 13, fontWeight: '600', color: '#6b21a8' },
  subtitle: { fontSize: 11, color: '#7c3aed', marginTop: 2 },
  chev: { fontSize: 12, color: '#7c3aed' },

  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 8,
    borderTopWidth: 1,
    borderTopColor: '#e9d5ff',
  },

  qLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  qLoadingText: { fontSize: 13, color: '#7c3aed' },

  qRow: { gap: 4, marginTop: 8 },
  questionText: {
    fontSize: 15,
    lineHeight: 22,
    color: '#581c87',
    fontWeight: '500',
  },
  linkText: {
    fontSize: 12,
    color: '#7c3aed',
    textDecorationLine: 'underline',
    alignSelf: 'flex-start',
  },
  errText: { fontSize: 12, color: colors.red500 },

  input: {
    borderWidth: 1,
    borderColor: '#e9d5ff',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
    backgroundColor: '#fff',
    minHeight: 88,
    textAlignVertical: 'top',
  },

  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  counter: { fontSize: 11, color: colors.slate400 },
  savedHint: { fontSize: 11, color: colors.slate500 },

  saveBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  saveBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})
