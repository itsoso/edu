import { describe, expect, it } from 'vitest'
import {
  buildPrintableDocument,
  buildPrintablePayload,
  type PrintableMode,
} from './printable'
import type { Mistake, PracticeSet } from '../api'

const mistakes: Mistake[] = [
  {
    id: 1,
    subject: '数学',
    exam_name: '期中',
    question_text: '解方程 x + 3 = 8',
    wrong_answer: 'x=6',
    correct_answer: 'x=5',
    solution_steps: '两边同时减 3',
    reason: '计算错',
    knowledge_point: '一元一次方程',
    mastered: 0,
    created_at: '2026-04-13T10:00:00',
    mastered_at: null,
  },
]

const practiceSets: PracticeSet[] = [
  {
    id: 8,
    source_mistake_id: 1,
    title: '数学 · 一元一次方程',
    subject: '数学',
    knowledge_point: '一元一次方程',
    status: 'done',
    error_message: null,
    created_at: '2026-04-13T10:00:00',
    items: [
      {
        id: 11,
        set_id: 8,
        question_text: '解方程 x - 2 = 7',
        expected_answer: 'x=9',
        solution_steps: '两边同时加 2',
        difficulty: 'medium',
        student_answer: null,
        is_correct: null,
        score: null,
        feedback: null,
        graded_at: null,
      },
    ],
  },
]

function buildPayload(mode: PrintableMode) {
  return buildPrintablePayload({
    title: 'A4 打印',
    mode,
    includeSolutions: true,
    mistakes,
    practiceSets,
  })
}

describe('printable payload', () => {
  it('keeps questions and answers in separate sections for combined mode', () => {
    const payload = buildPayload('combined')

    expect(payload.sections).toHaveLength(2)
    expect(payload.sections[0].title).toContain('题目')
    expect(payload.sections[1].title).toContain('答案')
    expect(payload.sections[0].entries).toHaveLength(2)
    expect(payload.sections[1].entries).toHaveLength(2)
  })

  it('renders answers only mode without question-only section', () => {
    const payload = buildPayload('answers')

    expect(payload.sections).toHaveLength(1)
    expect(payload.sections[0].title).toContain('答案')
    expect(payload.sections[0].entries[0].answer).toContain('x=5')
  })

  it('renders an A4 printable document with mistake and practice titles', () => {
    const html = buildPrintableDocument(buildPayload('combined'))

    expect(html).toContain('A4 打印')
    expect(html).toContain('错题 1')
    expect(html).toContain('训练 1')
    expect(html).toContain('@page')
  })
})
