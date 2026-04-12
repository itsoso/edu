/**
 * MathText — 自动检测并渲染数学公式的文本组件.
 *
 * 处理逻辑:
 * 1. 检测 LaTeX 分隔符: $...$ 或 \(...\) → 行内公式
 * 2. 检测常见数学 Unicode: √, ², ³ 等 → 转成 LaTeX 再渲染
 * 3. 检测 AI 输出的伪数学: sqrt(xxx), x^2 等 → 转成 LaTeX
 * 4. 纯文本不做任何改动, 原样显示
 *
 * 用法:
 *   <MathText text="若√(bx1-x2)+√(bx2-cx1)=0" />
 *   <MathText text="解方程: $2x+5=15$" />
 */
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

type Props = {
  text: string
  className?: string
}

/**
 * 把常见的"伪数学"文本转成 LaTeX 包裹的混合内容.
 *
 * 策略:
 * - 如果已有 $...$ 分隔符, 直接用
 * - 如果有 √ / ² / ³ / ^, 尝试整段转 LaTeX
 * - 否则原样返回
 */
function preprocessMath(raw: string): string {
  // 已经有 LaTeX 分隔符, 不处理
  if (raw.includes('$') || raw.includes('\\(')) return raw

  // 没有数学符号, 不处理
  if (!/[√²³⁴⁵⁶⁷⁸⁹⁰∑∫∞±×÷≤≥≠≈∈∉∪∩⊂⊃]/.test(raw) && !/\^|\bsqrt\b/.test(raw)) {
    return raw
  }

  // 有数学符号 → 逐段转换
  // 把 √(expr) 转成 $\sqrt{expr}$
  let result = raw.replace(/√\(([^)]+)\)/g, (_, inner) => {
    const latex = toLatex(inner)
    return `$\\sqrt{${latex}}$`
  })
  // 独立的 √x → $\sqrt{x}$
  result = result.replace(/√(\w+)/g, (_, inner) => `$\\sqrt{${inner}}$`)

  // x² → $x^{2}$
  const superscripts: Record<string, string> = {
    '²': '2', '³': '3', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁰': '0',
  }
  for (const [sup, num] of Object.entries(superscripts)) {
    result = result.replace(new RegExp(`(\\w)${sup}`, 'g'), `$$$1^{${num}}$$`)
  }

  // sqrt(expr) → $\sqrt{expr}$
  result = result.replace(/\bsqrt\(([^)]+)\)/gi, (_, inner) => {
    const latex = toLatex(inner)
    return `$\\sqrt{${latex}}$`
  })

  return result
}

/** 简单的表达式 → LaTeX 转换 (处理变量下标等) */
function toLatex(expr: string): string {
  let s = expr
  // x1 → x_1, x2 → x_2 (单字母 + 数字 → 下标)
  s = s.replace(/([a-zA-Z])(\d+)/g, '$1_{$2}')
  // ** → ^
  s = s.replace(/\*\*/g, '^')
  return s
}

/** 渲染混合内容: $...$围起来的部分用 KaTeX, 其余原样 */
function renderMixed(text: string): (string | { html: string })[] {
  const parts: (string | { html: string })[] = []
  // 匹配 $...$ (非贪婪)
  const regex = /\$([^$]+)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    try {
      const html = katex.renderToString(match[1], {
        throwOnError: false,
        displayMode: false,
      })
      parts.push({ html })
    } catch {
      parts.push(match[0]) // KaTeX 解析失败, 原样显示
    }
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export default function MathText({ text, className }: Props) {
  const processed = useMemo(() => preprocessMath(text), [text])
  const parts = useMemo(() => renderMixed(processed), [processed])

  // 如果没有任何 KaTeX 部分, 纯文本渲染 (零开销)
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
