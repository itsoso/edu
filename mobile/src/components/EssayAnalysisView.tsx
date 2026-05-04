/**
 * AI 作文批改结果展示 (RN). 分数 + 亮点/不足 + 三维分析 + 改写示例 + 总评.
 */
import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { EssayAnalysis } from '../lib/api'
import { colors } from '../lib/theme'

function scoreColor(score: number): string {
  if (score >= 85) return colors.green600
  if (score >= 70) return colors.brand
  if (score >= 55) return colors.amber500
  return colors.red500
}

function gradeBg(grade: string | undefined): { bg: string; fg: string } {
  const g = grade || ''
  if (g.startsWith('A')) return { bg: '#dcfce7', fg: '#15803d' }
  if (g.startsWith('B')) return { bg: '#dbeafe', fg: '#1d4ed8' }
  if (g.startsWith('C')) return { bg: '#fef3c7', fg: '#b45309' }
  return { bg: '#fee2e2', fg: '#b91c1c' }
}

export default function EssayAnalysisView({ analysis }: { analysis: EssayAnalysis }) {
  const a = analysis
  const gb = gradeBg(a.grade)

  return (
    <View style={styles.wrap}>
      {/* 分数卡片 */}
      <View style={styles.scoreCard}>
        <View style={styles.scoreBox}>
          <Text style={[styles.scoreNum, { color: scoreColor(a.score) }]}>{a.score}</Text>
          <Text style={styles.scoreOutOf}>/ 100</Text>
        </View>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>
          {!!a.grade && (
            <View style={[styles.gradeBadge, { backgroundColor: gb.bg }]}>
              <Text style={[styles.gradeText, { color: gb.fg }]}>{a.grade}</Text>
            </View>
          )}
        </View>
      </View>

      {/* 总评 */}
      {!!a.overall_comment && (
        <View style={styles.commentBox}>
          <Text style={styles.commentText}>{a.overall_comment}</Text>
        </View>
      )}

      {/* 亮点 */}
      {a.strengths && a.strengths.length > 0 && (
        <View style={[styles.listCard, { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' }]}>
          <Text style={[styles.listTitle, { color: '#15803d' }]}>亮点</Text>
          {a.strengths.map((s, i) => (
            <Text key={i} style={styles.listItem}>
              {'\u2022 '}
              {s}
            </Text>
          ))}
        </View>
      )}

      {/* 不足 */}
      {a.weaknesses && a.weaknesses.length > 0 && (
        <View style={[styles.listCard, { backgroundColor: '#fffbeb', borderColor: '#fcd34d' }]}>
          <Text style={[styles.listTitle, { color: '#b45309' }]}>不足</Text>
          {a.weaknesses.map((s, i) => (
            <Text key={i} style={styles.listItem}>
              {'\u2022 '}
              {s}
            </Text>
          ))}
        </View>
      )}

      {/* 三维分析 */}
      {(!!a.structure_analysis || !!a.language_analysis || !!a.content_analysis) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>详细分析</Text>
          {!!a.structure_analysis && (
            <Text style={styles.analysisLine}>
              <Text style={styles.analysisLabel}>结构分析: </Text>
              {a.structure_analysis}
            </Text>
          )}
          {!!a.language_analysis && (
            <Text style={styles.analysisLine}>
              <Text style={styles.analysisLabel}>语言分析: </Text>
              {a.language_analysis}
            </Text>
          )}
          {!!a.content_analysis && (
            <Text style={styles.analysisLine}>
              <Text style={styles.analysisLabel}>内容分析: </Text>
              {a.content_analysis}
            </Text>
          )}
        </View>
      )}

      {/* 改进建议 */}
      {a.improvement_suggestions && a.improvement_suggestions.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>改进建议</Text>
          {a.improvement_suggestions.map((s, i) => (
            <Text key={i} style={styles.listItem}>
              {i + 1}. {s}
            </Text>
          ))}
        </View>
      )}

      {/* 改写示例 */}
      {a.model_sentences && a.model_sentences.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>优秀改写示例</Text>
          {a.model_sentences.map((m, i) => (
            <View key={i} style={styles.modelCard}>
              <Text style={styles.modelOriginal}>原文: {m.original}</Text>
              <Text style={styles.modelImproved}>改写: {m.improved}</Text>
              <Text style={styles.modelReason}>理由: {m.reason}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  scoreCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    padding: 16,
  },
  scoreBox: { alignItems: 'center' },
  scoreNum: { fontSize: 36, fontWeight: '700' },
  scoreOutOf: { fontSize: 11, color: colors.slate500 },
  gradeBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  gradeText: { fontSize: 13, fontWeight: '600' },

  commentBox: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    padding: 12,
  },
  commentText: { fontSize: 13, color: colors.slate700, lineHeight: 20 },

  listCard: { borderWidth: 1, borderRadius: 8, padding: 12 },
  listTitle: { fontSize: 13, fontWeight: '600', marginBottom: 6 },
  listItem: { fontSize: 13, color: colors.slate700, lineHeight: 20, marginBottom: 2 },

  section: { gap: 6 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: colors.slate800, marginBottom: 4 },
  analysisLine: { fontSize: 13, color: colors.slate700, lineHeight: 20 },
  analysisLabel: { fontWeight: '600', color: colors.slate800 },

  modelCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 6,
    padding: 10,
    marginBottom: 6,
  },
  modelOriginal: {
    fontSize: 12,
    color: colors.red500,
    marginBottom: 4,
    textDecorationLine: 'line-through',
  },
  modelImproved: { fontSize: 12, color: '#15803d', marginBottom: 4 },
  modelReason: { fontSize: 11, color: colors.slate500 },
})
