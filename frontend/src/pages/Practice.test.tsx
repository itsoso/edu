import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Practice from './Practice'

const apiMocks = vi.hoisted(() => ({
  listPracticeSets: vi.fn(),
  listPracticeTags: vi.fn(),
  getPracticeSet: vi.fn(),
  gradePracticeItem: vi.fn(),
  getNextAction: vi.fn(),
  deletePracticeSet: vi.fn(),
  updatePracticeSetTags: vi.fn(),
}))

const signalMocks = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: {
      ...actual.api,
      listPracticeSets: apiMocks.listPracticeSets,
      listPracticeTags: apiMocks.listPracticeTags,
      getPracticeSet: apiMocks.getPracticeSet,
      gradePracticeItem: apiMocks.gradePracticeItem,
      getNextAction: apiMocks.getNextAction,
      deletePracticeSet: apiMocks.deletePracticeSet,
      updatePracticeSetTags: apiMocks.updatePracticeSetTags,
    },
  }
})

vi.mock('../lib/signals', () => ({
  default: {
    track: signalMocks.track,
  },
}))

vi.mock('../hooks/usePolling', () => ({
  usePolling: vi.fn(),
}))

vi.mock('../components/EmptyState', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}))

vi.mock('../components/MathText', () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}))

vi.mock('../components/SolutionSteps', () => ({
  default: ({ steps }: { steps: string }) => <div>{steps}</div>,
}))

vi.mock('../components/PrintPanel', () => ({
  default: () => null,
}))

vi.mock('../components/ReflectionPrompt', () => ({
  default: () => null,
}))

describe('Practice next-step flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listPracticeTags.mockResolvedValue([])
    apiMocks.deletePracticeSet.mockResolvedValue({ ok: true })
    apiMocks.updatePracticeSetTags.mockResolvedValue(null)
  })

  it('shows a clear next-step CTA after finishing the last practice item', async () => {
    apiMocks.listPracticeSets.mockResolvedValue([
      {
        id: 1,
        title: '数学 · 方程训练',
        subject: '数学',
        knowledge_point: '一元一次方程',
        status: 'done',
        error_message: null,
        created_at: '2026-05-17T10:00:00',
        item_count: 1,
        graded_count: 0,
        correct_count: 0,
        tags: [],
        items: [],
      },
    ])
    apiMocks.getPracticeSet.mockResolvedValue({
      id: 1,
      title: '数学 · 方程训练',
      subject: '数学',
      knowledge_point: '一元一次方程',
      status: 'done',
      error_message: null,
      created_at: '2026-05-17T10:00:00',
      item_count: 1,
      graded_count: 0,
      correct_count: 0,
      tags: [],
      items: [
        {
          id: 11,
          set_id: 1,
          question_text: '解方程 2x=6',
          expected_answer: 'x=3',
          solution_steps: '两边同时除以 2',
          difficulty: 'easy',
          student_answer: null,
          is_correct: null,
          score: null,
          feedback: null,
          graded_at: null,
        },
      ],
    })
    apiMocks.gradePracticeItem.mockResolvedValue({
      id: 11,
      set_id: 1,
      question_text: '解方程 2x=6',
      expected_answer: 'x=3',
      solution_steps: '两边同时除以 2',
      difficulty: 'easy',
      student_answer: 'x=3',
      is_correct: 1,
      score: 100,
      feedback: '这题已经稳了',
      graded_at: '2026-05-17T10:05:00',
    })
    apiMocks.getNextAction.mockResolvedValue({
      exists: true,
      action: {
        kind: 'task',
        title: '去做今日任务',
        description: '数学 · 先做 15 分钟',
        cta_label: '去完成',
        cta_path: '/assignments',
      },
    })

    render(
      <MemoryRouter initialEntries={['/practice']}>
        <Practice />
      </MemoryRouter>
    )

    expect(await screen.findByPlaceholderText('在这里写你的作答（可多行）')).toBeInTheDocument()

    fireEvent.change(screen.getByPlaceholderText('在这里写你的作答（可多行）'), {
      target: { value: 'x=3' },
    })
    fireEvent.click(screen.getByRole('button', { name: '提交作答' }))

    expect(await screen.findByText('做完这一组了')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /去完成/i })).toHaveAttribute('href', '/assignments')
    await waitFor(() => {
      expect(apiMocks.getNextAction).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(signalMocks.track).toHaveBeenCalledWith(
        'next_action.completed',
        expect.objectContaining({
          related_table: 'practice_sets',
          related_id: 1,
          payload: { source_kind: 'practice', target_kind: 'task' },
        })
      )
    })
  })
})
