/**
 * SplitView — iPad 双栏布局, iPhone 单栏 fallback.
 *
 * 用法 (调用方决定 list 选中态):
 *   <SplitView
 *     list={<MyList ... />}
 *     detail={selected ? <MyDetail ... /> : null}
 *     emptyHint="选一项查看详情"
 *   />
 *
 * 行为:
 *   iPad (横/竖): 左 40% / 右 60% 同屏
 *   iPhone: 有 detail 时全屏 detail, 没有时全屏 list — 由调用方根据 isTablet 决定
 *           推荐: iPhone 直接保留旧行为(modal/导航), 不调 SplitView
 */
import React from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'
import { useResponsive } from '../lib/responsive'

type Props = {
  list: React.ReactNode
  detail: React.ReactNode | null
  emptyHint?: string
  /** 左栏宽度比例, 默认 0.40. iPad mini 这种窄屏可降到 0.36 */
  listFraction?: number
}

export default function SplitView({
  list,
  detail,
  emptyHint = '从左侧选一项',
  listFraction = 0.4,
}: Props) {
  const { isTablet, width } = useResponsive()

  if (!isTablet) {
    // iPhone fallback: 调用方应该自己处理路由, 这里直接返回 list
    return <>{detail ?? list}</>
  }

  const listWidth = Math.max(280, Math.min(420, width * listFraction))

  return (
    <View style={styles.row}>
      <View style={[styles.listPane, { width: listWidth }]}>{list}</View>
      <View style={styles.divider} />
      <View style={styles.detailPane}>
        {detail ?? (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>📄</Text>
            <Text style={styles.emptyText}>{emptyHint}</Text>
          </View>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', backgroundColor: colors.bg },
  listPane: { backgroundColor: colors.bg },
  divider: { width: 1, backgroundColor: colors.divider },
  detailPane: { flex: 1, backgroundColor: '#fff' },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  emptyIcon: { fontSize: 48, opacity: 0.3, marginBottom: 12 },
  emptyText: { fontSize: 14, color: colors.slate500, textAlign: 'center' },
})
