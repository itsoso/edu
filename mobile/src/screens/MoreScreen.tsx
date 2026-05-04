/**
 * 更多入口 — 把不常用的功能塞一个网格页.
 * Dashboard 的 quick-links 也指向这些, 二者可并存.
 */
import React from 'react'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { colors } from '../lib/theme'
import { useAuth } from '../lib/auth'
import { useResponsive } from '../lib/responsive'

type NavProp = NativeStackNavigationProp<Record<string, undefined>>

const ITEMS: { route: string; icon: string; title: string; desc: string }[] = [
  { route: 'Plan', icon: '📅', title: '周计划', desc: '编辑本周任务 / 跳过 / 替换' },
  { route: 'Schedule', icon: '🗓️', title: '课程日历', desc: '周末接送安排 · 潘立言 / 潘友闻' },
  { route: 'Scan', icon: '📸', title: '扫试卷', desc: '拍照 → OCR → 错题本' },
  { route: 'Trends', icon: '📈', title: '成绩趋势', desc: '考试数据和走势' },
  { route: 'Journal', icon: '🕊️', title: '日记', desc: '写给自己 · 不分析' },
  { route: 'Coach', icon: '📅', title: '周日复盘', desc: 'AI 教练本周回顾 + 下周方向' },
  { route: 'Reports', icon: '🧠', title: '月度复盘', desc: 'AI 生成本月总结' },
  { route: 'Insights', icon: '🪞', title: '看见自己', desc: 'AI 对你的观察 (你可以改)' },
  { route: 'FeynmanHistory', icon: '🎓', title: '你讲过的', desc: '回看你给 AI 讲过的题' },
  { route: 'Methods', icon: '🎯', title: '学习方法', desc: '各科速查卡' },
  { route: 'Analysis', icon: '📊', title: 'AI 用量', desc: '调用统计' },
  { route: 'Settings', icon: '⚙️', title: '设置', desc: '账号 / 退出' },
]

export default function MoreScreen() {
  const navigation = useNavigation<NavProp>()
  const { user } = useAuth()
  const { hPadding, isTablet, gridCols } = useResponsive()
  const cardWidth = isTablet ? (gridCols === 4 ? '23%' : gridCols === 3 ? '31%' : '48%') : '48%'
  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}>
        <Text style={styles.title}>更多</Text>
        {user && (
          <Text style={styles.hello}>
            {user.display_name} · {user.role === 'parent' ? '家长' : '学生'}
          </Text>
        )}
        <View style={styles.grid}>
          {ITEMS.map((it) => (
            <Pressable
              key={it.route}
              onPress={() => navigation.navigate(it.route as never)}
              style={[styles.card, { width: cardWidth }]}
            >
              <Text style={styles.icon}>{it.icon}</Text>
              <Text style={styles.cardTitle}>{it.title}</Text>
              <Text style={styles.cardDesc}>{it.desc}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 16, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '700', color: colors.slate900 },
  hello: { fontSize: 13, color: colors.slate500, marginTop: 4, marginBottom: 20 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  card: {
    width: '48%',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 10,
    padding: 14,
  },
  icon: { fontSize: 24, marginBottom: 6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.slate900 },
  cardDesc: { fontSize: 11, color: colors.slate500, marginTop: 2 },
})
