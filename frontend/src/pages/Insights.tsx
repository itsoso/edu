import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import KnowledgeGraph from '../components/KnowledgeMap'
import {
  api,
  type MyProfileResponse,
  type ProfileHistoryItem,
  type ProfileVersionResponse,
  type ProfileCorrection,
  type StudentProfile,
  type KnowledgePoint,
  type ErrorPattern,
  type AgentStrategies,
} from '../api'

const WELCOME_KEY = 'insights:welcome:dismissed:v1'

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  // 接受 ISO 与 'YYYY-MM-DD'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s.slice(0, 10)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function masteryLabel(m: number): string {
  if (m >= 0.85) return '稳了'
  if (m >= 0.6) return '在进步'
  if (m >= 0.4) return '还在练'
  return '需要多看看'
}

function trendLabel(t?: string): { text: string; cls: string } {
  switch (t) {
    case 'new':
      return { text: '新出现', cls: 'bg-amber-50 text-amber-700 border-amber-200' }
    case 'rising':
      return { text: '在上升', cls: 'bg-orange-50 text-orange-700 border-orange-200' }
    case 'weakening':
      return { text: '在减弱', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    case 'falling':
      return { text: '下降中', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' }
    case 'stable':
      return { text: '稳定', cls: 'bg-slate-50 text-slate-600 border-slate-200' }
    default:
      return { text: t || '—', cls: 'bg-slate-50 text-slate-600 border-slate-200' }
  }
}

export default function Insights() {
  const [data, setData] = useState<MyProfileResponse | null>(null)
  const [history, setHistory] = useState<ProfileHistoryItem[]>([])
  const [corrections, setCorrections] = useState<ProfileCorrection[]>([])
  const [versionDetail, setVersionDetail] = useState<Record<number, ProfileVersionResponse>>({})
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [welcomeOpen, setWelcomeOpen] = useState(
    () => typeof window !== 'undefined' && !window.localStorage.getItem(WELCOME_KEY)
  )

  async function loadAll() {
    setErr('')
    try {
      const [p, h] = await Promise.all([api.getMyProfile(), api.getMyProfileHistory()])
      setData(p)
      setHistory(h)
      // corrections 仅学生自己有意义
      if (p.exists && p.viewer_role === 'self') {
        const cs = await api.listMyCorrections()
        setCorrections(cs)
      } else {
        setCorrections([])
      }
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  useEffect(() => {
    loadAll()
  }, [])

  async function handleRebuild() {
    setBusy('rebuild')
    setErr('')
    try {
      await api.rebuildMyProfile()
      await loadAll()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleDismissPattern(p: ErrorPattern) {
    const id = p.id || p.description
    if (!id) return
    const reason = window.prompt(
      '说一说你为什么不同意?\n(可以留空, 但写下来更有助于以后回看)',
      ''
    )
    if (reason === null) return // 取消
    setBusy(`pattern:${id}`)
    setErr('')
    try {
      await api.correctMyProfile({
        field_path: `error_patterns.${id}`,
        action: 'dismiss',
        reason: reason || undefined,
      })
      await loadAll()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleLockMastered(subject: string, kp: string) {
    if (!window.confirm(`把"${subject} / ${kp}"标记为已掌握 (mastery = 1.0)?`)) return
    setBusy(`kp:${subject}:${kp}`)
    setErr('')
    try {
      await api.correctMyProfile({
        field_path: `knowledge.${subject}.${kp}.mastery`,
        action: 'lock_value',
        value: 1.0,
      })
      await loadAll()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleUndoCorrection(c: ProfileCorrection) {
    if (!window.confirm('撤销这条修改? 系统会重新生成相关内容')) return
    setBusy(`corr:${c.id}`)
    setErr('')
    try {
      // reset 是更彻底的释放; 单条 delete 也行, 这里用 delete 配合下一次 rebuild
      await api.deleteMyCorrection(c.id)
      await api.rebuildMyProfile()
      await loadAll()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function handleWipe() {
    if (!window.confirm('确定要清除全部画像和修改记录吗? 系统会从 0 开始重新观察.')) return
    if (!window.confirm('再确认一次: 这会删除所有版本历史, 无法恢复.')) return
    setBusy('wipe')
    setErr('')
    try {
      await api.wipeMyProfile()
      await loadAll()
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }

  async function loadVersion(v: number) {
    if (versionDetail[v]) return
    try {
      const d = await api.getMyProfileVersion(v)
      setVersionDetail((prev) => ({ ...prev, [v]: d }))
    } catch (e: any) {
      setErr(e.message || String(e))
    }
  }

  function dismissWelcome() {
    setWelcomeOpen(false)
    try {
      window.localStorage.setItem(WELCOME_KEY, '1')
    } catch {
      /* ignore */
    }
  }

  // ----- render -----
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">🪞 看见自己</h1>
        <p className="text-slate-500 mt-1 text-sm">
          AI 对你最近学习的观察. 你可以看, 可以改, 可以删.
        </p>
      </header>

      {/* 知识点图谱 */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">🧭 知识点图谱</h2>
          <span className="text-xs text-slate-400">面积 = 错题数 · 颜色 = 掌握度</span>
        </div>
        <KnowledgeGraph />
      </section>

      {welcomeOpen && (
        <div className="bg-brand-50 border border-brand-200 rounded-lg p-5 text-sm text-slate-700 leading-relaxed">
          <div className="font-semibold text-brand-700 mb-1">这是一面镜子, 不是评价</div>
          <p>
            这份画像是 AI 对你的观察, 不是评价. 你可以看, 可以改, 可以删.
            它的目的是帮你看见自己, 不是给你打分.
          </p>
          <div className="mt-3 text-right">
            <button
              onClick={dismissWelcome}
              className="px-3 py-1.5 text-xs rounded border border-brand-300 text-brand-700 hover:bg-white"
            >
              我明白了
            </button>
          </div>
        </div>
      )}

      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-3">
          {err}
        </div>
      )}

      {!data ? (
        <div className="text-sm text-slate-400 py-10 text-center">加载中...</div>
      ) : !data.exists ? (
        <EmptyState onRebuild={handleRebuild} busy={busy === 'rebuild'} message={data.message} />
      ) : (
        <>
          {data.viewer_role === 'parent' && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
              你正在以家长视角查看孩子的画像. <b>这是 AI 的观察, 不是定论.</b>{' '}
              请把它当作一个对话起点, 而不是判断依据.
            </div>
          )}

          <Hero
            data={data}
            onRebuild={handleRebuild}
            busy={busy === 'rebuild'}
            canEdit={data.can_edit}
          />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <KnowledgeMap
                profile={data.profile}
                canEdit={data.can_edit}
                onMarkMastered={handleLockMastered}
                busy={busy}
              />
            </div>

            <div className="lg:col-span-1">
              <div className="lg:sticky lg:top-4 space-y-4">
                <ErrorPatternsCard
                  profile={data.profile}
                  canEdit={data.can_edit}
                  onDismiss={handleDismissPattern}
                  busy={busy}
                />
              </div>
            </div>
          </div>

          <RhythmCard profile={data.profile} />

          <AgentStrategiesCard strategies={data.profile.agent_strategies} />

          <HistoryCard
            history={history}
            versionDetail={versionDetail}
            onExpand={loadVersion}
          />

          {data.can_edit && (
            <BottomActions
              corrections={corrections}
              onUndo={handleUndoCorrection}
              onWipe={handleWipe}
              busy={busy}
            />
          )}
        </>
      )}
    </div>
  )
}

// ---------- subcomponents ----------

function EmptyState({
  onRebuild,
  busy,
  message,
}: {
  onRebuild: () => void
  busy: boolean
  message?: string
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-8 text-center">
      <div className="text-3xl mb-2">🌱</div>
      <div className="font-medium mb-1">还没有画像</div>
      <div className="text-sm text-slate-500 mb-4">
        {message || '系统还没观察到足够的数据. 你可以现在手动构建一次.'}
      </div>
      <button
        onClick={onRebuild}
        disabled={busy}
        className="px-5 py-2 bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-50"
      >
        {busy ? '构建中...' : '立即构建'}
      </button>
    </div>
  )
}

function Hero({
  data,
  onRebuild,
  busy,
  canEdit,
}: {
  data: Extract<MyProfileResponse, { exists: true }>
  onRebuild: () => void
  busy: boolean
  canEdit: boolean
}) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-6">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="flex-1">
          <div className="text-xs text-slate-400 mb-2">
            版本 v{data.version} · 计算于 {fmtDate(data.computed_at)}
            {data.is_monthly_snapshot && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                月度快照
              </span>
            )}
          </div>
          <p className="text-lg md:text-xl text-slate-800 leading-relaxed whitespace-pre-wrap">
            {data.source_summary || '（这一版还没生成总结文字）'}
          </p>
        </div>
        {canEdit && (
          <button
            onClick={onRebuild}
            disabled={busy}
            className="shrink-0 px-4 py-2 text-sm border border-slate-300 rounded hover:bg-slate-50 disabled:opacity-50"
          >
            {busy ? '重建中...' : '🔄 立即重建'}
          </button>
        )}
      </div>
    </div>
  )
}

function KnowledgeMap({
  profile,
  canEdit,
  onMarkMastered,
  busy,
}: {
  profile: StudentProfile
  canEdit: boolean
  onMarkMastered: (subject: string, kp: string) => void
  busy: string | null
}) {
  const subjects = useMemo(() => {
    const k = profile.knowledge || {}
    return Object.keys(k).sort()
  }, [profile])

  if (subjects.length === 0) {
    return (
      <section className="bg-white border border-slate-200 rounded-lg p-6">
        <h2 className="font-semibold mb-2">知识地图</h2>
        <div className="text-sm text-slate-500">还没观察到带有知识点标签的练习数据.</div>
      </section>
    )
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-2 md:p-4">
      <h2 className="font-semibold px-3 py-2">知识地图</h2>
      <div className="space-y-2">
        {subjects.map((subj) => {
          const kps = profile.knowledge?.[subj] || {}
          const entries = Object.entries(kps).sort(
            (a, b) => (b[1].practice_count || 0) - (a[1].practice_count || 0)
          )
          return (
            <details
              key={subj}
              open
              className="rounded border border-slate-100 bg-slate-50/30"
            >
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 select-none">
                {subj}{' '}
                <span className="text-xs text-slate-400 font-normal">
                  ({entries.length} 个知识点)
                </span>
              </summary>
              <div className="divide-y divide-slate-100">
                {entries.map(([kp, info]) => (
                  <KnowledgeRow
                    key={kp}
                    subject={subj}
                    name={kp}
                    info={info}
                    canEdit={canEdit}
                    onMarkMastered={onMarkMastered}
                    busy={busy === `kp:${subj}:${kp}`}
                  />
                ))}
              </div>
            </details>
          )
        })}
      </div>
    </section>
  )
}

function KnowledgeRow({
  subject,
  name,
  info,
  canEdit,
  onMarkMastered,
  busy,
}: {
  subject: string
  name: string
  info: KnowledgePoint
  canEdit: boolean
  onMarkMastered: (subject: string, kp: string) => void
  busy: boolean
}) {
  // 0 → 100, 5% 步进对应 Tailwind 任意值
  const pct = Math.round((info.mastery || 0) * 100)
  // 透明度: mastery 越高越深
  const opacity = 0.3 + Math.min(0.7, info.mastery || 0)
  return (
    <div className="px-3 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <div className="flex-1 min-w-[160px]">
        <div className="font-medium text-slate-800 flex items-center gap-2">
          {name}
          {info.locked_by_user && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200">
              你已锁定
            </span>
          )}
        </div>
        <div className="mt-1 h-2 w-full bg-slate-100 rounded overflow-hidden">
          <div
            className="h-full bg-brand-500 rounded"
            style={{ width: `${pct}%`, opacity }}
          />
        </div>
        <div className="text-xs text-slate-500 mt-1">
          {masteryLabel(info.mastery || 0)} · {pct}%
        </div>
      </div>
      <div className="text-xs text-slate-500 w-32">
        上次练习: {fmtDate(info.last_practiced_at)}
      </div>
      <div className="text-xs text-slate-500 w-20 text-right">
        练习 {info.practice_count || 0} 次
      </div>
      {canEdit && !info.locked_by_user && (info.mastery || 0) < 1 && (
        <button
          onClick={() => onMarkMastered(subject, name)}
          disabled={busy}
          className="text-xs text-brand-700 hover:underline disabled:opacity-50"
        >
          {busy ? '保存中...' : '我已经会了'}
        </button>
      )}
    </div>
  )
}

function ErrorPatternsCard({
  profile,
  canEdit,
  onDismiss,
  busy,
}: {
  profile: StudentProfile
  canEdit: boolean
  onDismiss: (p: ErrorPattern) => void
  busy: string | null
}) {
  const patterns = profile.error_patterns || []
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-4">
      <h2 className="font-semibold mb-1">我的"小坑"</h2>
      <p className="text-xs text-slate-500 mb-3">
        AI 反复看到的模式. 不准也没关系, 点"我不同意"就好.
      </p>
      {patterns.length === 0 ? (
        <div className="text-sm text-slate-400 py-6 text-center">
          目前没有识别出明显的反复模式.
        </div>
      ) : (
        <div className="space-y-3">
          {patterns.map((p, i) => {
            const t = trendLabel(p.trend)
            const conf = Math.round((p.confidence || 0) * 100)
            const id = p.id || p.description || String(i)
            const rowBusy = busy === `pattern:${id}`
            return (
              <div
                key={id}
                className="rounded border border-slate-200 p-3 bg-slate-50/40 space-y-2"
              >
                <div className="text-sm text-slate-800 leading-relaxed">
                  {p.description || '(无描述)'}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {p.subject && (
                    <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600">
                      {p.subject}
                    </span>
                  )}
                  <span className="text-slate-500">出现 {p.occurrences || 0} 次</span>
                  <span className={`px-2 py-0.5 rounded-full border ${t.cls}`}>{t.text}</span>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 mb-1">置信度 {conf}%</div>
                  <div className="h-1.5 w-full bg-slate-100 rounded">
                    <div
                      className="h-full bg-brand-400 rounded"
                      style={{ width: `${conf}%` }}
                    />
                  </div>
                </div>
                {canEdit && (
                  <div className="text-right">
                    <button
                      onClick={() => onDismiss(p)}
                      disabled={rowBusy}
                      className="text-xs text-slate-500 hover:text-red-600 disabled:opacity-50"
                    >
                      {rowBusy ? '处理中...' : '我不同意'}
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function RhythmCard({ profile }: { profile: StudentProfile }) {
  const eng = profile.engagement || {}
  const cog = profile.cognitive_style || {}
  const items: { label: string; value: string }[] = [
    {
      label: '近 7 天活跃',
      value:
        eng.active_days_7d !== undefined ? `${eng.active_days_7d} 天` : '—',
    },
    {
      label: '平均一次',
      value:
        eng.avg_session_minutes_7d !== undefined
          ? `${eng.avg_session_minutes_7d} 分钟`
          : '—',
    },
    {
      label: '状态趋势',
      value: eng.trend || '—',
    },
    {
      label: '最佳时段',
      value: cog.best_time_window || '—',
    },
  ]
  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5 col-span-3">
      <h2 className="font-semibold mb-3">节奏与状态</h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map((it) => (
          <div key={it.label} className="border border-slate-100 rounded p-3 bg-slate-50/40">
            <div className="text-xs text-slate-500">{it.label}</div>
            <div className="text-xl font-semibold mt-1 text-slate-800">{it.value}</div>
          </div>
        ))}
      </div>
      {(cog.hint_usage_pattern || cog.ideal_session_length) && (
        <div className="mt-4 text-xs text-slate-500 space-y-1">
          {cog.hint_usage_pattern && <div>提示使用习惯: {cog.hint_usage_pattern}</div>}
          {cog.ideal_session_length && <div>合适的单次时长: {cog.ideal_session_length}</div>}
        </div>
      )}
    </section>
  )
}

const TUTOR_KIND_LABEL: Record<string, string> = {
  pattern_drill: '针对你的弱项',
  knowledge_refresh: '复习薄弱知识点',
  goal_followup: '朝周目标走',
  subject_review: '整科补漏',
}

const CURATOR_KIND_LABEL: Record<string, string> = {
  review_mistake: '复习错题',
  pattern_drill: '针对你的弱项',
  goal_aligned: '对齐周目标',
  challenge: '挑战难题',
  rest_recommended: '建议休息',
}

function rateDecoration(
  rate: number,
  sample: number
): { suffix: string; cls: string } {
  if (sample < 3) return { suffix: '', cls: 'text-slate-500' }
  if (rate >= 0.7)
    return { suffix: ' ✓ (她爱)', cls: 'text-emerald-700' }
  if (rate <= 0.3) return { suffix: ' △ (她不爱)', cls: 'text-slate-400' }
  return { suffix: '', cls: 'text-slate-700' }
}

function AgentStrategiesCard({
  strategies,
}: {
  strategies?: AgentStrategies
}) {
  const tutorEntries = strategies ? Object.entries(strategies.tutor || {}) : []
  const curatorEntries = strategies
    ? Object.entries(strategies.curator || {})
    : []
  const feynman = strategies?.feynman
  const guardian = strategies?.guardian
  const hours = strategies?.preferred_action_hours || []

  const allEmpty =
    tutorEntries.length === 0 &&
    curatorEntries.length === 0 &&
    !(feynman && (feynman.sample_size ?? 0) > 0) &&
    !(guardian && (guardian.sample_size ?? 0) > 0) &&
    hours.length === 0

  return (
    <section className="bg-white border border-slate-200 rounded-lg p-5">
      <h2 className="font-semibold">🧠 AI 学到了什么 (基于你的反馈)</h2>
      <p className="text-xs text-slate-500 mt-1">
        你接受/跳过的每条建议都让系统更准. 每条至少要 3 次反馈才算可信.
      </p>

      {allEmpty ? (
        <div className="mt-3 text-sm text-slate-500 leading-relaxed">
          AI 还没学到什么 — 等你用过几次 agent 建议后会出现这里. 你的反馈会让下次的建议更贴你.
        </div>
      ) : (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
          {tutorEntries.length > 0 && (
            <div className="border border-slate-100 rounded p-3 bg-slate-50/40">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Tutor (主动建议)
              </div>
              <ul className="space-y-1 text-sm">
                {tutorEntries.map(([kind, s]) => {
                  const label = TUTOR_KIND_LABEL[kind] || kind
                  const d = rateDecoration(s.accept_rate, s.sample_size)
                  return (
                    <li key={kind} className={d.cls}>
                      {label} · 接受 {(s.accept_rate * 100).toFixed(0)}% (
                      {s.sample_size} 次){d.suffix}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {curatorEntries.length > 0 && (
            <div className="border border-slate-100 rounded p-3 bg-slate-50/40">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Curator (今天值得做的)
              </div>
              <ul className="space-y-1 text-sm">
                {curatorEntries.map(([kind, s]) => {
                  const label = CURATOR_KIND_LABEL[kind] || kind
                  const d = rateDecoration(s.completion_rate, s.sample_size)
                  return (
                    <li key={kind} className={d.cls}>
                      {label} · 完成 {(s.completion_rate * 100).toFixed(0)}% (
                      {s.sample_size} 次){d.suffix}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {feynman && (feynman.sample_size ?? 0) > 0 && (
            <div className="border border-slate-100 rounded p-3 bg-slate-50/40">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Feynman (教 AI)
              </div>
              <div className="text-sm text-slate-700">
                完成率 {((feynman.completion_rate ?? 0) * 100).toFixed(0)}% (
                {feynman.sample_size} 次)
              </div>
            </div>
          )}

          {guardian && (guardian.sample_size ?? 0) > 0 && (
            <div className="border border-slate-100 rounded p-3 bg-slate-50/40">
              <div className="text-xs font-semibold text-slate-700 mb-2">
                Guardian (异常提醒)
              </div>
              <div className="text-sm text-slate-700">
                确认率 {((guardian.ack_rate ?? 0) * 100).toFixed(0)}% (
                {guardian.sample_size} 次)
              </div>
            </div>
          )}
        </div>
      )}

      {!allEmpty && hours.length > 0 && (
        <div className="mt-4 text-xs text-slate-600">
          你最常接受建议的时段:{' '}
          {hours.map((h) => `${String(h).padStart(2, '0')}:00`).join(', ')}
        </div>
      )}
    </section>
  )
}

function HistoryCard({
  history,
  versionDetail,
  onExpand,
}: {
  history: ProfileHistoryItem[]
  versionDetail: Record<number, ProfileVersionResponse>
  onExpand: (v: number) => void
}) {
  if (history.length === 0) return null
  return (
    <details className="bg-white border border-slate-200 rounded-lg">
      <summary className="cursor-pointer px-5 py-3 font-semibold text-slate-700 select-none">
        历史画像 ({history.length})
      </summary>
      <div className="divide-y divide-slate-100">
        {history.map((h) => (
          <details
            key={h.version}
            className="px-5 py-3"
            onToggle={(e) => {
              if ((e.target as HTMLDetailsElement).open) onExpand(h.version)
            }}
          >
            <summary className="cursor-pointer text-sm select-none flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-700">v{h.version}</span>
              <span className="text-xs text-slate-400">{fmtDate(h.created_at)}</span>
              {h.is_monthly_snapshot && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                  月度
                </span>
              )}
              {h.build_method && (
                <span className="text-[10px] text-slate-400">· {h.build_method}</span>
              )}
              <span className="text-slate-600 truncate">
                {h.source_summary?.slice(0, 60) || ''}
              </span>
            </summary>
            <div className="mt-2 text-sm text-slate-600 whitespace-pre-wrap leading-relaxed pl-4 border-l-2 border-slate-100">
              {versionDetail[h.version]
                ? versionDetail[h.version].profile?.self_narrative ||
                  versionDetail[h.version].source_summary ||
                  '(无内容)'
                : '加载中...'}
            </div>
          </details>
        ))}
      </div>
    </details>
  )
}

function BottomActions({
  corrections,
  onUndo,
  onWipe,
  busy,
}: {
  corrections: ProfileCorrection[]
  onUndo: (c: ProfileCorrection) => void
  onWipe: () => void
  busy: string | null
}) {
  return (
    <section className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <h2 className="font-semibold mb-1">我的修改记录</h2>
        <p className="text-xs text-slate-500 mb-3">
          所有你给系统的反馈都在这里. 觉得改错了, 可以撤销.
        </p>
        {corrections.length === 0 ? (
          <div className="text-sm text-slate-400">还没有修改过任何内容.</div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {corrections.map((c) => (
              <li
                key={c.id}
                className="py-2 flex flex-wrap items-center gap-2 text-sm"
              >
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-600">
                  {c.action}
                </span>
                <code className="text-xs text-slate-700 break-all">{c.field_path}</code>
                {c.reason && (
                  <span className="text-xs text-slate-500 italic">"{c.reason}"</span>
                )}
                <span className="ml-auto text-xs text-slate-400">{fmtDate(c.created_at)}</span>
                <button
                  onClick={() => onUndo(c)}
                  disabled={busy === `corr:${c.id}`}
                  className="text-xs text-slate-500 hover:text-brand-700 disabled:opacity-50"
                >
                  {busy === `corr:${c.id}` ? '撤销中...' : '撤销'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="bg-red-50 border border-red-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="font-semibold text-red-700">从 0 开始</div>
          <div className="text-xs text-slate-600 mt-1">
            清除全部画像和修改记录. 系统会从下一次活动开始重新观察.
          </div>
        </div>
        <button
          onClick={onWipe}
          disabled={busy === 'wipe'}
          className="px-4 py-2 text-sm border border-red-300 text-red-700 rounded hover:bg-red-100 disabled:opacity-50"
        >
          {busy === 'wipe' ? '清除中...' : '全部清除'}
        </button>
      </div>

      <div className="text-xs text-slate-400 text-center">
        想了解系统怎么工作? 去 <Link to="/settings" className="underline">设置</Link> 看 AI 用量.
      </div>
    </section>
  )
}
