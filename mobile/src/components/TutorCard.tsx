/**
 * TutorCard — Dashboard 顶部 Tutor Agent 主动建议卡片.
 *
 * 平静中性的 UI: 不像广告, 像一个建议. 用户可以接受 / 跳过 / snooze.
 */
import React, { useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Animated,
  Modal,
  Alert,
  TextInput,
} from 'react-native'
import { useNavigation } from '@react-navigation/native'
import { api, AgentSuggestion } from '../lib/api'
import { colors } from '../lib/theme'
import { useToast } from './Toast'

const HIT = { top: 8, bottom: 8, left: 8, right: 8 }

type Props = {
  suggestion: AgentSuggestion
  onResolved: () => void
  onSnoozed?: (days: number) => void
}

export default function TutorCard({ suggestion, onResolved, onSnoozed }: Props) {
  const navigation = useNavigation<any>()
  const toast = useToast()
  const opacity = useRef(new Animated.Value(1)).current
  const [busy, setBusy] = useState(false)
  const [whyOpen, setWhyOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [skipPrompt, setSkipPrompt] = useState(false)
  const [skipReason, setSkipReason] = useState('')

  function fadeOutThen(cb: () => void) {
    Animated.timing(opacity, {
      toValue: 0,
      duration: 220,
      useNativeDriver: true,
    }).start(() => cb())
  }

  async function onAccept() {
    if (busy) return
    setBusy(true)
    try {
      const res = await api.acceptSuggestion(suggestion.id)
      const action = suggestion.accept_action || {}
      const result = res.result || {}
      // 解析跳转
      const navTarget: string | undefined =
        action.navigate_to || result.navigate_to
      if (action.type === 'generate_practice' && result.practice_set_id) {
        fadeOutThen(() => {
          onResolved()
          navigation.navigate('Practice', {
            openSetId: result.practice_set_id,
          })
        })
      } else if (action.type === 'navigate' && navTarget) {
        fadeOutThen(() => {
          onResolved()
          navigation.navigate(navTarget)
        })
      } else if (navTarget) {
        // result 自带 navigate_to (例如 generate_practice 兜底)
        fadeOutThen(() => {
          onResolved()
          if (navTarget === 'Practice' && result.practice_set_id) {
            navigation.navigate('Practice', {
              openSetId: result.practice_set_id,
            })
          } else {
            navigation.navigate(navTarget)
          }
        })
      } else {
        // acknowledge 或未知: 只是消失
        toast.success('好的')
        fadeOutThen(onResolved)
      }
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setBusy(false)
    }
  }

  async function doDismiss(reason: string) {
    if (busy) return
    setBusy(true)
    try {
      await api.dismissSuggestion(suggestion.id, reason)
      fadeOutThen(onResolved)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setBusy(false)
    }
  }

  function onSkip() {
    setSkipPrompt(true)
  }

  async function doSnooze(days: number) {
    setMenuOpen(false)
    if (busy) return
    setBusy(true)
    try {
      const r = await api.snoozeAgent(days)
      toast.success(
        days === 0
          ? '已取消暂停'
          : `已暂停 ${days} 天${r.snoozed_until ? '' : ''}`
      )
      onSnoozed?.(days)
      fadeOutThen(onResolved)
    } catch (e: any) {
      toast.error(String(e?.message || e))
      setBusy(false)
    }
  }

  function renderEvidence() {
    const ev = suggestion.evidence_refs
    if (!ev) return null
    if (Array.isArray(ev)) {
      if (ev.length === 0) return null
      return (
        <View style={styles.evidenceBox}>
          {ev.slice(0, 5).map((it, idx) => (
            <Text key={idx} style={styles.evidenceLine}>
              · {typeof it === 'string' ? it : JSON.stringify(it)}
            </Text>
          ))}
        </View>
      )
    }
    if (typeof ev === 'object') {
      const entries = Object.entries(ev).slice(0, 5)
      if (entries.length === 0) return null
      return (
        <View style={styles.evidenceBox}>
          {entries.map(([k, v]) => (
            <Text key={k} style={styles.evidenceLine}>
              · {k}: {typeof v === 'string' ? v : JSON.stringify(v)}
            </Text>
          ))}
        </View>
      )
    }
    return <Text style={styles.evidenceLine}>{String(ev)}</Text>
  }

  return (
    <Animated.View style={[styles.card, { opacity }]}>
      <View style={styles.headerRow}>
        <Text style={styles.headerLabel}>🤖 给你一个建议</Text>
        <Pressable
          onPress={() => setMenuOpen(true)}
          hitSlop={HIT}
          style={styles.menuBtn}
        >
          <Text style={styles.menuDots}>⋯</Text>
        </Pressable>
      </View>

      <Text style={styles.wording}>{suggestion.wording}</Text>

      <Pressable
        onPress={() => setWhyOpen((o) => !o)}
        hitSlop={HIT}
        style={styles.whyRow}
      >
        <Text style={styles.whyText}>
          {whyOpen ? '收起 ▾' : '为什么是这条? →'}
        </Text>
      </Pressable>

      {whyOpen && (
        <View style={styles.whyBody}>
          {!!suggestion.rationale && (
            <Text style={styles.rationale}>{suggestion.rationale}</Text>
          )}
          {renderEvidence()}
        </View>
      )}

      <View style={styles.btnRow}>
        <Pressable
          onPress={onAccept}
          disabled={busy}
          hitSlop={HIT}
          style={[styles.btnPrimary, busy && { opacity: 0.5 }]}
        >
          <Text style={styles.btnPrimaryText}>好, 我试试</Text>
        </Pressable>
        <Pressable
          onPress={onSkip}
          disabled={busy}
          hitSlop={HIT}
          style={[styles.btnGhost, busy && { opacity: 0.5 }]}
        >
          <Text style={styles.btnGhostText}>这次跳过</Text>
        </Pressable>
      </View>

      {/* 三点菜单 */}
      <Modal
        visible={menuOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setMenuOpen(false)}
        >
          <View style={styles.menuCard}>
            <Pressable
              onPress={() => doSnooze(7)}
              style={styles.menuItem}
              hitSlop={HIT}
            >
              <Text style={styles.menuItemText}>暂停 7 天</Text>
            </Pressable>
            <Pressable
              onPress={() => doSnooze(14)}
              style={styles.menuItem}
              hitSlop={HIT}
            >
              <Text style={styles.menuItemText}>暂停 14 天</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false)
                Alert.alert(
                  '不再接收 AI 建议?',
                  '可以在 设置 → AI 建议 中重新打开.',
                  [
                    { text: '取消', style: 'cancel' },
                    {
                      text: '关闭',
                      style: 'destructive',
                      onPress: async () => {
                        try {
                          await api.updateProfileSettings({
                            agent_enabled: false,
                          })
                          fadeOutThen(onResolved)
                        } catch (e: any) {
                          toast.error(String(e?.message || e))
                        }
                      },
                    },
                  ]
                )
              }}
              style={styles.menuItem}
              hitSlop={HIT}
            >
              <Text style={styles.menuItemText}>不再建议</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setMenuOpen(false)
                setWhyOpen(true)
              }}
              style={styles.menuItem}
              hitSlop={HIT}
            >
              <Text style={styles.menuItemText}>看看为什么</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* 跳过原因 (可选) */}
      <Modal
        visible={skipPrompt}
        transparent
        animationType="fade"
        onRequestClose={() => setSkipPrompt(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.skipCard}>
            <Text style={styles.skipTitle}>这次跳过</Text>
            <Text style={styles.skipHint}>
              告诉我原因 (可选), 帮我以后建议得更准.
            </Text>
            <TextInput
              value={skipReason}
              onChangeText={setSkipReason}
              placeholder="例如: 今天太累了 / 这条不准 / 已经做过了"
              placeholderTextColor={colors.slate400}
              style={styles.skipInput}
              multiline
              maxLength={200}
            />
            <View style={styles.skipBtnRow}>
              <Pressable
                onPress={() => {
                  setSkipPrompt(false)
                  doDismiss(skipReason.trim())
                }}
                hitSlop={HIT}
                style={styles.btnPrimary}
              >
                <Text style={styles.btnPrimaryText}>跳过</Text>
              </Pressable>
              <Pressable
                onPress={() => setSkipPrompt(false)}
                hitSlop={HIT}
                style={styles.btnGhost}
              >
                <Text style={styles.btnGhostText}>取消</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#f5f3ff',
    borderWidth: 1,
    borderColor: '#ddd6fe',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLabel: {
    fontSize: 12,
    color: '#6d28d9',
    fontWeight: '600',
  },
  menuBtn: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  menuDots: { fontSize: 18, color: colors.slate500, lineHeight: 20 },

  wording: {
    fontSize: 16,
    color: colors.slate900,
    lineHeight: 24,
    fontWeight: '500',
  },
  whyRow: { paddingVertical: 2 },
  whyText: { fontSize: 12, color: '#6d28d9' },
  whyBody: {
    backgroundColor: '#eff6ff',
    borderRadius: 8,
    padding: 10,
    gap: 6,
  },
  rationale: {
    fontSize: 12,
    color: colors.slate700,
    lineHeight: 18,
  },
  evidenceBox: { gap: 2 },
  evidenceLine: { fontSize: 11, color: colors.slate500, lineHeight: 16 },

  btnRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  btnPrimary: {
    backgroundColor: '#6d28d9',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#c4b5fd',
    backgroundColor: 'transparent',
  },
  btnGhostText: { color: '#6d28d9', fontSize: 14 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    justifyContent: 'center',
    padding: 24,
  },
  menuCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 6,
  },
  menuItem: {
    paddingVertical: 14,
    paddingHorizontal: 18,
  },
  menuItemText: { fontSize: 15, color: colors.slate800 },

  skipCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 18,
    gap: 10,
  },
  skipTitle: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  skipHint: { fontSize: 12, color: colors.slate500 },
  skipInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 10,
    minHeight: 60,
    fontSize: 14,
    color: colors.slate900,
    textAlignVertical: 'top',
  },
  skipBtnRow: { flexDirection: 'row', gap: 8 },
})
