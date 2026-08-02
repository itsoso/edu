import { render, screen } from '@testing-library/react'
import Trends from './Trends'

const apiMocks = vi.hoisted(() => ({
  listExams: vi.fn(),
  latestExamInsight: vi.fn(),
  createExam: vi.fn(),
  deleteExam: vi.fn(),
  upsertReflection: vi.fn(),
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: {
      ...actual.api,
      listExams: apiMocks.listExams,
      latestExamInsight: apiMocks.latestExamInsight,
      createExam: apiMocks.createExam,
      deleteExam: apiMocks.deleteExam,
      upsertReflection: apiMocks.upsertReflection,
    },
  }
})

vi.mock('../hooks/useMediaQuery', () => ({
  useIsDesktop: () => true,
}))

vi.mock('recharts', () => ({
  CartesianGrid: () => null,
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}))

describe('Trends latest exam insight', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.listExams.mockResolvedValue([
      {
        id: 1,
        exam_name: '4月月考',
        exam_date: '2026-04-30',
        stage: '初二下',
        total: 558.5,
        class_rank: null,
        grade_rank: 48,
        notes: null,
        sort_order: 1,
        scores: { 语文: 103.5, 数学: 106, 英语: 111, 科学: 143, 社会: 95 },
        score_ranks: { 语文: 42, 数学: 110, 英语: 36, 科学: 55, 社会: 42 },
      },
      {
        id: 2,
        exam_name: '初二期末考试',
        exam_date: '2026-06-30',
        stage: '初二下',
        total: 569,
        class_rank: null,
        grade_rank: 56,
        notes: null,
        sort_order: 2,
        scores: { 语文: 109.5, 数学: 112.5, 英语: 118, 科学: 141, 社会: 88 },
        score_ranks: { 语文: 18, 数学: 95, 英语: 21, 科学: 74, 社会: 112 },
      },
    ])
    apiMocks.latestExamInsight.mockResolvedValue({
      exists: true,
      latest_exam: {
        id: 2,
        exam_name: '初二期末考试',
        exam_date: '2026-06-30',
        stage: '初二下',
        total: 569,
        grade_rank: 56,
      },
      previous_exam: {
        id: 1,
        exam_name: '4月月考',
        exam_date: '2026-04-30',
        stage: '初二下',
        total: 558.5,
        grade_rank: 48,
      },
      summary: '初二期末考试 后, 优先修复 社会; 总分 569, 年级排名 56.',
      focus_subjects: [
        {
          subject: '社会',
          latest_score: 88,
          full_mark: 100,
          score_rate: 88,
          subject_rank: 112,
          delta_from_previous: -7,
          gap_score: 89,
          recommendation: '先做社会框架梳理, 再练主观题关键词',
        },
        {
          subject: '科学',
          latest_score: 141,
          full_mark: 150,
          score_rate: 94,
          subject_rank: 74,
          delta_from_previous: -2,
          gap_score: 26,
          recommendation: '优先修复实验题、图像题和综合推理题',
        },
        {
          subject: '数学',
          latest_score: 112.5,
          full_mark: 120,
          score_rate: 93.8,
          subject_rank: 95,
          delta_from_previous: 6.5,
          gap_score: 27,
          recommendation: '用限时训练稳住高分段正确率',
        },
      ],
      strengths: [
        {
          subject: '语文',
          latest_score: 109.5,
          full_mark: 120,
          score_rate: 91.3,
          subject_rank: 18,
          delta_from_previous: 6,
          gap_score: 0,
          recommendation: '保持阅读和作文手感, 不抢主攻时间',
        },
      ],
    })
  })

  it('surfaces the latest exam repair priorities with subject-rank evidence', async () => {
    render(<Trends />)

    expect(await screen.findByText('初二期末考试复盘')).toBeInTheDocument()
    expect(screen.getByText('先修复：社会')).toBeInTheDocument()
    expect(screen.getByText('单科排名 112')).toBeInTheDocument()
    expect(screen.getByText('先做社会框架梳理, 再练主观题关键词')).toBeInTheDocument()
    expect(screen.getAllByText('科学').length).toBeGreaterThan(0)
    expect(screen.getAllByText('数学').length).toBeGreaterThan(0)
    expect(apiMocks.latestExamInsight).toHaveBeenCalled()
  })
})
