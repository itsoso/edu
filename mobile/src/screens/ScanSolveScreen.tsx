/**
 * 拍照解题屏 — 拍/选一张题目, AI 给出解答, 可选录入错题本.
 */
import React, { useState } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../lib/api'
import { pickImage } from '../lib/imageCompress'
import { colors } from '../lib/theme'
import MathText from '../components/MathText'

type Result = {
  question_text: string
  subject: string
  knowledge_point: string | null
  difficulty: string
  answer: string
  solution_steps: string
  common_mistakes: string
}

export default function ScanSolveScreen({ navigation }: any) {
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<Result | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSource(src: 'camera' | 'library') {
    try {
      const asset = await pickImage(src, 'scan')
      if (!asset || !asset.uri) return
      setResult(null)
      setBusy('AI 识别解答中(约 10-30 秒)...')
      const r = await api.scanSolveMistake(
        asset.uri,
        asset.fileName || `q-${Date.now()}.jpg`,
        asset.type || 'image/jpeg',
        false
      )
      setResult(r)
    } catch (e: any) {
      const msg = String(e?.message || e)
      if (msg.includes('no_question_detected')) {
        Alert.alert('未识别到题目', '请换一张更清晰的照片重试')
      } else {
        Alert.alert('解析失败', msg)
      }
    } finally {
      setBusy('')
    }
  }

  async function handleSave() {
    if (!result) return
    setSaving(true)
    try {
      await api.createMistake({
        subject: result.subject,
        exam_name: '拍照解题',
        question_text: result.question_text,
        correct_answer: result.answer,
        reason: result.common_mistakes || '拍照录入待复习',
        knowledge_point: result.knowledge_point,
        solution_steps: result.solution_steps,
      })
      Alert.alert('已加入错题本', '可在错题列表里查看')
      navigation.goBack()
    } catch (e: any) {
      Alert.alert('保存失败', String(e?.message || e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={['left', 'right']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {!result && (
          <View style={styles.empty}>
            <Text style={styles.emoji}>📷</Text>
            <Text style={styles.hint}>
              拍一张题目, AI 自动识别 + 给出解答
              {'\n'}不会的题可一键录入错题本
            </Text>
            <View style={styles.btnRow}>
              <Pressable
                onPress={() => handleSource('camera')}
                disabled={!!busy}
                style={[styles.btnPrimary, !!busy && styles.btnDisabled]}
              >
                <Text style={styles.btnPrimaryText}>📸 拍照</Text>
              </Pressable>
              <Pressable
                onPress={() => handleSource('library')}
                disabled={!!busy}
                style={[styles.btnSecondary, !!busy && styles.btnDisabled]}
              >
                <Text style={styles.btnSecondaryText}>从相册选择</Text>
              </Pressable>
            </View>
            {!!busy && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16, gap: 8 }}>
                <ActivityIndicator size="small" />
                <Text style={styles.busy}>{busy}</Text>
              </View>
            )}
          </View>
        )}

        {result && (
          <>
            <View style={styles.section}>
              <Text style={styles.label}>题目</Text>
              <View style={styles.box}>
                <MathText text={result.question_text} style={styles.bodyText} />
              </View>
            </View>

            <View style={styles.tagRow}>
              <View style={[styles.tag, { backgroundColor: '#e9d5ff' }]}>
                <Text style={[styles.tagText, { color: '#6d28d9' }]}>{result.subject}</Text>
              </View>
              {!!result.knowledge_point && (
                <View style={[styles.tag, { backgroundColor: '#dbeafe' }]}>
                  <Text style={[styles.tagText, { color: '#1d4ed8' }]}>
                    {result.knowledge_point}
                  </Text>
                </View>
              )}
              <View style={[styles.tag, { backgroundColor: '#fef3c7' }]}>
                <Text style={[styles.tagText, { color: '#92400e' }]}>
                  难度: {result.difficulty}
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>答案</Text>
              <View style={[styles.box, { backgroundColor: '#ecfdf5', borderColor: '#86efac' }]}>
                <MathText text={result.answer} style={styles.bodyText} />
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.label}>解题步骤</Text>
              <View style={styles.box}>
                <MathText text={result.solution_steps} style={styles.bodyText} />
              </View>
            </View>

            {!!result.common_mistakes && (
              <View style={styles.section}>
                <Text style={styles.label}>常见错误点</Text>
                <View style={[styles.box, { backgroundColor: '#fffbeb', borderColor: '#fcd34d' }]}>
                  <MathText text={result.common_mistakes} style={styles.bodyText} />
                </View>
              </View>
            )}

            <View style={styles.actionRow}>
              <Pressable
                onPress={() => {
                  setResult(null)
                }}
                style={styles.btnSecondary}
              >
                <Text style={styles.btnSecondaryText}>换一题</Text>
              </Pressable>
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={[styles.btnPrimary, saving && styles.btnDisabled]}
              >
                <Text style={styles.btnPrimaryText}>
                  {saving ? '保存中...' : '📝 加入错题本'}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 40 },
  empty: { alignItems: 'center', paddingTop: 40 },
  emoji: { fontSize: 56 },
  hint: {
    color: colors.slate500,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 24,
    lineHeight: 20,
    fontSize: 14,
  },
  btnRow: { flexDirection: 'row', gap: 12 },
  btnPrimary: {
    backgroundColor: colors.brand,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: '#fff',
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
  },
  btnSecondaryText: { color: colors.slate700, fontSize: 15, fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },
  busy: { color: colors.brand, fontSize: 13 },
  section: { marginBottom: 14 },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.slate500,
    marginBottom: 6,
  },
  box: {
    backgroundColor: '#f8fafc',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  bodyText: { fontSize: 14, color: colors.slate900, lineHeight: 22 },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 14 },
  tag: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  tagText: { fontSize: 11, fontWeight: '600' },
  actionRow: { flexDirection: 'row', gap: 12, justifyContent: 'flex-end', marginTop: 8 },
})
