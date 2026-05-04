import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import { api, RecentFeynmanKp } from '../lib/api'
import { colors } from '../lib/theme'

const SUBJECTS = ['数学', '科学', '英语', '语文', '社会']
const KP_MAX = 80
const NOTE_MAX = 120

export default function FeynmanNewScreen() {
  const navigation = useNavigation<any>()
  const [subject, setSubject] = useState(SUBJECTS[0])
  const [kp, setKp] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState<RecentFeynmanKp[]>([])

  useEffect(() => {
    let cancelled = false
    api
      .listRecentFeynmanKps(12)
      .then((r) => {
        if (!cancelled) setRecent(r)
      })
      .catch(() => {
        // 静默: chips 是增强, 失败不影响表单
      })
    return () => {
      cancelled = true
    }
  }, [])

  function pickRecent(r: RecentFeynmanKp) {
    if (SUBJECTS.includes(r.subject)) setSubject(r.subject)
    setKp(r.knowledge_point)
  }

  const kpTrim = kp.trim()
  const noteTrim = note.trim()
  const valid = !!kpTrim && kpTrim.length <= KP_MAX && noteTrim.length <= NOTE_MAX

  async function submit() {
    if (!valid || busy) return
    setBusy(true)
    try {
      const r = await api.startFeynman({
        source_table: 'manual',
        subject,
        knowledge_point: kpTrim,
        learned_from: noteTrim || undefined,
      })
      navigation.replace('Feynman', { sessionId: r.session_id })
    } catch (e: any) {
      setBusy(false)
      Alert.alert('开始失败', e?.message || '请稍后重试')
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.intro}>
            刚学到的东西,讲给 AI 同学听,帮你把它变成真的"自己的"。
          </Text>

          {recent.length > 0 && (
            <View style={{ marginBottom: 4 }}>
              <View style={styles.recentHeaderRow}>
                <Text style={styles.label}>最近讲过的</Text>
                <Text style={styles.recentHint}>点一下继续讲</Text>
              </View>
              <View style={styles.pillsRow}>
                {recent.map((r) => {
                  const active =
                    r.subject === subject && r.knowledge_point === kpTrim
                  return (
                    <Pressable
                      key={`${r.subject}:${r.knowledge_point}`}
                      onPress={() => pickRecent(r)}
                      style={[
                        styles.recentChip,
                        active && styles.recentChipActive,
                      ]}
                    >
                      <View
                        style={[
                          styles.recentDot,
                          {
                            backgroundColor: r.last_understood
                              ? '#16a34a'
                              : colors.slate400,
                          },
                        ]}
                      />
                      <Text style={styles.recentChipSubject}>
                        {r.subject}·
                      </Text>
                      <Text
                        style={[
                          styles.recentChipKp,
                          active && styles.recentChipKpActive,
                        ]}
                      >
                        {r.knowledge_point}
                      </Text>
                      {r.session_count > 1 && (
                        <Text style={styles.recentChipCount}>
                          ×{r.session_count}
                        </Text>
                      )}
                    </Pressable>
                  )
                })}
              </View>
            </View>
          )}

          <Text style={styles.label}>科目</Text>
          <View style={styles.pillsRow}>
            {SUBJECTS.map((s) => (
              <Pressable
                key={s}
                onPress={() => setSubject(s)}
                style={[styles.pill, subject === s && styles.pillActive]}
              >
                <Text
                  style={[styles.pillText, subject === s && styles.pillTextActive]}
                >
                  {s}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.label}>
            知识点 <Text style={styles.req}>*</Text>
          </Text>
          <TextInput
            value={kp}
            onChangeText={setKp}
            placeholder="例: 勾股定理 / 电路串并联 / 定语从句"
            placeholderTextColor={colors.slate500}
            style={styles.input}
            maxLength={KP_MAX + 10}
            autoFocus
          />
          <Text
            style={[
              styles.hint,
              kpTrim.length > KP_MAX && styles.hintError,
            ]}
          >
            简短一两个词即可。{kpTrim.length} / {KP_MAX}
          </Text>

          <Text style={styles.label}>
            我在哪学的 <Text style={styles.optional}>(可选)</Text>
          </Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            placeholder="例: 物理 4.3 节 / B 站某视频 / 课堂"
            placeholderTextColor={colors.slate500}
            style={styles.input}
            maxLength={NOTE_MAX + 20}
          />
          <Text
            style={[
              styles.hint,
              noteTrim.length > NOTE_MAX && styles.hintError,
            ]}
          >
            告诉 AI 同学来源, 开场白会更自然。{noteTrim.length} / {NOTE_MAX}
          </Text>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            onPress={() => navigation.goBack()}
            style={styles.cancelBtn}
            disabled={busy}
          >
            <Text style={styles.cancelText}>取消</Text>
          </Pressable>
          <Pressable
            onPress={submit}
            style={[styles.submitBtn, (!valid || busy) && styles.submitBtnDisabled]}
            disabled={!valid || busy}
          >
            {busy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.submitText}>开始讲解</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  scroll: { padding: 16, paddingBottom: 32 },
  intro: { fontSize: 14, color: colors.slate500, marginBottom: 16, lineHeight: 20 },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.slate500,
    marginTop: 16,
    marginBottom: 6,
  },
  req: { color: '#ef4444' },
  optional: { color: colors.slate500, fontWeight: '400' },
  pillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  recentHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 6,
  },
  recentHint: { fontSize: 11, color: colors.slate400 },
  recentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: colors.bg,
  },
  recentChipActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  recentDot: { width: 6, height: 6, borderRadius: 3, marginRight: 2 },
  recentChipSubject: { fontSize: 12, color: colors.slate400 },
  recentChipKp: { fontSize: 12, color: colors.slate700, fontWeight: '500' },
  recentChipKpActive: { color: colors.brand },
  recentChipCount: { fontSize: 11, color: colors.slate400, marginLeft: 2 },
  pill: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.divider,
    backgroundColor: '#fff',
  },
  pillActive: {
    borderColor: colors.brand,
    backgroundColor: colors.brandLight,
  },
  pillText: { fontSize: 14, color: colors.slate500 },
  pillTextActive: { color: colors.brand, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  hint: { fontSize: 11, color: colors.slate500, marginTop: 4 },
  hintError: { color: '#ef4444' },
  footer: {
    flexDirection: 'row',
    gap: 12,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    backgroundColor: '#fff',
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 999,
    alignItems: 'center',
  },
  cancelText: { fontSize: 14, color: colors.slate500 },
  submitBtn: {
    flex: 2,
    paddingVertical: 12,
    backgroundColor: colors.brand,
    borderRadius: 999,
    alignItems: 'center',
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitText: { fontSize: 14, fontWeight: '600', color: '#fff' },
})
