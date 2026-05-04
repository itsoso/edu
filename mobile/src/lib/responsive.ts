/**
 * iPad / iPhone 响应式布局辅助.
 *
 * 断点:
 *   < 600: 手机 (iPhone 全系)
 *   600-900: 小平板 / iPhone 横屏
 *   >= 900: 大平板 (iPad Pro, iPad Air)
 *
 * 用法:
 *   const { isTablet, maxContent, gridCols, hPadding } = useResponsive()
 *   <ScrollView contentContainerStyle={[styles.scroll, { paddingHorizontal: hPadding }]}>
 *     <View style={{ maxWidth: maxContent, alignSelf: 'center', width: '100%' }}>
 *       ...
 *     </View>
 *   </ScrollView>
 */
import { useWindowDimensions } from 'react-native'

export type ResponsiveInfo = {
  width: number
  height: number
  isTablet: boolean         // >= 768
  isLargeTablet: boolean    // >= 1024 (iPad landscape / iPad Pro 13 portrait)
  isLandscape: boolean
  /** 内容区最大宽度 (读长文体验). 手机返回 undefined. */
  maxContent: number | undefined
  /** 推荐网格列数 (quick-links / 卡片列表). */
  gridCols: number
  /** 推荐水平内边距. 手机 16, 平板更宽形成两侧留白. */
  hPadding: number
}

export function useResponsive(): ResponsiveInfo {
  const { width, height } = useWindowDimensions()
  const isTablet = width >= 768
  const isLargeTablet = width >= 1024
  const isLandscape = width > height

  // 平板上内容最大 ~720pt 读长文舒适; 超宽 iPad 横屏 860.
  const maxContent = isLargeTablet ? 860 : isTablet ? 720 : undefined

  // 水平 padding: 手机 16; 平板 = 多余空间 / 2, 至少 24
  const hPadding = isTablet
    ? Math.max(24, (width - (maxContent ?? width)) / 2)
    : 16

  // 网格列数
  let gridCols = 2
  if (isLargeTablet) gridCols = 4
  else if (isTablet) gridCols = 3

  return {
    width,
    height,
    isTablet,
    isLargeTablet,
    isLandscape,
    maxContent,
    gridCols,
    hPadding,
  }
}
