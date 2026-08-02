import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import App from './App'

const mockUseAuth = vi.fn()

vi.mock('./auth', () => ({
  useAuth: () => mockUseAuth(),
}))

vi.mock('./pages/Dashboard', () => ({
  default: () => <div>Dashboard Page</div>,
}))

vi.mock('./pages/Login', () => ({
  default: () => <div>Login Page</div>,
}))

vi.mock('./pages/Register', () => ({
  default: () => <div>Register Page</div>,
}))

vi.mock('./pages/Trends', () => ({
  default: () => <div>Trends Page</div>,
}))

vi.mock('./pages/GrowthHome', () => ({
  default: () => <div>Growth Home Page</div>,
}))

vi.mock('./pages/MyHome', () => ({
  default: () => <div>My Home Page</div>,
}))

vi.mock('./pages/Plan', () => ({
  default: () => <div>Plan Page</div>,
}))

vi.mock('./pages/ErrorBook', () => ({
  default: () => <div>ErrorBook Page</div>,
}))

vi.mock('./pages/Methods', () => ({
  default: () => <div>Methods Page</div>,
}))

vi.mock('./pages/Analysis', () => ({
  default: () => <div>Analysis Page</div>,
}))

vi.mock('./pages/Scan', () => ({
  default: () => <div>Scan Page</div>,
}))

vi.mock('./pages/Practice', () => ({
  default: () => <div>Practice Page</div>,
}))

vi.mock('./pages/Reports', () => ({
  default: () => <div>Reports Page</div>,
}))

vi.mock('./pages/Settings', () => ({
  default: () => <div>Settings Page</div>,
}))

vi.mock('./pages/Journal', () => ({
  default: () => <div>Journal Page</div>,
}))

vi.mock('./pages/Essays', () => ({
  default: () => <div>Essays Page</div>,
}))

function setViewport(width: number) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(min-width: 768px)' ? width >= 768 : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

describe('App shell', () => {
  beforeEach(() => {
    setViewport(820)
    mockUseAuth.mockReturnValue({
      loading: false,
      user: {
        id: 1,
        username: 'demo',
        display_name: '李妍',
        role: 'student',
        student_id: null,
        join_code: 'ABC123',
        stage: '初二下',
      },
      boundStudent: null,
      logout: vi.fn(),
    })
  })

  it('shows a compact touch navigation on narrow viewports', async () => {
    setViewport(700)

    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>
    )

    expect(await screen.findByText('Dashboard Page')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /更多/i }).length).toBeGreaterThan(0)
    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument()
    expect(screen.getByText('今日')).toBeInTheDocument()
    expect(screen.getByText('错题本')).toBeInTheDocument()
    expect(screen.getByText('训练')).toBeInTheDocument()
    expect(screen.getByText('成长')).toBeInTheDocument()
    expect(screen.getByText('我的')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '退出登录' })).not.toBeInTheDocument()
  })
})
