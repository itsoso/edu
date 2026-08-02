import { Link } from 'react-router-dom'

const cards = [
  {
    to: '/trends',
    title: '成绩趋势',
    desc: '看各科走势、总分变化和阶段表现。',
    icon: '📈',
  },
  {
    to: '/insights',
    title: '看见自己',
    desc: '看知识点掌握度、容易重复的错误模式和长期变化。',
    icon: '🪞',
  },
  {
    to: '/reports',
    title: '月度复盘',
    desc: '把最近一个阶段的进步和卡点收成一份复盘。',
    icon: '🧠',
  },
  {
    to: '/methods',
    title: '方法卡',
    desc: '把常用策略和各科方法沉淀成可随时翻的卡片。',
    icon: '🎯',
  },
]

export default function GrowthHome() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-sky-50 p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">
          成长
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">看看你最近是在变稳，还是还卡在同一个地方</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          这里不只是看分数，也看错题有没有真正压下去、哪些知识点开始不再反复出错。
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {cards.map((card) => (
          <Link
            key={card.to}
            to={card.to}
            className="rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-300 hover:shadow-sm"
          >
            <div className="text-2xl">{card.icon}</div>
            <div className="mt-3 text-lg font-semibold text-slate-900">{card.title}</div>
            <div className="mt-1 text-sm leading-6 text-slate-500">{card.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
