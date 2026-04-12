/**
 * SolutionSteps — 渲染 AI 输出的解题过程.
 *
 * 输入格式: Markdown + LaTeX 混合文本
 *   - **加粗标题**
 *   - $...$ 行内公式 (LaTeX)
 *   - 换行分步
 *
 * 渲染策略: 自己直接处理, 不经过 MathText 的信号扩展法.
 * 因为 AI 输出的 solution_steps 已经包含 $...$ 标记,
 * 不需要猜测哪些是数学——有 $ 的就是 LaTeX, 没有的就是文本.
 */
import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

type Props = {
  steps: string
  className?: string
}

export default function SolutionSteps({ steps, className }: Props) {
  const lines = steps.split('\n')
  return (
    <div className={`space-y-2 text-sm leading-relaxed ${className || ''}`}>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="h-1" />
        return <StepLine key={i} line={trimmed} />
      })}
    </div>
  )
}

/** 一行文本: 先拆 bold, 每段再拆 $...$, 最后渲染 */
function StepLine({ line }: { line: string }) {
  const rendered = useMemo(() => renderLine(line), [line])
  return <div>{rendered}</div>
}

function renderLine(line: string): JSX.Element[] {
  // Step 1: 拆 **bold**
  const boldParts = splitBold(line)
  const elements: JSX.Element[] = []

  for (let i = 0; i < boldParts.length; i++) {
    const part = boldParts[i]
    // Step 2: 每段拆 $...$
    const mathParts = splitDollar(part.text)

    for (let j = 0; j < mathParts.length; j++) {
      const mp = mathParts[j]
      const key = `${i}-${j}`
      if (mp.isLatex) {
        // 直接调 KaTeX, 不经过 toLatex
        try {
          const html = katex.renderToString(mp.text, {
            throwOnError: false,
            displayMode: false,
          })
          elements.push(
            part.bold ? (
              <b key={key} className="text-slate-900" dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <span key={key} dangerouslySetInnerHTML={{ __html: html }} />
            )
          )
        } catch {
          // KaTeX 彻底失败, 显示原文
          elements.push(
            <span key={key} className="text-red-600 font-mono text-xs">
              {`$${mp.text}$`}
            </span>
          )
        }
      } else {
        // 纯文本
        elements.push(
          part.bold ? (
            <b key={key} className="text-slate-900">{mp.text}</b>
          ) : (
            <span key={key} className="text-slate-700">{mp.text}</span>
          )
        )
      }
    }
  }
  return elements
}

/** 拆 **bold** 段 */
function splitBold(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = []
  const regex = /\*\*([^*]+)\*\*/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), bold: false })
    }
    parts.push({ text: match[1], bold: true })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), bold: false })
  }
  if (parts.length === 0) parts.push({ text, bold: false })
  return parts
}

/** 拆 $...$ 段. 简单直接: 非贪婪匹配 $...$. */
function splitDollar(text: string): { text: string; isLatex: boolean }[] {
  if (!text.includes('$')) {
    return [{ text, isLatex: false }]
  }
  const parts: { text: string; isLatex: boolean }[] = []
  const regex = /\$([^$]+)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index), isLatex: false })
    }
    parts.push({ text: match[1], isLatex: true })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), isLatex: false })
  }
  if (parts.length === 0) parts.push({ text, isLatex: false })
  return parts
}
