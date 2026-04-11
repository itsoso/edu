import { NavLink, Route, Routes, Navigate } from 'react-router-dom'
import clsx from 'clsx'
import Dashboard from './pages/Dashboard'
import Trends from './pages/Trends'
import Plan from './pages/Plan'
import ErrorBook from './pages/ErrorBook'
import Methods from './pages/Methods'
import Analysis from './pages/Analysis'

const navItems = [
  { to: '/', label: '今日', icon: '🏠', end: true },
  { to: '/trends', label: '趋势', icon: '📈' },
  { to: '/plan', label: '计划', icon: '📅' },
  { to: '/mistakes', label: '错题本', icon: '📓' },
  { to: '/methods', label: '方法卡', icon: '🎯' },
  { to: '/analysis', label: '分析', icon: '📄' },
]

export default function App() {
  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* 侧边栏 (桌面) / 顶栏 (移动) */}
      <aside className="md:w-56 md:min-h-screen bg-white border-r border-slate-200 md:sticky md:top-0">
        <div className="px-5 py-4 border-b border-slate-200">
          <div className="text-lg font-bold text-brand-700">立言学习系统</div>
          <div className="text-xs text-slate-500 mt-0.5">初二 · 冲前 30</div>
        </div>
        <nav className="flex md:flex-col overflow-x-auto md:overflow-visible">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2 px-5 py-3 text-sm whitespace-nowrap',
                  'hover:bg-brand-50',
                  isActive && 'bg-brand-50 text-brand-700 font-semibold border-l-4 border-brand-600 md:border-l-4 border-b-2 md:border-b-0'
                )
              }
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 主内容 */}
      <main className="flex-1 p-4 md:p-8 max-w-5xl">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/plan" element={<Plan />} />
          <Route path="/mistakes" element={<ErrorBook />} />
          <Route path="/methods" element={<Methods />} />
          <Route path="/analysis" element={<Analysis />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  )
}
