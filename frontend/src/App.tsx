import { lazy, Suspense } from 'react'
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from './auth'

// Dashboard 作为首页保持同步加载, 保证首屏最快
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Register from './pages/Register'

// 其余页面按需加载 (Recharts / ReactMarkdown 等大依赖会被拆到独立 chunk)
const Trends = lazy(() => import('./pages/Trends'))
const Plan = lazy(() => import('./pages/Plan'))
const ErrorBook = lazy(() => import('./pages/ErrorBook'))
const Methods = lazy(() => import('./pages/Methods'))
const Analysis = lazy(() => import('./pages/Analysis'))
const Scan = lazy(() => import('./pages/Scan'))
const Practice = lazy(() => import('./pages/Practice'))
const Reports = lazy(() => import('./pages/Reports'))
const Settings = lazy(() => import('./pages/Settings'))
const Journal = lazy(() => import('./pages/Journal'))
const Essays = lazy(() => import('./pages/Essays'))

const navItems = [
  { to: '/', label: '今日', icon: '🏠', end: true },
  { to: '/journal', label: '日记', icon: '🕊️' },
  { to: '/mistakes', label: '错题本', icon: '📓' },
  { to: '/essays', label: '作文', icon: '📝' },
  { to: '/scan', label: '扫试卷', icon: '📸' },
  { to: '/practice', label: '训练', icon: '🏋️' },
  { to: '/trends', label: '趋势', icon: '📈' },
  { to: '/plan', label: '计划', icon: '📅' },
  { to: '/reports', label: '月度复盘', icon: '🧠' },
  { to: '/methods', label: '方法卡', icon: '🎯' },
  { to: '/analysis', label: '分析', icon: '📄' },
  { to: '/settings', label: '设置', icon: '⚙️' },
]

export default function App() {
  const { loading } = useAuth()
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        加载中...
      </div>
    )
  }
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
      <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
      <Route path="/*" element={<Protected><Shell /></Protected>} />
    </Routes>
  )
}

function Protected({ children }: { children: JSX.Element }) {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />
  return children
}

function PublicOnly({ children }: { children: JSX.Element }) {
  const { user } = useAuth()
  if (user) return <Navigate to="/" replace />
  return children
}

function PageLoading() {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-slate-400">
      <span className="animate-pulse">加载中...</span>
    </div>
  )
}

function Shell() {
  const { user, boundStudent, logout } = useAuth()
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <aside className="md:w-56 md:min-h-screen bg-white border-r border-slate-200 md:sticky md:top-0 flex md:flex-col flex-col">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-lg font-bold text-brand-700">学习系统</div>
          {user?.role === 'student' ? (
            <div className="text-xs text-slate-500 mt-0.5">
              {user.display_name} · {user.stage || '-'}
            </div>
          ) : (
            <div className="text-xs text-slate-500 mt-0.5">
              家长视图 · {boundStudent?.display_name || '-'}
            </div>
          )}
        </div>
        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible md:flex-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 px-5 py-3 text-sm whitespace-nowrap',
                  'hover:bg-brand-50',
                  isActive &&
                    'bg-brand-50 text-brand-700 font-semibold border-l-4 border-brand-600 md:border-l-4 border-b-2 md:border-b-0'
                )
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="px-5 py-3 border-t border-slate-200 hidden md:block">
          <button
            onClick={logout}
            className="w-full text-sm text-slate-600 hover:text-red-600 py-1.5"
          >
            退出登录
          </button>
        </div>
      </aside>

      <main className="flex-1 p-4 md:p-8 max-w-5xl">
        <Suspense fallback={<PageLoading />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/trends" element={<Trends />} />
            <Route path="/plan" element={<Plan />} />
            <Route path="/essays" element={<Essays />} />
            <Route path="/scan" element={<Scan />} />
            <Route path="/mistakes" element={<ErrorBook />} />
            <Route path="/practice" element={<Practice />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/methods" element={<Methods />} />
            <Route path="/analysis" element={<Analysis />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/journal" element={<Journal />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  )
}
