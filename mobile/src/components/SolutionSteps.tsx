import React, { useState } from 'react'
import { View, Text, Pressable, StyleSheet } from 'react-native'
import { colors } from '../lib/theme'
import MathText from './MathText'

type Props = {
  expectedAnswer?: string | null
  solutionSteps?: string | null
  /** 初始展开. 用于"看思路"按钮触发时自动张开. */
  defaultOpen?: boolean
}

/**
 * SolutionSteps — 移动端精简版.
 *
 * 对齐 web 的 SolutionSteps, 但暂不支持 LaTeX 渲染 (MVP).
 * 简单按行展示 solution_steps 文本, 以及 expected_answer.
 */
export default function SolutionSteps({
  expectedAnswer,
  solutionSteps,
  defaultOpen = false,
}: Props) {
  const [open, setOpen] = useState(defaultOpen)
  // 上层切换 defaultOpen 时跟随
  React.useEffect(() => {
    if (defaultOpen) setOpen(true)
  }, [defaultOpen])
  const hasAnything =
    (expectedAnswer && expectedAnswer.trim()) ||
    (solutionSteps && solutionSteps.trim())

  if (!hasAnything) return null

  const lines = (solutionSteps || '').split('\n')

  return (
    <View style={styles.wrap}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.header}>
        <Text style={styles.headerText}>
          {open ? '▼' : '▶'} 参考答案 / 解题步骤
        </Text>
      </Pressable>

      {open && (
        <View style={styles.body}>
          {expectedAnswer ? (
            <View style={styles.answerBox}>
              <Text style={styles.answerLabel}>标准答案</Text>
              <MathText text={expectedAnswer} style={styles.answerText} />
            </View>
          ) : null}

          {solutionSteps ? (
            <View style={styles.stepsBox}>
              <Text style={styles.stepsLabel}>解题步骤</Text>
              {lines.map((line, i) => {
                const trimmed = line.trim()
                if (!trimmed) return <View key={i} style={{ height: 6 }} />
                return (
                  <MathText
                    key={i}
                    text={trimmed}
                    style={styles.stepLine}
                  />
                )
              })}
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 8,
    backgroundColor: '#fafaf9',
  },
  header: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  headerText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#7c3aed',
  },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    gap: 10,
  },
  answerBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 6,
    padding: 10,
  },
  answerLabel: {
    fontSize: 11,
    color: colors.slate500,
    marginBottom: 4,
  },
  answerText: {
    fontSize: 14,
    color: colors.slate900,
    fontFamily: 'Menlo',
  },
  stepsBox: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: colors.divider,
    borderRadius: 6,
    padding: 10,
  },
  stepsLabel: {
    fontSize: 11,
    color: colors.slate500,
    marginBottom: 6,
  },
  stepLine: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.slate700,
    marginBottom: 2,
  },
})
