/**
 * FeynmanScreen — 反向教学: 学生教 AI.
 *
 * 不是"AI 来教你", 是"你教 AI". 平静中性, 不夸张.
 * 全程可结束, 不强迫满 max_turns 轮.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import {
  api,
  FeynmanAssessment,
  FeynmanTurn,
} from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import MathText from '../components/MathText'

type RouteParams = {
  source_table?: string
  source_id?: number
  sessionId?: number
}

export default function FeynmanScreen() {
  const route = useRoute()
  const navigation = useNavigation<any>()
  const params = (route.params || {}) as RouteParams
  const { hPadding, isTablet, maxContent } = useResponsive()

  const [sessionId, setSessionId] = useState<number | null>(
    params.sessionId ?? null
  )
  const [conversation, setConversation] = useState<FeynmanTurn[]>([])
  const [maxTurns, setMaxTurns] = useState<number>(4)
  const [turnCount, setTurnCount] = useState<number>(0)
  const [status, setStatus] = useState<
    'in_progress' | 'finished' | 'abandoned'
  >('in_progress')
  const [assessment, setAssessment] = useState<FeynmanAssessment | null>(null)
  const [topic, setTopic] = useState<string>('')
  const [manualSubject, setManualSubject] = useState<string | null>(null)
  const [manualKp, setManualKp] = useState<string | null>(null)

  const [answer, setAnswer] = useState('')
  const [bootstrapping, setBootstrapping] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [error, setError] = useState('')

  const scrollRef = useRef<ScrollView | null>(null)

  // 启动 / 加载已有 session
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setBootstrapping(true)
      setError('')
      try {
        if (params.sessionId) {
          const s = await api.getFeynmanSession(params.sessionId)
          if (cancelled) return
          setSessionId(s.id)
          setConversation(s.conversation || [])
          setTurnCount(s.turn_count || 0)
          setStatus(s.status)
          setAssessment(s.assessment)
          setTopic(s.topic_seed || '')
          setManualSubject(s.manual_subject || null)
          setManualKp(s.manual_knowledge_point || null)
          // max_turns 不在 detail 里 — 用合理默认
          setMaxTurns(4)
        } else {
          const r = await api.startFeynman({
            source_table: params.source_table,
            source_id: params.source_id,
          })
          if (cancelled) return
          setSessionId(r.session_id)
          setMaxTurns(r.max_turns || 4)
          setTopic(r.topic_seed || '')
          setConversation([
            {
              role: 'ai',
              content: r.opening_question,
              ts: new Date().toISOString(),
            },
          ])
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || String(e))
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 自动滚到底
  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true })
    })
  }, [conversation.length, assessment])

  const submitAnswer = useCallback(async () => {
    if (!sessionId) return
    const text = answer.trim()
    if (!text) {
      setError('写一两句你的讲解')
      return
    }
    setSubmitting(true)
    setError('')
    // 乐观追加
    setConversation((prev) => [
      ...prev,
      { role: 'student', content: text, ts: new Date().toISOString() },
    ])
    setAnswer('')
    try {
      const r = await api.feynmanTurn(sessionId, text)
      setTurnCount(r.turn_count)
      if (r.next_question) {
        setConversation((prev) => [
          ...prev,
          {
            role: 'ai',
            content: r.next_question!,
            ts: new Date().toISOString(),
          },
        ])
      }
      if (r.finished) {
        setStatus('finished')
        if (r.assessment) setAssessment(r.assessment)
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSubmitting(false)
    }
  }, [answer, sessionId])

  const finishNow = useCallback(() => {
    if (!sessionId) return
    Alert.alert('结束这次对话?', '会让 AI 现在就给你一个判断', [
      { text: '继续讲', style: 'cancel' },
      {
        text: '结束',
        onPress: async () => {
          setFinishing(true)
          setError('')
          try {
            const r = await api.feynmanFinish(sessionId)
            if (r.abandoned) {
              setStatus('abandoned')
            } else {
              setStatus('finished')
              if (r.assessment) setAssessment(r.assessment)
            }
          } catch (e: any) {
            setError(e?.message || String(e))
          } finally {
            setFinishing(false)
          }
        },
      },
    ])
  }, [sessionId])

  const restart = useCallback(async () => {
    setBootstrapping(true)
    setError('')
    setConversation([])
    setAssessment(null)
    setStatus('in_progress')
    setTurnCount(0)
    setAnswer('')
    try {
      const r = await api.startFeynman({
        source_table: params.source_table,
        source_id: params.source_id,
      })
      setSessionId(r.session_id)
      setMaxTurns(r.max_turns || 4)
      setTopic(r.topic_seed || '')
      setConversation([
        {
          role: 'ai',
          content: r.opening_question,
          ts: new Date().toISOString(),
        },
      ])
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setBootstrapping(false)
    }
  }, [params.source_table, params.source_id])

  const contentMaxStyle =
    isTablet && maxContent
      ? { maxWidth: maxContent, alignSelf: 'center' as const, width: '100%' as const }
      : undefined

  const finished = status === 'finished'
  const abandoned = status === 'abandoned'

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 80 : 0}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[
            styles.scroll,
            { paddingHorizontal: hPadding },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={contentMaxStyle}>
            {bootstrapping ? (
              <View style={styles.bootBox}>
                <ActivityIndicator color={colors.brand} />
                <Text style={styles.bootText}>
                  {params.sessionId ? '加载对话...' : 'AI 在想问什么...'}
                </Text>
              </View>
            ) : (
              <>
                {topic ? (
                  <Text style={styles.topicHint}>话题: {topic}</Text>
                ) : null}

                {!finished && !abandoned ? (
                  <Text style={styles.progressText}>
                    第 {Math.max(1, turnCount + (submitting ? 1 : 0))} 轮 / 最多{' '}
                    {maxTurns} 轮
                  </Text>
                ) : null}

                {/* 对话历史 */}
                {conversation.map((t, i) => (
                  <Bubble key={i} turn={t} />
                ))}

                {submitting ? (
                  <View style={[styles.bubble, styles.aiBubble]}>
                    <ActivityIndicator color="#7c3aed" />
                  </View>
                ) : null}

                {/* 结果态 */}
                {finished && assessment ? (
                  <AssessmentCard
                    assessment={assessment}
                    onRestart={restart}
                    onBack={() => navigation.goBack()}
                    manualSubject={manualSubject}
                    manualKp={manualKp}
                    onGoToInsights={() => navigation.navigate('Insights')}
                  />
                ) : null}

                {abandoned ? (
                  <View style={styles.abandonBox}>
                    <Text style={styles.abandonText}>
                      下次再来. 你随时可以教我.
                    </Text>
                    <View style={styles.endBtnRow}>
                      <Pressable onPress={restart} style={styles.endBtnPrimary}>
                        <Text style={styles.endBtnPrimaryText}>再来一次</Text>
                      </Pressable>
                      <Pressable
                        onPress={() => navigation.goBack()}
                        style={styles.endBtn}
                      >
                        <Text style={styles.endBtnText}>完成</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}

                {error ? <Text style={styles.errorText}>{error}</Text> : null}
              </>
            )}
          </View>
        </ScrollView>

        {/* 输入区 — 仅 in_progress 时显示 */}
        {!bootstrapping && !finished && !abandoned ? (
          <View
            style={[
              styles.inputBar,
              { paddingHorizontal: hPadding },
            ]}
          >
            <View style={contentMaxStyle}>
              <TextInput
                value={answer}
                onChangeText={setAnswer}
                placeholder={
                  conversation.length <= 1
                    ? '用你的话讲一遍 (没关系, 卡住也讲)'
                    : '继续讲...'
                }
                placeholderTextColor={colors.slate400}
                multiline
                style={styles.input}
                editable={!submitting && !finishing}
              />
              <View style={styles.actionRow}>
                <Pressable
                  onPress={submitAnswer}
                  disabled={submitting || finishing}
                  style={[
                    styles.sendBtn,
                    (submitting || finishing) && { opacity: 0.5 },
                  ]}
                >
                  <Text style={styles.sendBtnText}>
                    {submitting
                      ? '...'
                      : conversation.length <= 1
                      ? '回答'
                      : '继续讲'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={finishNow}
                  disabled={submitting || finishing}
                  style={[
                    styles.finishBtn,
                    (submitting || finishing) && { opacity: 0.5 },
                  ]}
                >
                  <Text style={styles.finishBtnText}>
                    {finishing ? '...' : '结束对话'}
                  </Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function Bubble({ turn }: { turn: FeynmanTurn }) {
  const isAi = turn.role === 'ai'
  return (
    <View
      style={[
        styles.bubbleRow,
        isAi ? styles.bubbleRowLeft : styles.bubbleRowRight,
      ]}
    >
      <View
        style={[
          styles.bubble,
          isAi ? styles.aiBubble : styles.studentBubble,
        ]}
      >
        <Text style={styles.roleLabel}>
          {isAi ? 'AI 同学' : '你'}
        </Text>
        <MathText
          text={turn.content}
          style={isAi ? styles.aiText : styles.studentText}
        />
      </View>
    </View>
  )
}

function AssessmentCard({
  assessment,
  onRestart,
  onBack,
  manualSubject,
  manualKp,
  onGoToInsights,
}: {
  assessment: FeynmanAssessment
  onRestart: () => void
  onBack: () => void
  manualSubject: string | null
  manualKp: string | null
  onGoToInsights: () => void
}) {
  const u = assessment.understood
  const pal =
    u === 'understood'
      ? {
          bg: '#f0fdf4',
          border: '#bbf7d0',
          color: '#15803d',
          title: '你讲清楚了 ✓',
          subtitle: '你刚证明了你真懂这个.',
        }
      : u === 'mechanical'
      ? {
          bg: '#fffbeb',
          border: '#fde68a',
          color: '#b45309',
          title: '步骤你能背, 但有些地方还没讲透',
          subtitle: '可以再练一道.',
        }
      : {
          bg: '#f1f5f9',
          border: '#cbd5e1',
          color: colors.slate700,
          title: '今天讲得有点乱',
          subtitle: '没关系, 知道哪里乱也是收获.',
        }

  return (
    <View
      style={[
        styles.assessCard,
        { backgroundColor: pal.bg, borderColor: pal.border },
      ]}
    >
      <Text style={[styles.assessTitle, { color: pal.color }]}>
        {pal.title}
      </Text>
      {assessment.topic ? (
        <Text style={styles.assessTopic}>话题: {assessment.topic}</Text>
      ) : null}
      <Text style={styles.assessSubtitle}>{pal.subtitle}</Text>

      {assessment.understood === 'understood' && manualSubject && manualKp ? (
        <Pressable onPress={onGoToInsights} style={styles.masteryRow}>
          <Text style={styles.masteryCheck}>✓</Text>
          <Text style={styles.masteryText}>
            已记入你的「
            <Text style={styles.masterySubject}>{manualSubject}</Text>
            」知识图谱 · {manualKp}
          </Text>
          <Text style={styles.masteryArrow}>去看 →</Text>
        </Pressable>
      ) : null}

      {assessment.weak_points && assessment.weak_points.length > 0 ? (
        <View style={styles.weakBox}>
          <Text style={styles.weakLabel}>
            {u === 'confused' ? '可以慢慢看看:' : '还可以再讲清楚的地方:'}
          </Text>
          {assessment.weak_points.map((w, i) => (
            <Text key={i} style={styles.weakItem}>
              · {w}
            </Text>
          ))}
        </View>
      ) : null}

      <View style={styles.endBtnRow}>
        <Pressable onPress={onRestart} style={styles.endBtnPrimary}>
          <Text style={styles.endBtnPrimaryText}>再来一次</Text>
        </Pressable>
        <Pressable onPress={onBack} style={styles.endBtn}>
          <Text style={styles.endBtnText}>回到原页面</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 24, gap: 4 },

  bootBox: { paddingVertical: 60, alignItems: 'center', gap: 12 },
  bootText: { fontSize: 13, color: colors.slate500 },

  topicHint: {
    fontSize: 12,
    color: colors.slate500,
    marginBottom: 4,
  },
  progressText: {
    fontSize: 11,
    color: colors.slate400,
    marginBottom: 8,
  },

  bubbleRow: {
    flexDirection: 'row',
    marginVertical: 4,
  },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '85%',
    padding: 10,
    borderRadius: 12,
    gap: 4,
  },
  aiBubble: {
    backgroundColor: '#f3e8ff',
    borderTopLeftRadius: 2,
  },
  studentBubble: {
    backgroundColor: '#dbeafe',
    borderTopRightRadius: 2,
  },
  roleLabel: {
    fontSize: 10,
    color: colors.slate500,
    fontWeight: '600',
  },
  aiText: { fontSize: 14, color: '#581c87', lineHeight: 21 },
  studentText: { fontSize: 14, color: '#1e3a8a', lineHeight: 21 },

  errorText: {
    color: colors.red500,
    fontSize: 13,
    marginTop: 8,
  },

  inputBar: {
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 8,
    paddingBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: colors.slate900,
    minHeight: 64,
    textAlignVertical: 'top',
    backgroundColor: '#fff',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  sendBtn: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 6,
  },
  sendBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  finishBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  finishBtnText: { color: colors.slate600, fontSize: 13 },

  assessCard: {
    marginTop: 16,
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
  },
  assessTitle: { fontSize: 17, fontWeight: '700' },
  assessTopic: { fontSize: 12, color: colors.slate500 },
  assessSubtitle: { fontSize: 13, color: colors.slate700, lineHeight: 20 },
  masteryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderColor: '#bbf7d0',
  },
  masteryCheck: { fontSize: 14, color: '#15803d', fontWeight: '700' },
  masteryText: { flex: 1, fontSize: 12, color: '#166534', lineHeight: 17 },
  masterySubject: { fontWeight: '700' },
  masteryArrow: { fontSize: 12, color: '#15803d', fontWeight: '600' },
  weakBox: {
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.08)',
    gap: 4,
  },
  weakLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate700,
  },
  weakItem: {
    fontSize: 13,
    color: colors.slate700,
    lineHeight: 20,
  },

  abandonBox: {
    marginTop: 16,
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: colors.divider,
    gap: 12,
  },
  abandonText: { fontSize: 14, color: colors.slate700, lineHeight: 21 },

  endBtnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  endBtnPrimary: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
  },
  endBtnPrimaryText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  endBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: '#fff',
  },
  endBtnText: { fontSize: 13, color: colors.slate700 },
})
