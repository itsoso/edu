/**
 * SettingsScreen — 账号设置.
 * 对齐 web 的 frontend/src/pages/Settings.tsx.
 */
import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Switch,
  TextInput,
  Modal,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { api, BoundStudent, ProfileSettings, AgentAction } from '../lib/api'
import { useAuth } from '../lib/auth'
import { signals } from '../lib/signals'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

const SIGNAL_TYPES_ZH: { type: string; label: string }[] = [
  { type: 'session.start', label: '会话开始 (打开 app)' },
  { type: 'session.end', label: '会话结束 (退到后台)' },
  { type: 'task.checkin.toggle', label: '任务打卡或取消' },
  { type: 'task.override.skip', label: '本周跳过某个任务' },
  { type: 'task.override.replace', label: '把某个任务替换成自己的版本' },
  { type: 'weekly_goal.set', label: '设定本周目标' },
  { type: 'mistake.create', label: '新增错题' },
  { type: 'mistake.view_detail', label: '查看错题详情' },
  { type: 'mistake.mark_mastered', label: '标记错题为已掌握' },
  { type: 'practice.item.start', label: '开始一道训练题' },
  { type: 'practice.item.input_pause', label: '训练题作答中长时间停顿' },
  { type: 'practice.item.hint_used', label: '查看训练题思路' },
  { type: 'practice.item.submit', label: '提交训练题作答' },
  { type: 'practice.item.skip', label: '离开未完成的训练题' },
  { type: 'essay.create', label: '上传或粘贴作文' },
  { type: 'journal.write', label: '写日记 (只记字数, 不记内容)' },
]

type LlmUsage = {
  recent_7d: {
    date: string
    calls: number
    prompt_chars: number
    response_chars: number
    avg_latency_ms: number
  }[]
  by_endpoint: {
    endpoint: string
    calls: number
    avg_latency_ms: number
    total_chars: number
  }[]
  totals: {
    calls: number
    ok: number
    errors: number
    total_prompt_chars: number
    total_response_chars: number
  }
}

type LlmStatus = { configured: boolean; model: string }

type NavProp = NativeStackNavigationProp<Record<string, undefined>>

