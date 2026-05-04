/**
 * MathText — RN 版数学公式渲染.
 *
 * 复用 web 的切段/转 LaTeX 逻辑, 用 WebView + KaTeX (CDN) 渲染.
 * 没有数学信号时直接走 Text, 不起 WebView (性能考虑).
 *
 * 限制:
 *   - 每次渲染起一个 WebView, 不适合超长列表一行一个 (iOS WebView 启动 50-150ms).
 *   - 在错题/训练题目这种"块级内容"场景足够用.
 *   - 高度自测量通过 postMessage 回传.
 */
import React, { useMemo, useState } from 'react'
import { StyleSheet, Text, TextStyle, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { colors } from '../lib/theme'

type Props = {
  text: string
  style?: TextStyle
}

// ---------- 切段: 复用 web 的信号扩展法 ----------
const MATH_CHARS = /[a-zA-Z0-9√²³⁴⁵⁶⁷⁸⁹⁰+\-*/=<>≤≥≠≈±×÷^_()\[\]{},.\s]/
const MATH_SIGNAL = /[√²³⁴⁵⁶⁷⁸⁹⁰^=≤≥≠±×÷]/
const CJK = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/

type Seg = { text: string; isMath: boolean; isRawLatex?: boolean }

function splitByDollar(raw: string): Seg[] {
  const out: Seg[] = []
  const regex = /\$([^$]+)\$/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = regex.exec(raw)) !== null) {
    if (m.index > last) out.push({ text: raw.slice(last, m.index), isMath: false })
    out.push({ text: m[1], isMath: true, isRawLatex: true })
    last = regex.lastIndex
  }
  if (last < raw.length) out.push({ text: raw.slice(last), isMath: false })
  return out
}

function splitMathSegments(raw: string): Seg[] {
  if (raw.includes('$')) return splitByDollar(raw)
  if (!MATH_SIGNAL.test(raw)) return [{ text: raw, isMath: false }]

  const mask = new Array(raw.length).fill(false)
  for (let i = 0; i < raw.length; i++) {
    if (MATH_SIGNAL.test(raw[i])) {
      mask[i] = true
      for (let j = i - 1; j >= 0; j--) {
        if (MATH_CHARS.test(raw[j]) && !CJK.test(raw[j])) mask[j] = true
        else break
      }
      for (let j = i + 1; j < raw.length; j++) {
        if (MATH_CHARS.test(raw[j]) && !CJK.test(raw[j])) mask[j] = true
        else break
      }
    }
  }

  const segs: Seg[] = []
  let i = 0
  while (i < raw.length) {
    const m = mask[i]
    let j = i + 1
    while (j < raw.length && mask[j] === m) j++
    segs.push({ text: raw.slice(i, j), isMath: m })
    i = j
  }
  return segs
}

function toLatex(expr: string): string {
  let s = expr.trim()
  s = s.replace(/√[（(]([^)）]+)[)）]/g, (_, inner) => `\\sqrt{${toLatex(inner)}}`)
  s = s.replace(/√(\w+)/g, (_, inner) => `\\sqrt{${inner}}`)
  const sups: Record<string, string> = {
    '²': '2', '³': '3', '⁴': '4', '⁵': '5',
    '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9', '⁰': '0',
  }
  for (const [u, n] of Object.entries(sups)) {
    s = s.replace(new RegExp(u, 'g'), `^{${n}}`)
  }
  s = s.replace(/([a-zA-Z])(\d+)(?![}\d])/g, '$1_{$2}')
  s = s.replace(/×/g, '\\times ')
  s = s.replace(/÷/g, '\\div ')
  s = s.replace(/≤/g, '\\leq ')
  s = s.replace(/≥/g, '\\geq ')
  s = s.replace(/≠/g, '\\neq ')
  s = s.replace(/±/g, '\\pm ')
  s = s.replace(/≈/g, '\\approx ')
  return s
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildHtml(segs: Seg[], fontSize: number, color: string): string {
  // 转成 LaTeX 字符串, 用 KaTeX 在 WebView 里渲染
  const body = segs
    .map((seg) => {
      if (!seg.isMath) return `<span>${escapeHtml(seg.text)}</span>`
      const latex = seg.isRawLatex ? seg.text : toLatex(seg.text)
      // 不在这边 render, 让页面内 KaTeX 处理 class=katex-inline 的内容
      return `<span class="math">${escapeHtml(latex)}</span>`
    })
    .join('')

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<style>
  html, body { margin: 0; padding: 0; background: transparent; }
  body {
    font-size: ${fontSize}px;
    color: ${color};
    line-height: 1.55;
    font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
    padding: 2px 0;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .katex { font-size: 1.05em; }
</style>
</head>
<body>
<div id="content">${body}</div>
<script>
  function renderAll() {
    if (!window.katex) return setTimeout(renderAll, 50)
    document.querySelectorAll('.math').forEach(function (el) {
      try {
        katex.render(el.textContent, el, { throwOnError: false, displayMode: false })
      } catch (e) {}
    })
    requestAnimationFrame(function () {
      var h = document.body.scrollHeight
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(String(h))
      }
    })
  }
  document.addEventListener('DOMContentLoaded', renderAll)
  // 万一 DOMContentLoaded 已经触发
  if (document.readyState !== 'loading') renderAll()
</script>
</body>
</html>`
}

export default function MathText({ text, style }: Props) {
  const segs = useMemo(() => splitMathSegments(text), [text])
  const hasMath = segs.some((s) => s.isMath)

  const fontSize = (style?.fontSize as number) || 14
  const color = (style?.color as string) || colors.slate800

  const [height, setHeight] = useState(Math.max(24, fontSize * 1.6))

  // 没有数学, 直接走 Text — 完美内联渲染, 无 WebView 开销
  if (!hasMath) {
    return <Text style={style}>{text}</Text>
  }

  const html = buildHtml(segs, fontSize, color)

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        scrollEnabled={false}
        bounces={false}
        style={styles.web}
        javaScriptEnabled
        onMessage={(e) => {
          const h = parseInt(e.nativeEvent.data, 10)
          if (!isNaN(h) && h > 0 && Math.abs(h - height) > 2) setHeight(h + 4)
        }}
        showsVerticalScrollIndicator={false}
        showsHorizontalScrollIndicator={false}
        androidLayerType="hardware"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { width: '100%', backgroundColor: 'transparent' },
  web: { flex: 1, backgroundColor: 'transparent' },
})
