/**
 * ReportsScreen — 月度复盘.
 *
 * 对齐 web 的 frontend/src/pages/Reports.tsx.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Alert,
  ActivityIndicator,
} from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { api } from '../lib/api'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'
import MdViewer from '../components/MdViewer'
import Share from 'react-native-share'

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function buildMonths(): string[] {
  // 本年 1-current + 去年 12 个月 (只保留不超过当前月的项)
  const d = new Date()
  const year = d.getFullYear()
  const month = d.getMonth() + 1
  const arr: string[] = []
  for (let m = month; m >= 1; m--) {
    arr.push(`${year}-${String(m).padStart(2, '0')}`)
  }
  for (let m = 12; m >= 1; m--) {
    arr.push(`${year - 1}-${String(m).padStart(2, '0')}`)
  }
  return arr
}

type ReportState = {
  exists: boolean
  status?: 'generating' | 'done' | 'failed'
  content_md?: string
  metrics?: any
  error_message?: string | null
}

export default function ReportsScreen() {
  const { hPadding } = useResponsive()
  const [list, setList] = useState<
    { id: number; month: string; created_at: string }[]
  >([])
  const [active, setActive] = useState<string>(currentMonth())
  const [report, setReport] = useState<ReportState>({ exists: false })
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const months = useMemo(() => buildMonths(), [])

  const refreshList = useCallback(async () => {
    try {
      const data = await api.listMonthlyReports()
      setList(data)
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }, [])

  const loadActive = useCallback(async (m: string) => {
    setErr('')
    setLoading(true)
    try {
      const r = await api.getMonthlyReport(m)
      setReport({
        exists: r.exists,
        status: r.status,
        content_md: r.content_md || '',
        metrics: r.metrics || null,
        error_message: r.error_message,
      })
    } catch (e: any) {
      setErr(e?.message || String(e))
      setReport({ exists: false })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refreshList()
  }, [refreshList])

  useEffect(() => {
    loadActive(active)
  }, [active, loadActive])

  // 轮询: generating 时每 3s 查询
  useEffect(() => {
    const isGenerating = report.exists && report.status === 'generating'
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    if (!isGenerating) return
    pollRef.current = setInterval(async () => {
      try {
        const r = await api.getMonthlyReport(active)
        setReport({
          exists: r.exists,
          status: r.status,
          content_md: r.content_md || '',
          metrics: r.metrics || null,
          error_message: r.error_message,
        })
        if (r.status !== 'generating') {
          refreshList()
        }
      } catch {
        /* ignore poll errors */
      }
    }, 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [report.exists, report.status, active, refreshList])

  async function generate(force: boolean) {
    setErr('')
    try {
      const r = await api.generateMonthlyReport(active, force)
      setReport({
        exists: true,
        status: r.status || 'done',
        content_md: r.content_md || '',
        metrics: r.metrics || null,
        error_message: r.error_message,
      })
      await refreshList()
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }

  async function shareReport() {
    if (!report.content_md) return
    try {
      await Share.open({
        title: `${active} 月度复盘`,
        subject: `${active} 月度复盘`,
        message: `# ${active} 月度复盘\n\n${report.content_md}`,
        failOnCancel: false,
      })
    } catch (e: any) {
      if (e?.message && !/user did not share|cancell/i.test(e.message)) {
        Alert.alert('分享失败', e.message)
      }
    }
  }

  function remove() {
    Alert.alert(`删除 ${active} 的复盘报告?`, undefined, [
      { text: '取消', style: 'cancel' },
      {
        text: '删除',
        style: 'destructive',
        onPress: async () => {
          try {
            await api.deleteMonthlyReport(active)
            setReport({ exists: false })
            await refreshList()
          } catch (e: any) {
            setErr(e?.message || String(e))
          }
        },
      },
    ])
  }

  const hasDoneReport =
    report.exists && report.status === 'done' && !!report.content_md
  const isGenerating = report.exists && report.status === 'generating'
  const isFailed = report.status === 'failed'

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}
        refreshControl={
          <RefreshControl
            refreshing={loading}
            onRefresh={() => {
              refreshList()
              loadActive(active)
            }}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>月度复盘</Text>
          <Text style={styles.subtitle}>
            每月 AI 基于当月考试、错题、打卡、训练自动生成复盘报告
          </Text>
        </View>

        {/* 月份选择 */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.monthsRow}
        >
          {months.map((m) => {
            const hasData = list.some((r) => r.month === m)
            const isActive = active === m
            return (
              <Pressable
                key={m}
                onPress={() => setActive(m)}
                style={[
                  styles.monthPill,
                  isActive
                    ? styles.monthPillActive
                    : hasData
                    ? styles.monthPillHasData
                    : styles.monthPillDefault,
                ]}
              >
                <Text
                  style={[
                    styles.monthPillText,
                    isActive
                      ? styles.monthPillTextActive
                      : hasData
                      ? styles.monthPillTextHasData
                      : styles.monthPillTextDefault,
                  ]}
                >
                  {m}
                  {hasData ? ' ✓' : ''}
                </Text>
              </Pressable>
            )
          })}
        </ScrollView>

        {err ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{err}</Text>
          </View>
        ) : null}

        {isGenerating && (
          <View style={styles.generatingBox}>
            <ActivityIndicator color={colors.brand} />
            <Text style={styles.generatingTitle}>
              AI 正在生成 {active} 复盘报告...
            </Text>
            <Text style={styles.generatingHint}>
              大约 20-40 秒. 你可以切到其他页面, 稍后回来看
            </Text>
          </View>
        )}

        {isFailed && (
          <View style={styles.failedBox}>
            <Text style={styles.failedTitle}>生成失败</Text>
            <Text style={styles.failedMsg}>
              {report.error_message || '未知原因'}
            </Text>
            <Pressable
              onPress={() => generate(true)}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>🔄 重试</Text>
            </Pressable>
          </View>
        )}

        {!report.exists && !isGenerating && !isFailed && !loading && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyTitle}>{active} 还没有复盘报告</Text>
            <Text style={styles.emptyHint}>
              生成后会整合本月考试成绩、错题分布、打卡记录和训练数据, 用 AI 写一份有洞察的月度报告
            </Text>
            <Pressable
              onPress={() => generate(false)}
              style={styles.primaryBtn}
            >
              <Text style={styles.primaryBtnText}>🧠 生成 {active} 复盘</Text>
            </Pressable>
          </View>
        )}

        {hasDoneReport && (
          <View style={styles.reportWrap}>
            <View style={styles.actionsRow}>
              <Pressable onPress={shareReport} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>📤 分享</Text>
              </Pressable>
              <Pressable
                onPress={() => generate(true)}
                style={styles.secondaryBtn}
              >
                <Text style={styles.secondaryBtnText}>🔄 重新生成</Text>
              </Pressable>
              <Pressable onPress={remove} style={styles.dangerBtn}>
                <Text style={styles.dangerBtnText}>删除</Text>
              </Pressable>
            </View>

            {report.metrics && <MetricsBar metrics={report.metrics} />}

            <View style={styles.mdCard}>
              <MdViewer markdown={report.content_md || ''} />
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  )
}

