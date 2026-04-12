/**
 * SolutionSteps — 渲染详细解题过程.
 *
 * 输入: Markdown + LaTeX 混合文本 (AI 输出的 solution_steps)
 * 渲染: 每行检测 LaTeX $...$ → KaTeX, **加粗** → <b>, 其余原样
 *
 * 设计理由: 不引入完整 react-markdown (已在 vendor chunk),
 * 这里只需要 bold + 换行 + LaTeX 三种格式.
 */
import MathText from './MathText'

type Props = {
  steps: string
  className?: string
}

export default function SolutionSteps({ steps, className }: Props) {
  // 按换行拆, 每行单独渲染
  const lines = steps.split('\n')

  return (
    <div className={`space-y-2 text-sm leading-relaxed ${className || ''}`}>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        if (!trimmed) return <div key={i} className="h-1" /> // 空行
        return <StepLine key={i} line={trimmed} />
      })}
    </div>
  )
}

function StepLine({ line }: { line: string }) {
  // **加粗文字** → <b>
  // 先拆 bold 段
  const parts = splitBold(line)

  return (
    <div>
      {parts.map((part, i) =>
        part.bold ? (
          <b key={i} className="text-slate-900">
            <MathText text={part.text} />
          </b>
        ) : (
          <MathText key={i} text={part.text} className="text-slate-700" />
        )
      )}
    </div>
  )
}

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
  return parts
}
