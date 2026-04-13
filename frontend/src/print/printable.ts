import type { Mistake, PracticeSet } from '../api'

export type PrintableMode = 'questions' | 'answers' | 'combined'

type PrintableEntry = {
  label: string
  subject: string
  source: string
  prompt: string
  answer: string
  meta: string[]
}

type PrintableSection = {
  title: string
  entries: PrintableEntry[]
}

export type PrintablePayload = {
  title: string
  sections: PrintableSection[]
}

function joinLines(lines: Array<string | null | undefined | false>) {
  return lines.filter(Boolean).join('\n')
}

function fromMistake(m: Mistake, index: number, includeSolutions: boolean): PrintableEntry {
  return {
    label: `错题 ${index + 1}`,
    subject: m.subject,
    source: m.exam_name || '错题本',
    prompt: joinLines([
      m.question_text,
      m.knowledge_point ? `知识点：${m.knowledge_point}` : '',
      '',
      '作答区：',
      '\n\n\n',
    ]),
    answer: joinLines([
      m.correct_answer ? `正确答案：${m.correct_answer}` : '',
      `错因：${m.reason}`,
      includeSolutions && m.solution_steps ? `解析：${m.solution_steps}` : '',
    ]),
    meta: [m.reason, m.knowledge_point || ''],
  }
}

function fromPracticeItem(
  item: PracticeSet['items'][number],
  set: PracticeSet,
  index: number,
  includeSolutions: boolean
): PrintableEntry {
  return {
    label: `训练 ${index + 1}`,
    subject: set.subject || '训练',
    source: set.title,
    prompt: joinLines([
      item.question_text,
      '',
      '作答区：',
      '\n\n\n',
    ]),
    answer: joinLines([
      item.expected_answer ? `参考答案：${item.expected_answer}` : '',
      includeSolutions && item.solution_steps ? `解析：${item.solution_steps}` : '',
    ]),
    meta: [set.knowledge_point || '', item.difficulty || ''],
  }
}

export function buildPrintablePayload(params: {
  title: string
  mode: PrintableMode
  includeSolutions: boolean
  mistakes: Mistake[]
  practiceSets: PracticeSet[]
}): PrintablePayload {
  const entries = [
    ...params.mistakes.map((m, index) => fromMistake(m, index, params.includeSolutions)),
    ...params.practiceSets.flatMap((set) =>
      set.items.map((item, index) => fromPracticeItem(item, set, index, params.includeSolutions))
    ),
  ]

  const sections: PrintableSection[] = []
  if (params.mode !== 'answers') {
    sections.push({
      title: '题目册',
      entries,
    })
  }
  if (params.mode !== 'questions') {
    sections.push({
      title: '答案册',
      entries,
    })
  }

  return { title: params.title, sections }
}

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderEntry(entry: PrintableEntry, isAnswerSection: boolean) {
  const content = isAnswerSection ? entry.answer : entry.prompt
  return `
    <article class="entry">
      <div class="entry-head">
        <div>
          <div class="entry-label">${escapeHtml(entry.label)}</div>
          <div class="entry-subject">${escapeHtml(entry.subject)} · ${escapeHtml(entry.source)}</div>
        </div>
        <div class="entry-meta">${escapeHtml(entry.meta.filter(Boolean).join(' · '))}</div>
      </div>
      <pre class="entry-body">${escapeHtml(content)}</pre>
    </article>
  `
}

export function buildPrintableDocument(payload: PrintablePayload) {
  const sectionHtml = payload.sections
    .map(
      (section) => `
        <section class="section">
          <header class="section-head">
            <h1>${escapeHtml(payload.title)}</h1>
            <h2>${escapeHtml(section.title)}</h2>
          </header>
          ${section.entries
            .map((entry) => renderEntry(entry, section.title.includes('答案')))
            .join('')}
        </section>
      `
    )
    .join('')

  return `<!doctype html>
  <html lang="zh-CN">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(payload.title)}</title>
      <style>
        @page { size: A4; margin: 12mm; }
        body { font-family: "PingFang SC", "Noto Serif SC", serif; color: #0f172a; margin: 0; }
        .section { page-break-after: always; padding: 4mm 0; }
        .section:last-child { page-break-after: auto; }
        .section-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #cbd5e1; padding-bottom: 4mm; margin-bottom: 6mm; }
        .section-head h1, .section-head h2 { margin: 0; }
        .section-head h1 { font-size: 20px; }
        .section-head h2 { font-size: 14px; color: #475569; }
        .entry { break-inside: avoid; border: 1px solid #cbd5e1; border-radius: 10px; padding: 4mm; margin-bottom: 5mm; }
        .entry-head { display: flex; justify-content: space-between; gap: 4mm; margin-bottom: 3mm; }
        .entry-label { font-size: 16px; font-weight: 700; }
        .entry-subject, .entry-meta { font-size: 11px; color: #475569; }
        .entry-body { white-space: pre-wrap; font-family: "PingFang SC", "Noto Serif SC", serif; font-size: 14px; line-height: 1.75; margin: 0; }
      </style>
    </head>
    <body>${sectionHtml}</body>
  </html>`
}

export function openPrintWindow(payload: PrintablePayload) {
  const html = buildPrintableDocument(payload)
  const win = window.open('', '_blank', 'noopener,noreferrer')
  if (!win) throw new Error('无法打开打印窗口')
  win.document.open()
  win.document.write(html)
  win.document.close()
  win.focus()
  win.print()
}