export default function SettingsScreen() {
  const { user, logout } = useAuth()
  const { hPadding } = useResponsive()
  const navigation = useNavigation<NavProp>()
  const [usage, setUsage] = useState<LlmUsage | null>(null)
  const [status, setStatus] = useState<LlmStatus | null>(null)
  const [bound, setBound] = useState<BoundStudent | null>(null)

  const [confirming, setConfirming] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // 数据收集 / 画像 设置
  const [profileSettings, setProfileSettings] =
    useState<ProfileSettings | null>(null)
  const [signalTypesOpen, setSignalTypesOpen] = useState(false)
  const [wiping, setWiping] = useState(false)

  // AI 建议
  const [snoozeBusy, setSnoozeBusy] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actions, setActions] = useState<AgentAction[] | null>(null)
  const [actionsLoading, setActionsLoading] = useState(false)

  useEffect(() => {
    api.llmUsage().then(setUsage).catch(() => {})
    api.llmStatus().then(setStatus).catch(() => {})
    api
      .me()
      .then((r) => setBound(r.bound_student ?? null))
      .catch(() => {})
    api
      .getProfileSettings()
      .then((s) => {
        setProfileSettings(s)
        signals.setEnabled(!!s.signals_enabled)
      })
      .catch(() => {})
  }, [])

  async function updateSetting(patch: Partial<ProfileSettings>) {
    if (!profileSettings) return
    const next = { ...profileSettings, ...patch }
    setProfileSettings(next) // 乐观更新
    try {
      const saved = await api.updateProfileSettings(patch)
      setProfileSettings(saved)
      if (typeof patch.signals_enabled === 'boolean') {
        signals.setEnabled(patch.signals_enabled)
      }
    } catch (e: any) {
      setProfileSettings(profileSettings) // 回滚
      Alert.alert('保存失败', String(e?.message || e))
    }
  }

  async function doSnooze(days: number) {
    if (snoozeBusy) return
    setSnoozeBusy(true)
    try {
      const r = await api.snoozeAgent(days)
      setProfileSettings((prev) =>
        prev ? { ...prev, snoozed_until: r.snoozed_until } : prev
      )
    } catch (e: any) {
      Alert.alert('操作失败', String(e?.message || e))
    } finally {
      setSnoozeBusy(false)
    }
  }

  async function toggleActionsHistory() {
    const next = !actionsOpen
    setActionsOpen(next)
    if (next && actions === null) {
      setActionsLoading(true)
      try {
        const list = await api.listAgentActions()
        setActions(list || [])
      } catch {
        setActions([])
      } finally {
        setActionsLoading(false)
      }
    }
  }

  function confirmWipeSignals() {
    Alert.alert(
      '清除所有行为数据?',
      '将永久删除我们记录的你的所有行为信号. 此操作不可恢复.',
      [
        { text: '取消', style: 'cancel' },
        {
          text: '清除',
          style: 'destructive',
          onPress: async () => {
            setWiping(true)
            try {
              await api.wipeMySignals()
              Alert.alert('已清除', '你的行为数据已全部删除')
            } catch (e: any) {
              Alert.alert('清除失败', String(e?.message || e))
            } finally {
              setWiping(false)
            }
          },
        },
      ]
    )
  }

  async function handleLogout() {
    Alert.alert('确认退出?', undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '退出',
        style: 'destructive',
        onPress: async () => {
          await logout()
        },
      },
    ])
  }

  async function handleDelete() {
    if (!pw) {
      setErr('请输入密码二次确认')
      return
    }
    setBusy(true)
    setErr('')
    try {
      await api.deleteMe(pw)
      await logout()
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.includes('wrong_password')) setErr('密码不正确')
      else setErr(msg)
      setBusy(false)
    }
  }

  function cancelDelete() {
    setConfirming(false)
    setPw('')
    setErr('')
    setBusy(false)
  }

  const charsK = usage
    ? (
        (usage.totals.total_prompt_chars + usage.totals.total_response_chars) /
        1000
      ).toFixed(1)
    : '0'

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}>
        <View style={styles.header}>
          <Text style={styles.title}>账号设置</Text>
          <Text style={styles.subtitle}>管理你的账号与数据</Text>
        </View>

        {/* 账号信息 */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>账号信息</Text>
          <View style={{ gap: 4 }}>
            <Text style={styles.row}>
              用户名: <Text style={styles.mono}>{user?.username}</Text>
            </Text>
            <Text style={styles.row}>昵称: {user?.display_name}</Text>
            <Text style={styles.row}>
              角色: {user?.role === 'student' ? '🎓 学生' : '👨‍👩‍👧 家长'}
            </Text>
            {user?.stage ? (
              <Text style={styles.row}>阶段: {user.stage}</Text>
            ) : null}
            {user?.join_code ? (
              <View>
                <Text style={styles.row}>
                  绑定码:{' '}
                  <Text style={styles.joinCode}>{user.join_code}</Text>
                </Text>
                <Text style={styles.hint}>(家长注册时需要这个码)</Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* 绑定的学生 (家长) */}
        {user?.role === 'parent' && bound ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>绑定的学生</Text>
            <Text style={styles.row}>
              {bound.display_name}
              {bound.stage ? ` · ${bound.stage}` : ''}
            </Text>
          </View>
        ) : null}

        {/* LLM 状态 */}
        {status ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI 服务</Text>
            <Text style={styles.row}>
              状态: {status.configured ? '✅ 已配置' : '⚠️ 未配置'}
            </Text>
            <Text style={styles.row}>模型: {status.model || '-'}</Text>
          </View>
        ) : null}

        {/* AI 用量 */}
        {usage && usage.totals.calls > 0 ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI 用量</Text>
            <View style={styles.statsRow}>
              <View style={styles.statBox}>
                <Text style={styles.statNum}>{usage.totals.calls}</Text>
                <Text style={styles.statLabel}>总调用</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: colors.green600 }]}>
                  {usage.totals.ok}
                </Text>
                <Text style={styles.statLabel}>成功</Text>
              </View>
              <View style={styles.statBox}>
                <Text style={[styles.statNum, { color: colors.red500 }]}>
                  {usage.totals.errors}
                </Text>
                <Text style={styles.statLabel}>失败</Text>
              </View>
            </View>

            {usage.by_endpoint.length > 0 ? (
              <View style={styles.endpointWrap}>
                <Text style={styles.endpointTitle}>按端点</Text>
                {usage.by_endpoint.slice(0, 5).map((e) => (
                  <View key={e.endpoint} style={styles.endpointRow}>
                    <Text
                      style={styles.endpointName}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {e.endpoint}
                    </Text>
                    <Text style={styles.endpointMeta}>
                      {e.calls} 次 · 平均{' '}
                      {Math.round(e.avg_latency_ms / 1000)}s
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            <Text style={styles.charsNote}>
              累计字符数 (prompt + response): {charsK}K
            </Text>
          </View>
        ) : null}

        {/* 数据收集与画像 */}
        {profileSettings && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>数据收集与画像</Text>

            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchLabel}>记录我的行为信号</Text>
                <Text style={styles.switchHint}>
                  关闭后, app 不再上传你的打卡 / 训练 / 错题等操作记录.
                </Text>
              </View>
              <Switch
                value={profileSettings.signals_enabled}
                onValueChange={(v) =>
                  updateSetting({ signals_enabled: v })
                }
              />
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchLabel}>构建我的学习画像</Text>
                <Text style={styles.switchHint}>
                  关闭后, 系统不会基于已收集的数据生成你的学习特征画像.
                </Text>
              </View>
              <Switch
                value={profileSettings.profile_enabled}
                onValueChange={(v) =>
                  updateSetting({ profile_enabled: v })
                }
              />
            </View>

            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchLabel}>
                  把日记 / 反思字数计入画像
                </Text>
                <Text style={styles.switchHint}>
                  只统计字数, 不读取内容. 关闭后日记书写完全不进入画像.
                </Text>
              </View>
              <Switch
                value={profileSettings.journal_volume_in_profile}
                onValueChange={(v) =>
                  updateSetting({ journal_volume_in_profile: v })
                }
              />
            </View>

            <Pressable
              onPress={() => setSignalTypesOpen((v) => !v)}
              style={styles.collapseRow}
            >
              <Text style={styles.collapseText}>
                {signalTypesOpen ? '▾' : '▸'} 点击查看具体收集了什么
              </Text>
            </Pressable>
            {signalTypesOpen && (
              <View style={styles.signalList}>
                {SIGNAL_TYPES_ZH.map((it) => (
                  <View key={it.type} style={styles.signalItem}>
                    <Text style={styles.signalCode}>{it.type}</Text>
                    <Text style={styles.signalLabel}>{it.label}</Text>
                  </View>
                ))}
                <Text style={styles.signalFootnote}>
                  我们只记录事件类型 + 元数据 (科目 / 难度 / 时长 / 字数等),
                  不记录题目原文 / 作答内容 / 日记正文.
                </Text>
              </View>
            )}

            <Pressable
              onPress={confirmWipeSignals}
              disabled={wiping}
              style={[
                styles.btnWipe,
                wiping && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.btnWipeText}>
                {wiping ? '清除中...' : '清除我所有的行为数据'}
              </Text>
            </Pressable>
          </View>
        )}

        {/* AI 建议 */}
        {profileSettings && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>AI 建议</Text>

            <View style={styles.switchRow}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.switchLabel}>接收 AI 主动建议</Text>
                <Text style={styles.switchHint}>
                  关闭后, Dashboard 顶部不再显示 Tutor Agent 的建议卡片.
                </Text>
              </View>
              <Switch
                value={!!profileSettings.agent_enabled}
                onValueChange={(v) => updateSetting({ agent_enabled: v })}
              />
            </View>

            <View style={{ paddingTop: 8, gap: 8 }}>
              <Text style={styles.switchLabel}>暂停 AI 建议</Text>
              {profileSettings.snoozed_until ? (
                <Text style={styles.switchHint}>
                  当前暂停至: {profileSettings.snoozed_until}
                </Text>
              ) : (
                <Text style={styles.switchHint}>当前未暂停</Text>
              )}
              <View style={agentStyles.snoozeRow}>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => doSnooze(7)}
                  disabled={snoozeBusy}
                  style={[
                    agentStyles.snoozeBtn,
                    snoozeBusy && { opacity: 0.5 },
                  ]}
                >
                  <Text style={agentStyles.snoozeBtnText}>暂停 7 天</Text>
                </Pressable>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => doSnooze(14)}
                  disabled={snoozeBusy}
                  style={[
                    agentStyles.snoozeBtn,
                    snoozeBusy && { opacity: 0.5 },
                  ]}
                >
                  <Text style={agentStyles.snoozeBtnText}>暂停 14 天</Text>
                </Pressable>
                <Pressable
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => doSnooze(0)}
                  disabled={snoozeBusy}
                  style={[
                    agentStyles.snoozeBtnGhost,
                    snoozeBusy && { opacity: 0.5 },
                  ]}
                >
                  <Text style={agentStyles.snoozeBtnGhostText}>取消暂停</Text>
                </Pressable>
              </View>
            </View>

            <Pressable
              onPress={toggleActionsHistory}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.collapseRow}
            >
              <Text style={styles.collapseText}>
                {actionsOpen ? '▾' : '▸'} 查看建议历史
              </Text>
            </Pressable>
            {actionsOpen && (
              <View style={agentStyles.historyBox}>
                {actionsLoading && (
                  <Text style={styles.switchHint}>加载中...</Text>
                )}
                {!actionsLoading && actions && actions.length === 0 && (
                  <Text style={styles.switchHint}>还没有任何记录</Text>
                )}
                {!actionsLoading &&
                  actions &&
                  actions.map((a) => (
                    <View key={a.id} style={agentStyles.historyItem}>
                      <View style={agentStyles.historyHead}>
                        <Text style={agentStyles.historyKind}>
                          {a.kind || '建议'}
                        </Text>
                        <Text style={agentStyles.historyTime}>
                          {(a.created_at || '').slice(0, 16).replace('T', ' ')}
                        </Text>
                      </View>
                      {!!a.wording && (
                        <Text style={agentStyles.historyWording}>
                          {a.wording}
                        </Text>
                      )}
                      {!!a.response && (
                        <Text style={agentStyles.historyResp}>
                          响应: {a.response}
                        </Text>
                      )}
                    </View>
                  ))}
              </View>
            )}
          </View>
        )}

        {/* 看见自己 (元认知镜子) */}
        <Pressable
          style={styles.rowCard}
          onPress={() => navigation.navigate('Insights' as never)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>🪞 看见自己</Text>
            <Text style={styles.hint}>
              AI 对你的观察 — 你可以看, 可以改, 可以删
            </Text>
          </View>
          <Text style={{ fontSize: 18, color: colors.slate400 }}>›</Text>
        </Pressable>

        {/* 你讲过的 (反向教学历史) */}
        <Pressable
          style={styles.rowCard}
          onPress={() => navigation.navigate('FeynmanHistory' as never)}
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>🎓 你讲过的</Text>
            <Text style={styles.hint}>
              回看你给 AI 讲过的题
            </Text>
          </View>
          <Text style={{ fontSize: 18, color: colors.slate400 }}>›</Text>
        </Pressable>

        {/* 退出登录 */}
        <View style={styles.rowCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>退出登录</Text>
            <Text style={styles.hint}>当前会话结束, 数据不会删除</Text>
          </View>
          <Pressable style={styles.btnOutline} onPress={handleLogout}>
            <Text style={styles.btnOutlineText}>退出</Text>
          </Pressable>
        </View>

        {/* 危险区 */}
        <View style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>⚠️ 删除账号</Text>
          <Text style={styles.dangerText}>
            这将
            <Text style={{ color: '#dc2626', fontWeight: '700' }}>
              永久删除
            </Text>
            你的全部数据: 考试成绩、任务打卡、错题本、上传的试卷、训练题、月度报告。
            {user?.role === 'student'
              ? ' 绑定你的家长账号将失去关联 (但家长账号本身保留)。'
              : ''}
            {'\n'}此操作
            <Text style={{ fontWeight: '700' }}>不可恢复</Text>。
          </Text>

          <Pressable
            style={styles.btnDanger}
            onPress={() => setConfirming(true)}
          >
            <Text style={styles.btnDangerText}>我要删除账号</Text>
          </Pressable>
        </View>
      </ScrollView>

      {/* 密码二次确认 Modal */}
      <Modal
        visible={confirming}
        transparent
        animationType="fade"
        onRequestClose={cancelDelete}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>请输入密码二次确认</Text>
            <TextInput
              value={pw}
              onChangeText={setPw}
              secureTextEntry
              autoFocus
              placeholder="当前密码"
              placeholderTextColor={colors.slate400}
              style={styles.input}
            />
            {err ? <Text style={styles.errText}>{err}</Text> : null}
            <View style={styles.modalBtnRow}>
              <Pressable
                style={[styles.btnDanger, busy && { opacity: 0.5 }]}
                disabled={busy}
                onPress={handleDelete}
              >
                <Text style={styles.btnDangerText}>
                  {busy ? '删除中...' : '确认永久删除'}
                </Text>
              </Pressable>
              <Pressable
                style={styles.btnOutline}
                disabled={busy}
                onPress={cancelDelete}
              >
                <Text style={styles.btnOutlineText}>取消</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48, gap: 16 },
  header: { marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 16,
    gap: 8,
  },
  rowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.slate900,
    marginBottom: 4,
  },
  row: { fontSize: 14, color: colors.slate700, lineHeight: 22 },
  hint: { fontSize: 12, color: colors.slate500, marginTop: 2 },
  mono: {
    fontFamily: 'Menlo',
    backgroundColor: '#f1f5f9',
    paddingHorizontal: 4,
    borderRadius: 3,
  },
  joinCode: {
    fontFamily: 'Menlo',
    backgroundColor: '#fffbeb',
    color: '#b45309',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 3,
    letterSpacing: 3,
  },

  statsRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  statBox: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '700', color: colors.slate900 },
  statLabel: { fontSize: 11, color: colors.slate500, marginTop: 2 },

  endpointWrap: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    gap: 4,
  },
  endpointTitle: { fontSize: 12, fontWeight: '600', color: colors.slate700 },
  endpointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
  },
  endpointName: { flex: 1, fontSize: 12, color: colors.slate700 },
  endpointMeta: { fontSize: 12, color: colors.slate500 },
  charsNote: { fontSize: 11, color: colors.slate400, marginTop: 4 },

  btnOutline: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  btnOutlineText: { fontSize: 14, color: colors.slate700 },

  dangerCard: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  dangerTitle: { fontSize: 15, fontWeight: '700', color: '#b91c1c' },
  dangerText: { fontSize: 12, color: colors.slate600, lineHeight: 18 },
  btnDanger: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#dc2626',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  btnDangerText: { fontSize: 14, color: '#fff', fontWeight: '600' },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    gap: 12,
  },
  modalTitle: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.slate900,
  },
  errText: { fontSize: 13, color: colors.red500 },
  modalBtnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },

  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  switchLabel: { fontSize: 14, color: colors.slate800, fontWeight: '500' },
  switchHint: {
    fontSize: 11,
    color: colors.slate500,
    marginTop: 2,
    lineHeight: 16,
  },
  collapseRow: { paddingVertical: 10 },
  collapseText: { fontSize: 13, color: colors.brand },
  signalList: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    gap: 6,
    marginBottom: 10,
  },
  signalItem: { flexDirection: 'column', gap: 2 },
  signalCode: {
    fontSize: 11,
    color: colors.slate500,
    fontFamily: 'Menlo',
  },
  signalLabel: { fontSize: 12, color: colors.slate700 },
  signalFootnote: {
    fontSize: 11,
    color: colors.slate500,
    lineHeight: 16,
    marginTop: 6,
  },
  btnWipe: {
    marginTop: 4,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: '#dc2626',
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  btnWipeText: { color: '#fff', fontSize: 13, fontWeight: '600' },
})

const agentStyles = StyleSheet.create({
  snoozeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  snoozeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f5f3ff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#ddd6fe',
  },
  snoozeBtnText: { fontSize: 13, color: '#6d28d9', fontWeight: '500' },
  snoozeBtnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
  },
  snoozeBtnGhostText: { fontSize: 13, color: colors.slate600 },

  historyBox: {
    backgroundColor: '#f8fafc',
    borderRadius: 8,
    padding: 10,
    gap: 10,
    marginTop: 4,
  },
  historyItem: {
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: 4,
  },
  historyHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyKind: { fontSize: 12, fontWeight: '600', color: '#6d28d9' },
  historyTime: { fontSize: 11, color: colors.slate400 },
  historyWording: { fontSize: 13, color: colors.slate700, lineHeight: 19 },
  historyResp: { fontSize: 11, color: colors.slate500 },
})