function MetricsBar({ metrics }: { metrics: any }) {
  const items: { label: string; value: string | number }[] = [
    { label: '本月考试', value: metrics?.exams?.length || 0 },
    { label: '新增错题', value: metrics?.mistakes_count || 0 },
    { label: '打卡天数', value: metrics?.distinct_checkin_days || 0 },
    { label: '训练题数', value: metrics?.practice_item_count || 0 },
  ]
  return (
    <View style={styles.metricsRow}>
      {items.map((it) => (
        <View key={it.label} style={styles.metricCard}>
          <Text style={styles.metricLabel}>{it.label}</Text>
          <Text style={styles.metricValue}>{it.value}</Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },

  header: { marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  subtitle: { fontSize: 13, color: colors.slate500, marginTop: 4 },

  monthsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    paddingRight: 16,
  },
  monthPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    marginRight: 8,
  },
  monthPillDefault: {
    backgroundColor: '#fff',
    borderColor: colors.border,
  },
  monthPillHasData: {
    backgroundColor: '#f0fdf4',
    borderColor: '#bbf7d0',
  },
  monthPillActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  monthPillText: { fontSize: 13 },
  monthPillTextDefault: { color: colors.slate600 },
  monthPillTextHasData: { color: '#15803d' },
  monthPillTextActive: { color: '#fff', fontWeight: '600' },

  errorBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 6,
    padding: 12,
    marginTop: 12,
  },
  errorText: { color: '#dc2626', fontSize: 13 },

  generatingBox: {
    backgroundColor: colors.brandLight,
    borderWidth: 1,
    borderColor: '#bfdbfe',
    borderRadius: 10,
    padding: 20,
    alignItems: 'center',
    marginTop: 16,
  },
  generatingTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.brandHover,
    marginTop: 8,
  },
  generatingHint: {
    fontSize: 12,
    color: colors.slate500,
    marginTop: 4,
    textAlign: 'center',
  },

  failedBox: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 16,
    marginTop: 16,
  },
  failedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#b91c1c',
    marginBottom: 4,
  },
  failedMsg: { fontSize: 13, color: colors.slate700 },

  emptyBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 24,
    alignItems: 'center',
    marginTop: 16,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.slate900,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.slate500,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },

  primaryBtn: {
    backgroundColor: colors.brand,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
    marginTop: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  reportWrap: { marginTop: 16, gap: 12 },

  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  secondaryBtnText: { fontSize: 13, color: colors.slate700 },
  dangerBtn: {
    borderWidth: 1,
    borderColor: '#fecaca',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#fff',
  },
  dangerBtnText: { fontSize: 13, color: colors.red500 },

  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  metricCard: {
    flexGrow: 1,
    flexBasis: '48%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 12,
  },
  metricLabel: { fontSize: 11, color: colors.slate500 },
  metricValue: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.slate900,
    marginTop: 4,
  },

  mdCard: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 16,
  },
})
