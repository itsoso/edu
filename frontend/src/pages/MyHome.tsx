import { Link } from 'react-router-dom'

const cards = [
  {
    to: '/journal',
    title: '日记',
    desc: '写给自己，记录今天在想什么、哪里轻松了、哪里还别扭。',
    icon: '🕊️',
  },
  {
    to: '/essays',
    title: '作文',
    desc: '整理作文、范文和修改前后的版本。',
    icon: '📝',
  },
  {
    to: '/feynman-history',
    title: '你讲过的',
    desc: '回看你已经讲明白过的知识点，看看自己是怎么会的。',
    icon: '🎓',
  },
  {
    to: '/settings',
    title: '设置',
    desc: '管理隐私、提示和个人偏好。',
    icon: '⚙️',
  },
]

export default function MyHome() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-amber-200 bg-gradient-to-br from-amber-50 via-white to-rose-50 p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700">
          我的
        </div>
        <h1 className="mt-2 text-2xl font-bold text-slate-900">把你的声音、作品和方法都放在这里</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
          这里偏向“我自己”的空间，不是做题入口，而是沉淀你讲过的、写过的、想过的东西。
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
