import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Dashboard from './Dashboard'

const mockUseAuth = vi.fn()

const apiMocks = vi.hoisted(() => ({
  dashboardSummary: vi.fn(),
  getGuardianAlerts: vi.fn(),
  dailyTip: vi.fn(),
  listTasks: vi.fn(),
  listCheckins: vi.fn(),
  listReflections: vi.fn(),
}))

vi.mock('../auth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('../api', async () => {
  const actual = await vi.importActual<typeof import('../api')>('../api')
  return {
    ...actual,
    api: {
      ...actual.api,
      dashboardSummary: apiMocks.dashboardSummary,
      getGuardianAlerts: apiMocks.getGuardianAlerts,
      dailyTip: apiMocks.dailyTip,
      listTasks: apiMocks.listTasks,
      listCheckins: apiMocks.listCheckins,
      listReflections: apiMocks.listReflections,
    },
  }
})

vi.mock('../components/WeekendCoursesCard', () => ({
  default: () => null,
}))

vi.mock('../components/CoachWeekCard', () => ({
  default: () => null,
}))

describe('Parent dashboard focus summary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiMocks.dailyTip.mockResolvedValue({})
    apiMocks.listTasks.mockResolvedValue([])
    apiMocks.listCheckins.mockResolvedValue([])
    apiMocks.listReflections.mockResolvedValue([])
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {
        id: 2,
        username: 'mom',
        display_name: '妈妈',
        role: 'parent',
        student_id: 1,
      },
      boundStudent: {
        id: 1,
        display_name: '李妍',
      },
      logout: vi.fn(),
    })
  })

  it('shows risk, progress and a suggested parent prompt', async () => {
    apiMocks.dashboardSummary.mockResolvedValue({
      streak_days: 2,
      month_checkins: 8,
      month_distinct_days: 5,
      practice: { total: 6, graded: 6, correct: 2 },
      mistakes: { total: 10, mastered: 3 },
      calendar_14d: [],
      today: '2026-05-17',
    })
    apiMocks.getGuardianAlerts.mockResolvedValue([
      { id: 1, severity: 'high', title: '连续两天没复盘', message: '需要轻提醒' },
    ])

    render(
      <MemoryRouter initialEntries={['/']}>
        <Dashboard />
      </MemoryRouter>
    )

    expect(await screen.findByText('今天最值得看')).toBeInTheDocument()
    await waitFor(() => {
      expect(apiMocks.dashboardSummary).toHaveBeenCalled()
    })
    expect(screen.getByText('当前风险')).toBeInTheDocument()
    expect(screen.getByText('这周进展')).toBeInTheDocument()
    expect(screen.getByText('今晚可以怎么聊')).toBeInTheDocument()
  })
})
