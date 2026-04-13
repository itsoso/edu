import { lazy, Suspense, useMemo, useState } from 'react'
import { NavLink, Route, Routes, Navigate, useLocation } from 'react-router-dom'
import clsx from 'clsx'
import { useAuth } from './auth'
import { useIsDesktop } from './hooks/useMediaQuery'
import { useInstallPrompt } from './hooks/useInstallPrompt'

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

const primaryNavItems = ['/', '/scan', '/mistakes', '/practice', '/trends']

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
  const isDesktop = useIsDesktop()
  const location = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const installPrompt = useInstallPrompt()

  const primaryItems = useMemo(
    () => navItems.filter((item) => primaryNavItems.includes(item.to)),
    []
  )
  const secondaryItems = useMemo(
    () => navItems.filter((item) => !primaryNavItems.includes(item.to)),
    []
  )

  const userLabel = user?.role === 'student'
    ? `${user.display_name} · ${user.stage || '-'}`
    : `家长视图 · ${boundStudent?.display_name || '-'}`

  return (
    <div className="app-shell min-h-screen bg-slate-50 text-slate-900">
      {!isDesktop && (
        <header className="mobile-topbar sticky top-0 z-30 border-b border-slate-200 bg-white/92 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <div className="text-lg font-bold text-brand-700">学习系统</div>
              <div className="truncate text-xs text-slate-500">{userLabel}</div>
            </div>
            <button
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex min-h-11 items-center justify-center rounded-full border border-slate-200 px-4 text-sm font-medium text-slate-700 shadow-sm"
              aria-expanded={menuOpen}
              aria-controls="mobile-more-panel"
            >
              更多
            </button>
          </div>
          {installPrompt.visible && (
            <div className="border-t border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <div className="mx-auto flex max-w-5xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>{installPrompt.message}</div>
                {installPrompt.actionLabel && installPrompt.onAction && (
                  <button
                    type="button"
                    onClick={installPrompt.onAction}
                    className="inline-flex min-h-11 items-center justify-center rounded-full bg-amber-500 px-4 font-medium text-white"
                  >
                    {installPrompt.actionLabel}
                  </button>
                )}
              </div>
            </div>
          )}
        </header>
      )}

      <div className="mx-auto flex min-h-screen max-w-7xl flex-col md:flex-row">
        {isDesktop && (
          <aside className="md:sticky md:top-0 md:flex md:min-h-screen md:w-60 md:flex-col md:border-r md:border-slate-200 md:bg-white">
            <div className="px-5 py-5 border-b border-slate-200">
              <div className="text-lg font-bold text-brand-700">学习系统</div>
              <div className="text-xs text-slate-500 mt-0.5">{userLabel}</div>
            </div>
            <nav aria-label="主导航" className="flex md:flex-1 md:flex-col md:overflow-visible">
              {navItems.map((item) => (
                <ShellNavLink key={item.to} item={item} desktop />
              ))}
            </nav>
            <div className="px-5 py-3 border-t border-slate-200">
              <button
                onClick={logout}
                className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm text-slate-600 transition hover:border-red-200 hover:text-red-600"
              >
                退出登录
              </button>
            </div>
          </aside>
        )}

        <main className="main-shell flex-1 px-4 py-4 md:px-8 md:py-8">
          {!isDesktop && menuOpen && (
            <div className="mb-4 rounded-3xl border border-slate-200 bg-white p-3 shadow-lg" id="mobile-more-panel">
              <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                更多功能
              </div>
              <nav aria-label="更多功能" className="grid grid-cols-2 gap-2">
                {secondaryItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      clsx(
                        'flex min-h-16 flex-col justify-center rounded-2xl border px-3 py-3 text-left text-sm',
                        isActive
                          ? 'border-brand-300 bg-brand-50 text-brand-700'
                          : 'border-slate-200 bg-slate-50 text-slate-700'
                      )
                    }
                  >
                    <span className="text-lg">{item.icon}</span>
                    <span className="mt-1 font-medium">{item.label}</span>
                  </NavLink>
                ))}
              </nav>
              <button
                onClick={logout}
                className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl border border-red-200 bg-red-50 px-4 text-sm font-medium text-red-600"
              >
                退出登录
              </button>
            </div>
          )}

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

      {!isDesktop && (
        <>
          {menuOpen && (
            <button
              type="button"
              aria-label="关闭更多菜单"
              className="fixed inset-0 z-20 bg-slate-900/20"
              onClick={() => setMenuOpen(false)}
            />
          )}
          <nav
            aria-label="主导航"
            className="mobile-bottom-nav fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/96 backdrop-blur"
          >
            <div className="mx-auto grid max-w-5xl grid-cols-6 gap-1 px-2 py-2">
              {primaryItems.map((item) => (
                <ShellNavLink key={item.to} item={item} compact onNavigate={() => setMenuOpen(false)} />
              ))}
              <button
                type="button"
                onClick={() => setMenuOpen((open) => !open)}
                className={clsx(
                  'flex min-h-14 flex-col items-center justify-center rounded-2xl text-[11px] font-medium',
                  menuOpen || secondaryItems.some((item) => item.to === location.pathname)
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-500'
                )}
              >
                <span className="text-lg leading-none">☰</span>
                <span className="mt-1">更多</span>
              </button>
            </div>
          </nav>
        </>
      )}
    </div>
  )
}

function ShellNavLink({
  item,
  desktop = false,
  compact = false,
  onNavigate,
}: {
  item: { to: string; label: string; icon: string; end?: boolean }
  desktop?: boolean
  compact?: boolean
  onNavigate?: () => void
}) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        clsx(
          compact
            ? 'flex min-h-14 flex-col items-center justify-center rounded-2xl text-[11px] font-medium'
            : 'flex items-center gap-3 px-5 py-3 text-sm whitespace-nowrap transition',
          compact
            ? isActive
              ? 'bg-brand-50 text-brand-700'
              : 'text-slate-500'
            : isActive
              ? desktop
                ? 'border-l-4 border-brand-600 bg-brand-50 font-semibold text-brand-700'
                : 'border-b-2 border-brand-600 bg-brand-50 font-semibold text-brand-700'
              : 'text-slate-600 hover:bg-brand-50'
        )
      }
    >
      <span className={compact ? 'text-lg leading-none' : ''}>{item.icon}</span>
      <span>{item.label}</span>
    </NavLink>
  )
}
