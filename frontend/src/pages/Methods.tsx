import { useState } from 'react'
import MdViewer from '../components/MdViewer'

const CARDS = [
  { key: 'method-math',    label: '数学',  icon: '🔢', color: 'bg-red-50 border-red-200 text-red-700' },
  { key: 'method-science', label: '科学',  icon: '🔬', color: 'bg-green-50 border-green-200 text-green-700' },
  { key: 'method-english', label: '英语',  icon: '🔤', color: 'bg-blue-50 border-blue-200 text-blue-700' },
  { key: 'method-chinese', label: '语文',  icon: '📖', color: 'bg-amber-50 border-amber-200 text-amber-700' },
  { key: 'method-social',  label: '社会',  icon: '🌏', color: 'bg-purple-50 border-purple-200 text-purple-700' },
  { key: 'habits',         label: '学习习惯', icon: '✨', color: 'bg-slate-100 border-slate-300 text-slate-700' },
]

export default function Methods() {
  const [active, setActive] = useState('method-math')
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">学习方法速查卡</h1>
        <p className="text-slate-500 mt-1 text-sm">卡住了？翻卡片找对应的方法</p>
      </div>

      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        {CARDS.map((c) => (
          <button
            key={c.key}
            onClick={() => setActive(c.key)}
            className={`p-3 rounded-lg border text-center ${c.color} ${
              active === c.key ? 'ring-2 ring-brand-500' : ''
            }`}
          >
            <div className="text-2xl mb-1">{c.icon}</div>
            <div className="text-sm font-semibold">{c.label}</div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-lg p-5 md:p-8">
        <MdViewer name={active} />
      </div>
    </div>
  )
}
