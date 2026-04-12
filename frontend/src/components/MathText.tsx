/**
 * MathText — 自动检测并渲染数学公式的文本组件.
 *
 * 策略:
 * 1. 已有 $...$ LaTeX → 直接渲染
 * 2. 检测"数学片段" → 贪婪匹配连续数学字符 → 包成 $...$
 * 3. 纯中文/纯文本 → 不做任何处理
 *
 * "数学片段"定义:
 *   以 √ / 字母 / 数字 / ( 开头, 后续包含运算符 (+−×÷=≤≥≠<>^)
 *   或 √ / ² ³ 等数学标记的连续序列.
 *
 * 用法:
 *   <MathText text="若√(bx1-x2)+√(bx2-cx1)=0" />
 *   <MathText text="bx²+(4b-3)x+3(b-3)=0" />
 */
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

type Props = {
  text: string
  className?: string
}

// 数学字符集: 能出现在数学表达式里的字符
const MATH_CHARS = /[a-zA-Z0-9√²³⁴⁵⁶⁷⁸⁹⁰+\-*/=<>≤≥≠≈±×÷^_()\[\]{},.\s]/
const MATH_SIGNAL = /[√²³⁴⁵⁶⁷⁸⁹⁰^=≤≥≠±×÷]/  // 表明"这是数学不是普通文字"的信号字符

/**
 * 把含数学的文本拆成 [文本段, 数学段, 文本段, ...].
 *
 * 核心策略: 找到"数学信号字符" → 向左右扩展到连续数学字符的边界 → 整段标记为数学.
 * 没有信号字符的纯字母数字不会被误判为数学.
 */
function splitMathSegments(raw: string): { text: string; isMath: boolean; isRawLatex?: boolean }[] {
  // 如果已有 $...$ 分隔符, 用它. 标记 isRawLatex=true 表示已经是 LaTeX, 不需要 toLatex()
  if (raw.includes('$')) {
    return splitByDollar(raw).map((s) => ({
      ...s,
      isRawLatex: s.isMath, // $...$ 里的内容已经是 LaTeX
    }))
  }

  // 没有任何数学信号, 纯文本
  if (!MATH_SIGNAL.test(raw)) {
    return [{ text: raw, isMath: false }]
  }

  // 找所有数学信号字符的位置, 向左右扩展
  const isMathChar = new Array(raw.length).fill(false)

  for (let i = 0; i < raw.length; i++) {
    if (MATH_SIGNAL.test(raw[i])) {
      // 标记这个位置及其左右连续的数学字符
      isMathChar[i] = true
      // 向左扩展
      for (let j = i - 1; j >= 0; j--) {
        if (MATH_CHARS.test(raw[j]) && !/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(raw[j])) {
          isMathChar[j] = true
        } else break
      }
      // 向右扩展
      for (let j = i + 1; j < raw.length; j++) {
        if (MATH_CHARS.test(raw[j]) && !/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(raw[j])) {
          isMathChar[j] = true
        } else break
      }
    }
  }

  // 合并连续段
  const segments: { text: string; isMath: boolean }[] = []
  let i = 0
  while (i < raw.length) {
    const math = isMathChar[i]
    let j = i + 1
    while (j < raw.length && isMathChar[j] === math) j++
    const chunk = raw.slice(i, j).trim()
    if (chunk) {
      segments.push({ text: raw.slice(i, j), isMath: math })
    } else {
      segments.push({ text: raw.slice(i, j), isMath: false })
    }
    i = j
  }
  return segments
}

function splitByDollar(raw: string): { text: string; isMath: boolean }[] {
  const segments: { text: string; isMath: boolean }[] = []
  const regex = /\$([^$]+)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: raw.slice(lastIndex, match.index), isMath: false })
    }
    segments.push({ text: match[1], isMath: true })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < raw.length) {
    segments.push({ text: raw.slice(lastIndex), isMath: false })
  }
  return segments
}

/**
 * 把伪数学文本转成 LaTeX.
 * √(expr) → \sqrt{expr}
 * x1 → x_{1}
 * ² → ^{2}
 * bx² → bx^{2}
 */
function toLatex(expr: string): string {
  let s = expr.trim()

  // √(expr) → \sqrt{expr}  (支持中英文括号)
  s = s.replace(/√[（(]([^)）]+)[)）]/g, (_, inner) => `\\sqrt{${toLatex(inner)}}`)
  // 独立 √x → \sqrt{x}
  s = s.replace(/√(\w+)/g, (_, inner) => `\\sqrt{${inner}}`)

  // 上标 Unicode
  const superscripts: Record<string, string> = {
    '²': '2', '³': '3', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁰': '0',
  }
  for (const [sup, num] of Object.entries(superscripts)) {
    s = s.replace(new RegExp(sup, 'g'), `^{${num}}`)
  }

  // 变量下标: x1 → x_{1}, 但不影响纯数字如 123
  s = s.replace(/([a-zA-Z])(\d+)(?![}\d])/g, '$1_{$2}')

  // ×→\times  ÷→\div  ≤→\leq  ≥→\geq  ≠→\neq  ±→\pm
  s = s.replace(/×/g, '\\times ')
  s = s.replace(/÷/g, '\\div ')
  s = s.replace(/≤/g, '\\leq ')
  s = s.replace(/≥/g, '\\geq ')
  s = s.replace(/≠/g, '\\neq ')
  s = s.replace(/±/g, '\\pm ')
  s = s.replace(/≈/g, '\\approx ')

  return s
}

function renderSegments(
  segments: { text: string; isMath: boolean; isRawLatex?: boolean }[]
): (string | { html: string })[] {
  return segments.map((seg) => {
    if (!seg.isMath) return seg.text
    // isRawLatex: $...$ 里已经是 LaTeX, 直接给 KaTeX, 不经过 toLatex()
    // 否则 (信号扩展法匹配的伪数学): 需要 toLatex() 转换
    const latex = seg.isRawLatex ? seg.text : toLatex(seg.text)
    try {
      const html = katex.renderToString(latex, {
        throwOnError: false,
        displayMode: false,
      })
      return { html }
    } catch {
      // KaTeX 解析失败, 返回原文本 (带 $ 分隔符以便用户看到是公式)
      return seg.isRawLatex ? `$${seg.text}$` : seg.text
    }
  })
}

export default function MathText({ text, className }: Props) {
  const parts = useMemo(() => {
    const segments = splitMathSegments(text)
    return renderSegments(segments)
  }, [text])

  const hasMath = parts.some((p) => typeof p !== 'string')
  if (!hasMath) {
    return <span className={className}>{text}</span>
  }

  return (
    <span className={className}>
      {parts.map((part, i) =>
        typeof part === 'string' ? (
          <span key={i}>{part}</span>
        ) : (
          <span key={i} dangerouslySetInnerHTML={{ __html: part.html }} />
        )
      )}
    </span>
  )
}
