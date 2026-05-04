/**
 * AnalysisScreen — 读取 LLM 用量, 显示 recent_7d 调用数柱状图.
 * 只读.
 */
import React, { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BarChart } from 'react-native-gifted-charts'
import { api } from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

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

function shortDate(s: string): string {
  // "2026-04-17" -> "4/17"
  const parts = s.split('-')
  if (parts.length === 3) return `${Number(parts[1])}/${Number(parts[2])}`
  return s
}

export default function AnalysisScreen() {
  const { hPadding } = useResponsive()
  const [usage, setUsage] = useState<LlmUsage | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    let cancelled = false
    api
      .llmUsage()
      .then((u) => {
        if (!cancelled) setUsage(u)
      })
      .catch((e: any) => {
        if (!cancelled) setErr(e?.message || String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const screenWidth = Dimensions.get('window').width
  const chartData =
    usage?.recent_7d.map((d) => ({
      value: d.calls,
      label: shortDate(d.date),
      frontColor: colors.brand,
    })) ?? []
  const maxValue = Math.max(1, ...chartData.map((d) => d.value))

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}>
        <View style={styles.header}>
          <Text style={styles.title}>AI 用量分析</Text>
          <Text style={styles.subtitle}>近 7 天调用情况</Text>
        </View>

        <View style={styles.card}>
          {loading ? (
            <ActivityIndicator color={colors.brand} />
          ) : err ? (
            <Text style={styles.errText}>{err}</Text>
          ) : !usage || usage.recent_7d.length === 0 ? (
            <Text style={styles.emptyText}>暂无数据</Text>
          ) : (
            <>
              <Text style={styles.chartTitle}>近 7 天调用次数</Text>
              <View style={{ marginTop: 8 }}>
                <BarChart
                  data={chartData}
                  barWidth={22}
                  spacing={16}
                  roundedTop
                  hideRules
                  xAxisColor={colors.divider}
                  yAxisColor={colors.divider}
                  yAxisTextStyle={{ color: colors.slate500, fontSize: 10 }}
                  xAxisLabelTextStyle={{
                    color: colors.slate500,
                    fontSize: 10,
                  }}
                  noOfSections={4}
                  maxValue={Math.ceil(maxValue * 1.2)}
                  width={Math.max(240, screenWidth - 80)}
                />
              </View>

              <View style={styles.totalsRow}>
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
            </>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48, gap: 16 },
  header: {},
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },

  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 16,
    minHeight: 120,
  },
  chartTitle: { fontSize: 14, fontWeight: '600', color: colors.slate800 },

  totalsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  statBox: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '700', color: colors.slate900 },
  statLabel: { fontSize: 11, color: colors.slate500, marginTop: 2 },

  errText: { fontSize: 13, color: colors.red500 },
  emptyText: {
    fontSize: 13,
    color: colors.slate500,
    textAlign: 'center',
    paddingVertical: 24,
  },
})
