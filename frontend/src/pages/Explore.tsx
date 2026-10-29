import { useState } from 'react'
import { explorations, type Exploration, type Subject } from '../content/explorations'

const subjects: Array<'全部' | Subject> = ['全部', '生物', '数学', '物理', '化学']

function ExplorationCard({ item }: { item: Exploration }) {
  const [choice, setChoice] = useState<number | null>(null)
  const [submitted, setSubmitted] = useState(false)

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white" aria-labelledby={`${item.id}-title`}>
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
          <span className="rounded-full bg-teal-50 px-3 py-1 font-semibold text-teal-800">{item.subject}</span>
          <span>初中 · 建议 {item.minutes} 分钟</span>
          <span>· {item.language}</span>
        </div>
        <h2 id={`${item.id}-title`} className="mt-4 text-xl font-bold tracking-tight text-slate-900">{item.title}</h2>
        <p className="mt-2 text-sm leading-7 text-slate-600">{item.summary}</p>
        <p className="mt-4 border-l-2 border-teal-600 pl-3 text-sm leading-6 text-teal-900">{item.value}</p>
        <details className="mt-5 rounded-xl border border-slate-200 p-4">
          <summary className="cursor-pointer py-1 text-sm font-semibold text-slate-800">探索任务与自测</summary>
          <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-6 text-slate-600">
            {item.tasks.map(task => <li key={task}>{task}</li>)}
          </ol>
          <form className="mt-5 border-t border-slate-200 pt-4" onSubmit={event => { event.preventDefault(); if (choice !== null) setSubmitted(true) }}>
            <fieldset>
              <legend className="text-sm font-semibold leading-6">{item.question}</legend>
              <div className="mt-3 space-y-2">
                {item.options.map((option, index) => (
                  <label key={option} className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm ${choice === index ? 'border-teal-600 bg-teal-50' : 'border-slate-200'}`}>
                    <input type="radio" name={`${item.id}-answer`} value={index} checked={choice === index} onChange={() => { setChoice(index); setSubmitted(false) }} />
                    {option}
                  </label>
                ))}
              </div>
            </fieldset>
            <button type="submit" disabled={choice === null} className="mt-3 min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">检查理解</button>
            {submitted && <div role="status" className="mt-3 rounded-lg bg-slate-50 p-4 text-sm leading-6">
              <p className="font-semibold">{choice === item.answer ? '答对了，再试着解释原因。' : '再想一想，关键在这里：'}</p>
              <p className="mt-1">{item.explanation}</p>
            </div>}
          </form>
        </details>
        <a href={item.url} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-800">打开交互资源 ↗<span className="sr-only">：{item.title}（新窗口）</span></a>
        <p className="mt-3 text-xs leading-5 text-slate-500">来源：{item.source} · 收录于 <time dateTime={item.addedAt}>{item.addedAt}</time></p>
      </div>
    </article>
  )
}

export default function Explore() {
  const [subject, setSubject] = useState<'全部' | Subject>('全部')
  const [search, setSearch] = useState('')
  const query = search.trim().toLocaleLowerCase()
  const filtered = explorations.filter(item => (subject === '全部' || item.subject === subject) &&
    `${item.title} ${item.summary} ${item.subject} ${item.source} ${item.value} ${item.tasks.join(' ')} ${item.question}`.toLocaleLowerCase().includes(query))

  return (
    <div className="space-y-6">
      <header className="relative overflow-hidden rounded-3xl bg-slate-900 p-6 text-white sm:p-8">
        <div className="text-xs font-semibold tracking-[0.2em] text-teal-300">探索实验室 / EXPLORE</div>
        <h1 className="mt-4 max-w-lg text-3xl font-bold leading-tight sm:text-4xl">把课本上的知识，<br />变成亲手发现的答案。</h1>
        <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">每次挑一个问题。先预测，再打开交互演示验证，最后用一道自测检查理解。</p>
        <div className="mt-6 flex flex-wrap gap-3 text-xs text-teal-200">
          <span className="rounded-full border border-slate-600 px-3 py-2">01 观察现象</span>
          <span className="rounded-full border border-slate-600 px-3 py-2">02 动手验证</span>
          <span className="rounded-full border border-slate-600 px-3 py-2">03 解释原因</span>
        </div>
      </header>
      <aside className="border-l-2 border-teal-600 pl-4 text-sm leading-6 text-slate-600">
        <p>本期灵感：用交互演示串起氧气从空气到细胞的旅程。</p>
        <a className="text-teal-800 underline underline-offset-4" href="https://x.com/slashui/status/2115632086707225085" target="_blank" rel="noopener noreferrer">阅读洛克船长的分享 ↗</a>
        <p className="mt-1 text-xs text-slate-500">人工精选，非实时资讯流。外部资源在新窗口打开；自测仅供当次练习，不计入掌握度或学习档案。</p>
      </aside>
      <section aria-label="筛选探索资源" className="space-y-4">
        <label className="block text-sm font-medium text-slate-700">搜索主题
          <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="试试：氧气、抛物线、电路……" className="mt-2 block min-h-11 w-full rounded-xl border border-slate-300 bg-white px-4 font-normal sm:max-w-md" />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="学科">
          {subjects.map(value => <button key={value} type="button" aria-pressed={subject === value} onClick={() => setSubject(value)} className={`min-h-11 rounded-full border px-4 text-sm ${subject === value ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{value}</button>)}
        </div>
        <p role="status" className="text-xs text-slate-500">找到 {filtered.length} 个探索主题</p>
      </section>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        {filtered.map(item => <ExplorationCard key={item.id} item={item} />)}
      </div>
      {filtered.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
        <p className="text-slate-600">暂时没有匹配的主题，换个关键词试试。</p>
        <button type="button" className="mt-3 min-h-11 px-4 text-teal-800 underline" onClick={() => { setSearch(''); setSubject('全部') }}>清除筛选</button>
      </div>}
    </div>
  )
}
