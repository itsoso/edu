/**
 * InsightsScreen — "看见自己" (P1 元认知镜子).
 *
 * 这是 AI 对学习者的观察, 不是评价. 用户可以看, 可以改, 可以删.
 * 家长 (role === 'parent') 视图为只读.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  AgentStrategies,
  api,
  ErrorPattern,
  KnowledgePoint,
  MyProfile,
  MyProfileCorrection,
  MyProfileHistoryEntry,
  MyProfileResponse,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

const WELCOME_KEY = 'insights.welcome.dismissed.v1'

const HINT_PATTERN_LABEL: Record<string, string> = {
  tries_first: '先自己想再看提示',
  looks_first: '先看提示再尝试',
  rarely_used: '很少用提示',
}

const TREND_LABEL: Record<string, string> = {
  new: '新出现',
  rising: '在加重',
  weakening: '在减弱',
  stable: '稳定',
  falling: '在减弱',
}

function trendArrow(t?: string): string {
  if (t === 'rising') return '↑'
  if (t === 'falling' || t === 'weakening') return '↓'
  return '→'
}

function fmtDate(s?: string | null): string {
  if (!s) return '-'
  try {
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return s
  }
}

function masteryColor(m: number): string {
  // 0 → slate divider, 1 → brand
  if (m <= 0) return colors.divider
  if (m >= 1) return colors.brand
  // mix between #cbd5e1 and brand
  return colors.brand
}

function Bar({ value, color }: { value: number; color?: string }) {
  const v = Math.max(0, Math.min(1, value || 0))
  return (
    <View style={styles.barTrack}>
      <View
        style={[
          styles.barFill,
          { width: `${v * 100}%`, backgroundColor: color || colors.brand, opacity: 0.4 + v * 0.6 },
        ]}
      />
    </View>
  )
}

export default function InsightsScreen() {
  const { user } = useAuth()
  const { hPadding } = useResponsive()
  const isParent = user?.role === 'parent'

  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const [data, setData] = useState<MyProfileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [err, setErr] = useState('')

  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({})
  const [expandedKp, setExpandedKp] = useState<Record<string, boolean>>({})

  const [history, setHistory] = useState<MyProfileHistoryEntry[] | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [versionCache, setVersionCache] = useState<Record<number, MyProfile>>({})
  const [openVersion, setOpenVersion] = useState<number | null>(null)

  const [corrections, setCorrections] = useState<MyProfileCorrection[] | null>(null)
  const [correctionsOpen, setCorrectionsOpen] = useState(false)

  const [rebuilding, setRebuilding] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const res = await api.getMyProfile()
      setData(res)
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }, [])

  useEffect(() => {
    AsyncStorage.getItem(WELCOME_KEY).then((v) => {
      if (!v) setWelcomeOpen(true)
    })
    setLoading(true)
    load().finally(() => setLoading(false))
  }, [load])

  async function dismissWelcome() {
    setWelcomeOpen(false)
    try {
      await AsyncStorage.setItem(WELCOME_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function onRebuild() {
    if (rebuilding) return
    setRebuilding(true)
    try {
      await api.rebuildMyProfile()
      await load()
    } catch (e: any) {
      Alert.alert('重建失败', e?.message || String(e))
    } finally {
      setRebuilding(false)
    }
  }

  async function onWipe() {
    Alert.alert(
      '全部清除从 0 开始?',
      '这会删除当前所有 AI 对你的观察记录, 不影响你的错题/打卡/作文等原始数据. 不可撤销.',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '确认清除',
          style: 'destructive',
          onPress: () => {
            Alert.alert('再次确认', '真的从 0 开始?', [
              { text: '取消', style: 'cancel' },
              {
                text: '确认',
                style: 'destructive',
                onPress: async () => {
                  try {
                    await api.wipeMyProfile()
                    await load()
                  } catch (e: any) {
                    Alert.alert('清除失败', e?.message || String(e))
                  }
                },
              },
            ])
          },
        },
      ]
    )
  }

  async function lockMastery(subject: string, kp: string) {
    try {
      await api.correctMyProfile({
        field_path: `knowledge.${subject}.${kp}.mastery`,
        action: 'lock_value',
        value: 1.0,
      })
      await load()
    } catch (e: any) {
      Alert.alert('提交失败', e?.message || String(e))
    }
  }

  async function dismissPattern(p: ErrorPattern) {
    Alert.prompt?.(
      '我不同意这个观察',
      '可以选填一个理由 (帮 AI 学得更准, 不是必填)',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '提交',
          onPress: async (reason?: string) => {
            try {
              await api.correctMyProfile({
                field_path: `error_patterns.${p.id}`,
                action: 'dismiss',
                reason: reason || undefined,
              })
              await load()
            } catch (e: any) {
              Alert.alert('提交失败', e?.message || String(e))
            }
          },
        },
      ],
      'plain-text'
    )
    if (!Alert.prompt) {
      // Android 没有 Alert.prompt, 直接 dismiss 不带 reason
      try {
        await api.correctMyProfile({
          field_path: `error_patterns.${p.id}`,
          action: 'dismiss',
        })
        await load()
      } catch (e: any) {
        Alert.alert('提交失败', e?.message || String(e))
      }
    }
  }

  async function ensureHistory() {
    if (history) return
    try {
      const list = await api.getMyProfileHistory()
      setHistory(list)
    } catch (e: any) {
      Alert.alert('加载失败', e?.message || String(e))
    }
  }

  async function toggleVersion(v: number) {
    if (openVersion === v) {
      setOpenVersion(null)
      return
    }
    setOpenVersion(v)
    if (!versionCache[v]) {
      try {
        const r = await api.getMyProfileVersion(v)
        setVersionCache((prev) => ({ ...prev, [v]: r.profile }))
      } catch (e: any) {
        Alert.alert('加载失败', e?.message || String(e))
      }
    }
  }

  async function ensureCorrections() {
    try {
      const list = await api.listMyCorrections()
      setCorrections(list)
    } catch (e: any) {
      Alert.alert('加载失败', e?.message || String(e))
    }
  }

  async function undoCorrection(id: number) {
    try {
      await api.deleteMyCorrection(id)
      await ensureCorrections()
      await load()
    } catch (e: any) {
      Alert.alert('撤销失败', e?.message || String(e))
    }
  }

  const profile = data?.profile

  const knowledgeSubjects = useMemo(() => {
    if (!profile?.knowledge) return []
    return Object.keys(profile.knowledge)
  }, [profile])

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>看见自己</Text>
          <Text style={styles.subtitle}>
            {isParent
              ? '(只读, 这是 AI 的观察, 不是定论)'
              : 'AI 对你的观察 — 你可以看, 可以改, 可以删'}
          </Text>
        </View>

        {/* a. Welcome 卡 */}
        {welcomeOpen && (
          <View style={styles.welcomeCard}>
            <Text style={styles.welcomeText}>
              这份画像是 AI 对你的观察, 不是评价. 你可以看, 可以改, 可以删. 它的目的是帮你看见自己, 不是给你打分.
            </Text>
            <Pressable onPress={dismissWelcome} style={styles.welcomeBtn}>
              <Text style={styles.welcomeBtnText}>我知道了</Text>
            </Pressable>
          </View>
        )}

        {err ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{err}</Text>
          </View>
        ) : null}

        {!data?.exists ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>还没有画像</Text>
            <Text style={styles.emptyHint}>
              当你积累了一些错题、打卡和练习, AI 会从中观察出一份你的"学习侧写". 也可以现在手动触发一次.
            </Text>
            {!isParent && (
              <Pressable
                onPress={onRebuild}
                disabled={rebuilding}
                style={[styles.primaryBtn, rebuilding && { opacity: 0.5 }]}
              >
                <Text style={styles.primaryBtnText}>
                  {rebuilding ? '生成中...' : '生成我的画像'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            {/* b. 本期总结 */}
            <View style={styles.card}>
              <Text style={styles.cardLabel}>本期总结</Text>
              {data.source_summary ? (
                <Text style={styles.summaryBig}>{data.source_summary}</Text>
              ) : (
                <Text style={styles.summaryBig}>
                  {profile?.self_narrative || '暂无总结'}
                </Text>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.metaText}>版本 v{data.version ?? '-'}</Text>
                <Text style={styles.metaText}>
                  · {fmtDate(data.computed_at || profile?.computed_at)}
                </Text>
              </View>
            </View>

            {/* c. 知识地图 */}
            {knowledgeSubjects.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>知识地图</Text>
                {knowledgeSubjects.map((subject) => {
                  const open = expandedSubjects[subject] ?? false
                  const kps = profile?.knowledge?.[subject] || {}
                  const kpKeys = Object.keys(kps)
                  return (
                    <View key={subject} style={styles.subjectBlock}>
                      <Pressable
                        onPress={() =>
                          setExpandedSubjects((p) => ({ ...p, [subject]: !open }))
                        }
                        style={styles.subjectHead}
                      >
                        <Text style={styles.subjectName}>{subject}</Text>
                        <Text style={styles.subjectMeta}>
                          {kpKeys.length} 个知识点 {open ? '▾' : '▸'}
                        </Text>
                      </Pressable>
                      {open && (
                        <View style={{ gap: 10, marginTop: 8 }}>
                          {kpKeys.map((kp) => {
                            const point = kps[kp] as KnowledgePoint
                            const kpId = `${subject}::${kp}`
                            const showEvidence = expandedKp[kpId] ?? false
                            return (
                              <View key={kp} style={styles.kpRow}>
                                <Pressable
                                  onPress={() =>
                                    setExpandedKp((p) => ({
                                      ...p,
                                      [kpId]: !showEvidence,
                                    }))
                                  }
                                  style={{ flex: 1 }}
                                >
                                  <Text style={styles.kpName}>{kp}</Text>
                                  <Bar
                                    value={point.mastery}
                                    color={masteryColor(point.mastery)}
                                  />
                                  <Text style={styles.kpMeta}>
                                    上次 {fmtDate(point.last_practiced_at)} · 练习{' '}
                                    {point.practice_count ?? 0} 次
                                  </Text>
                                  {showEvidence && (
                                    <Text style={styles.kpEvidence}>
                                      做对 {point.correct_count ?? 0} · 做错{' '}
                                      {point.wrong_count ?? 0} · 信心{' '}
                                      {((point.confidence ?? 0) * 100).toFixed(0)}%
                                    </Text>
                                  )}
                                </Pressable>
                                {!isParent && (
                                  <Pressable
                                    onPress={() => lockMastery(subject, kp)}
                                    style={styles.smallBtn}
                                  >
                                    <Text style={styles.smallBtnText}>我已经会了</Text>
                                  </Pressable>
                                )}
                              </View>
                            )
                          })}
                        </View>
                      )}
                    </View>
                  )
                })}
              </View>
            )}

            {/* d. 我的"小坑" */}
            {profile?.error_patterns && profile.error_patterns.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>我的"小坑"</Text>
                <View style={{ gap: 12, marginTop: 4 }}>
                  {profile.error_patterns.map((p) => (
                    <View key={String(p.id)} style={styles.patternCard}>
                      <View style={styles.patternHead}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.patternDesc}>{p.description}</Text>
                          <View style={styles.patternMetaRow}>
                            <View style={styles.subjectBadge}>
                              <Text style={styles.subjectBadgeText}>{p.subject}</Text>
                            </View>
                            <Text style={styles.patternMeta}>
                              出现 {p.occurrences ?? 0} 次
                            </Text>
                            {p.trend ? (
                              <Text style={styles.patternMeta}>
                                {trendArrow(p.trend)} {TREND_LABEL[p.trend] || p.trend}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                        {!isParent && (
                          <Pressable
                            onPress={() => dismissPattern(p)}
                            style={styles.outlineBtn}
                          >
                            <Text style={styles.outlineBtnText}>我不同意</Text>
                          </Pressable>
                        )}
                      </View>
                      {typeof p.confidence === 'number' && (
                        <View style={{ marginTop: 8 }}>
                          <Text style={styles.confLabel}>
                            信心 {(p.confidence * 100).toFixed(0)}%
                          </Text>
                          <Bar value={p.confidence} />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* e. 节奏与状态 */}
            {(profile?.cognitive_style || profile?.engagement) && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>节奏与状态</Text>
                <View style={{ gap: 12, marginTop: 4 }}>
                  <Stat
                    label="状态最好的时段"
                    value={profile?.cognitive_style?.best_time_window || '-'}
                  />
                  <Stat
                    label="使用提示的方式"
                    value={
                      HINT_PATTERN_LABEL[
                        profile?.cognitive_style?.hint_usage_pattern || ''
                      ] ||
                      profile?.cognitive_style?.hint_usage_pattern ||
                      '-'
                    }
                  />
                  <Stat
                    label="一次专注时长"
                    value={
                      profile?.cognitive_style?.ideal_session_length_min
                        ? `约 ${profile.cognitive_style.ideal_session_length_min} 分钟`
                        : '-'
                    }
                  />
                  <View>
                    <View style={styles.statRow}>
                      <Text style={styles.statLabel}>近 7 天投入</Text>
                      <Text style={styles.statValue}>
                        {trendArrow(profile?.engagement?.trend)}{' '}
                        {((profile?.engagement?.score_7d ?? 0) * 100).toFixed(0)}
                      </Text>
                    </View>
                    <Bar value={profile?.engagement?.score_7d ?? 0} />
                  </View>
                </View>
              </View>
            )}

            {/* e2. AI 学到了什么 (P2.5 procedural memory) */}
            <AgentStrategiesCard strategies={profile?.agent_strategies} />

            {/* f. 历史画像 */}
            <View style={styles.card}>
              <Pressable
                onPress={() => {
                  const next = !historyOpen
                  setHistoryOpen(next)
                  if (next) ensureHistory()
                }}
                style={styles.collapseHead}
              >
                <Text style={styles.cardLabel}>历史画像</Text>
                <Text style={styles.metaText}>{historyOpen ? '▾' : '▸'}</Text>
              </Pressable>
              {historyOpen && (
                <View style={{ gap: 8, marginTop: 8 }}>
                  {history === null ? (
                    <ActivityIndicator color={colors.brand} />
                  ) : history.length === 0 ? (
                    <Text style={styles.metaText}>暂无历史版本</Text>
                  ) : (
                    history.map((h) => {
                      const isOpen = openVersion === h.version
                      const v = versionCache[h.version]
                      return (
                        <View key={h.version} style={styles.timelineRow}>
                          <Pressable
                            onPress={() => toggleVersion(h.version)}
                            style={styles.timelineHead}
                          >
                            <Text style={styles.timelineVer}>v{h.version}</Text>
                            <Text style={styles.timelineDate}>
                              {fmtDate(h.created_at)}
                            </Text>
                            {h.is_monthly_snapshot ? (
                              <Text style={styles.snapBadge}>月度</Text>
                            ) : null}
                          </Pressable>
                          {h.source_summary ? (
                            <Text style={styles.timelineSummary} numberOfLines={isOpen ? undefined : 2}>
                              {h.source_summary}
                            </Text>
                          ) : null}
                          {isOpen && v ? (
                            <View style={styles.versionBox}>
                              <Text style={styles.versionLabel}>那时的小结</Text>
                              <Text style={styles.versionText}>
                                {v.self_narrative || '(无)'}
                              </Text>
                            </View>
                          ) : null}
                          {isOpen && !v ? (
                            <ActivityIndicator color={colors.brand} />
                          ) : null}
                        </View>
                      )
                    })
                  )}
                </View>
              )}
            </View>

            {/* g. 底部操作 */}
            {!isParent && (
              <View style={styles.card}>
                <Text style={styles.cardLabel}>操作</Text>
                <Pressable
                  onPress={onRebuild}
                  disabled={rebuilding}
                  style={[styles.primaryBtn, rebuilding && { opacity: 0.5 }, { marginTop: 8 }]}
                >
                  <Text style={styles.primaryBtnText}>
                    {rebuilding ? '重建中...' : '立即重建画像'}
                  </Text>
                </Pressable>

                <Pressable
                  onPress={() => {
                    const next = !correctionsOpen
                    setCorrectionsOpen(next)
                    if (next) ensureCorrections()
                  }}
                  style={[styles.collapseHead, { marginTop: 12 }]}
                >
                  <Text style={styles.outlineBtnText}>
                    查看我的修改记录 {correctionsOpen ? '▾' : '▸'}
                  </Text>
                </Pressable>
                {correctionsOpen && (
                  <View style={{ gap: 8, marginTop: 8 }}>
                    {corrections === null ? (
                      <ActivityIndicator color={colors.brand} />
                    ) : corrections.length === 0 ? (
                      <Text style={styles.metaText}>暂无修改</Text>
                    ) : (
                      corrections.map((c) => (
                        <View key={c.id} style={styles.correctionRow}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.correctionPath}>{c.field_path}</Text>
                            <Text style={styles.correctionMeta}>
                              {c.action} · {fmtDate(c.created_at)}
                              {c.reason ? ` · ${c.reason}` : ''}
                            </Text>
                          </View>
                          <Pressable
                            onPress={() => undoCorrection(c.id)}
                            style={styles.smallBtn}
                          >
                            <Text style={styles.smallBtnText}>撤销</Text>
                          </Pressable>
                        </View>
                      ))
                    )}
                  </View>
                )}

                <Pressable
                  onPress={onWipe}
                  style={[styles.dangerBtn, { marginTop: 16 }]}
                >
                  <Text style={styles.dangerBtnText}>全部清除从 0 开始</Text>
                </Pressable>
                <Text style={styles.dangerHint}>
                  仅清除 AI 对你的观察 (画像), 不删除原始数据 (错题/打卡/作文等).
                </Text>
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  )
}

const TUTOR_KIND_LABEL: Record<string, string> = {
  pattern_drill: '针对你的弱项',
  knowledge_refresh: '复习薄弱知识点',
  goal_followup: '朝周目标走',
  subject_review: '整科补漏',
}

const CURATOR_KIND_LABEL: Record<string, string> = {
  review_mistake: '复习错题',
  pattern_drill: '针对你的弱项',
  goal_aligned: '对齐周目标',
  challenge: '挑战难题',
  rest_recommended: '建议休息',
}

function rateSuffix(rate: number, sample: number): { suffix: string; color: string } {
  if (sample < 3) return { suffix: '', color: colors.slate500 }
  if (rate >= 0.7) return { suffix: ' ✓ (她爱)', color: colors.green600 }
  if (rate <= 0.3) return { suffix: ' △ (她不爱)', color: colors.slate400 }
  return { suffix: '', color: colors.slate700 }
}

function fmtHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}

function AgentStrategiesCard({ strategies }: { strategies?: AgentStrategies }) {
  const tutorEntries = strategies ? Object.entries(strategies.tutor || {}) : []
  const curatorEntries = strategies ? Object.entries(strategies.curator || {}) : []
  const feynman = strategies?.feynman
  const guardian = strategies?.guardian
  const hours = strategies?.preferred_action_hours || []

  const allEmpty =
    tutorEntries.length === 0 &&
    curatorEntries.length === 0 &&
    !(feynman && (feynman.sample_size ?? 0) > 0) &&
    !(guardian && (guardian.sample_size ?? 0) > 0) &&
    hours.length === 0

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>🧠 AI 学到了什么 (基于你的反馈)</Text>
      <Text style={styles.agentHint}>
        你接受/跳过的每条建议都让系统更准. 每条至少要 3 次反馈才算可信.
      </Text>

      {allEmpty ? (
        <Text style={[styles.agentHint, { marginTop: 10 }]}>
          AI 还没学到什么 — 等你用过几次 agent 建议后会出现这里. 你的反馈会让下次的建议更贴你.
        </Text>
      ) : (
        <View style={{ gap: 12, marginTop: 8 }}>
          {tutorEntries.length > 0 && (
            <View style={styles.agentSubCard}>
              <Text style={styles.agentSubTitle}>Tutor (主动建议)</Text>
              {tutorEntries.map(([kind, s]) => {
                const label = TUTOR_KIND_LABEL[kind] || kind
                const meta = rateSuffix(s.accept_rate, s.sample_size)
                return (
                  <Text key={kind} style={[styles.agentLine, { color: meta.color }]}>
                    {label} · 接受 {(s.accept_rate * 100).toFixed(0)}% ({s.sample_size} 次)
                    {meta.suffix}
                  </Text>
                )
              })}
            </View>
          )}

          {curatorEntries.length > 0 && (
            <View style={styles.agentSubCard}>
              <Text style={styles.agentSubTitle}>Curator (今天值得做的)</Text>
              {curatorEntries.map(([kind, s]) => {
                const label = CURATOR_KIND_LABEL[kind] || kind
                const meta = rateSuffix(s.completion_rate, s.sample_size)
                return (
                  <Text key={kind} style={[styles.agentLine, { color: meta.color }]}>
                    {label} · 完成 {(s.completion_rate * 100).toFixed(0)}% ({s.sample_size} 次)
                    {meta.suffix}
                  </Text>
                )
              })}
            </View>
          )}

          {feynman && (feynman.sample_size ?? 0) > 0 && (
            <View style={styles.agentSubCard}>
              <Text style={styles.agentSubTitle}>Feynman (教 AI)</Text>
              <Text style={styles.agentLine}>
                完成率 {((feynman.completion_rate ?? 0) * 100).toFixed(0)}% (
                {feynman.sample_size} 次)
              </Text>
            </View>
          )}

          {guardian && (guardian.sample_size ?? 0) > 0 && (
            <View style={styles.agentSubCard}>
              <Text style={styles.agentSubTitle}>Guardian (异常提醒)</Text>
              <Text style={styles.agentLine}>
                确认率 {((guardian.ack_rate ?? 0) * 100).toFixed(0)}% (
                {guardian.sample_size} 次)
              </Text>
            </View>
          )}

          {hours.length > 0 && (
            <Text style={styles.agentFooter}>
              你最常接受建议的时段: {hours.map(fmtHour).join(', ')}
            </Text>
          )}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48, gap: 14 },

  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  loadingText: { color: colors.slate500, fontSize: 13 },

  header: { marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },

  welcomeCard: {
    backgroundColor: '#f1f5f9',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  welcomeText: {
    fontSize: 14,
    color: colors.slate700,
    lineHeight: 22,
  },
  welcomeBtn: {
    alignSelf: 'flex-end',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.border,
  },
  welcomeBtnText: { fontSize: 13, color: colors.slate700 },

  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 6,
    padding: 12,
  },
  errorText: { color: '#dc2626', fontSize: 13 },

  emptyBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
  },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.slate900, marginBottom: 8 },
  emptyHint: {
    fontSize: 13,
    color: colors.slate500,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
  },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 16,
  },
  cardLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate500,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  summaryBig: {
    fontSize: 18,
    color: colors.slate800,
    lineHeight: 28,
  },
  metaRow: { flexDirection: 'row', marginTop: 10, gap: 4 },
  metaText: { fontSize: 12, color: colors.slate500 },

  subjectBlock: {
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  subjectHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  subjectName: { fontSize: 15, fontWeight: '600', color: colors.slate800 },
  subjectMeta: { fontSize: 12, color: colors.slate500 },

  kpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  kpName: { fontSize: 14, color: colors.slate800, marginBottom: 4 },
  kpMeta: { fontSize: 11, color: colors.slate500, marginTop: 4 },
  kpEvidence: { fontSize: 11, color: colors.slate600, marginTop: 4 },

  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.divider,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 3 },

  smallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  smallBtnText: { fontSize: 12, color: colors.slate700 },

  patternCard: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 12,
  },
  patternHead: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  patternDesc: { fontSize: 15, color: colors.slate800, lineHeight: 22 },
  patternMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 6,
    alignItems: 'center',
  },
  subjectBadge: {
    backgroundColor: colors.brandLight,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  subjectBadgeText: { fontSize: 11, color: colors.brandHover, fontWeight: '600' },
  patternMeta: { fontSize: 11, color: colors.slate500 },
  confLabel: { fontSize: 11, color: colors.slate500, marginBottom: 4 },

  outlineBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  outlineBtnText: { fontSize: 12, color: colors.slate700 },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  statLabel: { fontSize: 13, color: colors.slate600 },
  statValue: { fontSize: 14, color: colors.slate800, fontWeight: '500' },

  collapseHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  timelineRow: {
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  timelineHead: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  timelineVer: { fontSize: 13, fontWeight: '600', color: colors.slate800 },
  timelineDate: { fontSize: 12, color: colors.slate500 },
  snapBadge: {
    fontSize: 10,
    color: colors.brandHover,
    backgroundColor: colors.brandLight,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  timelineSummary: { fontSize: 12, color: colors.slate600, marginTop: 4, lineHeight: 18 },
  versionBox: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#f8fafc',
    borderRadius: 6,
  },
  versionLabel: { fontSize: 11, color: colors.slate500, marginBottom: 4 },
  versionText: { fontSize: 13, color: colors.slate700, lineHeight: 20 },

  correctionRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    paddingVertical: 6,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  correctionPath: { fontSize: 12, color: colors.slate700, fontFamily: 'Menlo' },
  correctionMeta: { fontSize: 11, color: colors.slate500, marginTop: 2 },

  primaryBtn: {
    backgroundColor: colors.brand,
    paddingVertical: 10,
    borderRadius: 6,
    alignItems: 'center',
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  dangerBtn: {
    paddingVertical: 10,
    borderRadius: 6,
    backgroundColor: '#dc2626',
    alignItems: 'center',
  },
  dangerBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  dangerHint: { fontSize: 11, color: colors.slate500, marginTop: 6, textAlign: 'center' },

  agentHint: { fontSize: 12, color: colors.slate500, lineHeight: 18 },
  agentSubCard: {
    backgroundColor: '#fafafa',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 10,
    gap: 4,
  },
  agentSubTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate700,
    marginBottom: 4,
  },
  agentLine: { fontSize: 13, color: colors.slate700, lineHeight: 20 },
  agentFooter: { fontSize: 12, color: colors.slate600, marginTop: 4 },
})
