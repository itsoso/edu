/**
 * 周目标仪式. 改进计划阶段 3 的核心 UI.
 *
 * 设计意图:
 * - Dashboard 顶部 (或展开式面板) 询问"这周你最想攻克什么?"
 * - 不拦截 / 不强制 — 她可以点"这周先随便做"跳过
 * - 让她感受到"这是我选的", 而不是"AI 又要我做什么"
 *
 * 状态机:
 * - 本周 goal 已存在 -> 折叠, 只显示 goal 内容 + 编辑按钮
 * - 本周 goal 不存在 -> 显示 "这周你想攻克什么" 横条, 点击展开
 * - 展开后: 4 个选项 (redo_mistakes / learn_new / challenge / custom) + 文本框
 */
import { useEffect, useState } from 'react'
import { api, WeeklyGoal } from '../api'
import { useToast } from './Toast'
import signals from '../lib/signals'

type FocusType = 'redo_mistakes' | 'learn_new' | 'challenge' | 'custom'

const FOCUS_OPTIONS: { key: FocusType; icon: string; label: string; hint: string }[] = [
  {
    key: 'redo_mistakes',
    icon: '🔁',
    label: '重做错题',
    hint: '把上周没懂的那几道题再做一遍',
  },
  {
    key: 'learn_new',
    icon: '🌱',
    label: '学点新东西',
    hint: '一个具体的知识点 / 一个新概念',
  },
  {
    key: 'challenge',
    icon: '💪',
    label: '挑战更难的',
    hint: '敢不敢试一道更难的题 / 更高级的方法',
  },
  {
    key: 'custom',
    icon: '✍️',
    label: '我有自己的想法',
    hint: '写下你这周真正想做的事',
  },
]

export default function WeeklyGoalCeremony({ weekStart }: { weekStart: string }) {
  const toast = useToast()
  const [loaded, setLoaded] = useState(false)
  const [existing, setExisting] = useState<WeeklyGoal | null>(null)
  const [expanded, setExpanded] = useState(false)
  const [selectedFocus, setSelectedFocus] = useState<FocusType | null>(null)
  const [goalText, setGoalText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api
      .getWeeklyGoal(weekStart)
      .then((r) => {
        if (r.exists) {
          setExisting(r as WeeklyGoal)
          setGoalText((r as any).goal_text || '')
          setSelectedFocus(((r as any).focus_type as FocusType) || null)
        }
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [weekStart])

  async function submit() {
    const text = goalText.trim()
    if (!text) {
      toast.error('写一句话告诉自己想攻克什么')
      return
    }
    setSaving(true)
    try {
      const saved = await api.upsertWeeklyGoal({
        week_start: weekStart,
        goal_text: text,
        focus_type: selectedFocus || undefined,
      })
      signals.track('weekly_goal.set', {
        related_table: 'weekly_goals',
        related_id: saved?.id,
        payload: {
          focus_type: selectedFocus || undefined,
          week_start: weekStart,
        },
      })
      setExisting(saved)
      setExpanded(false)
      toast.success('这周目标已定 · 开始吧')
    } catch (e: any) {
      toast.error('保存失败: ' + (e.message || e))
    } finally {
      setSaving(false)
    }
  }

  async function clear() {
    if (!confirm('清除本周目标? 你可以再重新设定')) return
    try {
      await api.deleteWeeklyGoal(weekStart)
      setExisting(null)
      setGoalText('')
      setSelectedFocus(null)
      setExpanded(false)
    } catch (e: any) {
      toast.error('失败: ' + (e.message || e))
    }
  }

  if (!loaded) return null

  // 状态 1: 本周已有 goal, 折叠展示
  if (existing && !expanded) {
    const focusMeta = FOCUS_OPTIONS.find((o) => o.key === existing.focus_type)
    return (
      <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">{focusMeta?.icon || '🎯'}</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-amber-700 font-medium mb-1">这周的目标</div>
            <div className="text-sm text-slate-800 leading-relaxed">{existing.goal_text}</div>
          </div>
          <button
            onClick={() => setExpanded(true)}
            className="text-xs text-slate-500 hover:text-brand-600"
          >
            编辑
          </button>
        </div>
      </div>
    )
  }

  // 状态 2: 本周没 goal 且未展开, 显示入口
  if (!existing && !expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full bg-white border border-dashed border-brand-300 rounded-lg p-4 text-left hover:border-brand-500 hover:bg-brand-50 transition"
      >
        <div className="flex items-center gap-3">
          <span className="text-2xl">🎯</span>
          <div className="flex-1">
            <div className="font-medium text-slate-800">这周你最想攻克什么?</div>
            <div className="text-xs text-slate-500 mt-0.5">
              30 秒定一个小目标 · 这周的任务会围绕它展开
            </div>
          </div>
          <span className="text-slate-400">→</span>
        </div>
      </button>
    )
  }

  // 状态 3: 展开中
  return (
    <div className="bg-white border-2 border-brand-300 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-slate-800">这周你想攻克什么?</div>
        <button
          onClick={() => {
            setExpanded(false)
            if (!existing) {
              setGoalText('')
              setSelectedFocus(null)
            }
          }}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          先不设 ·
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {FOCUS_OPTIONS.map((o) => (
          <button
            key={o.key}
            onClick={() => setSelectedFocus(o.key)}
            className={`text-left p-3 rounded border transition ${
              selectedFocus === o.key
                ? 'bg-brand-50 border-brand-500'
                : 'bg-white border-slate-200 hover:border-slate-400'
            }`}
          >
            <div className="text-lg">{o.icon}</div>
            <div className="text-sm font-medium mt-1">{o.label}</div>
            <div className="text-xs text-slate-500 mt-0.5">{o.hint}</div>
          </button>
        ))}
      </div>

      <div>
        <label className="text-xs text-slate-600">
          用一句话说清楚这周的目标 · 越具体越好
        </label>
        <textarea
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          placeholder={
            selectedFocus === 'redo_mistakes'
              ? '例: 把上周数学错的 5 道方程题再做一遍'
              : selectedFocus === 'learn_new'
              ? '例: 学会一元二次方程的判别式'
              : selectedFocus === 'challenge'
              ? '例: 做一道去年中考压轴题'
              : '写下你这周真正想做的事...'
          }
          rows={2}
          maxLength={500}
          className="mt-1 w-full border border-slate-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
        />
        <div className="text-[10px] text-slate-400 mt-1">{goalText.length} / 500</div>
      </div>

      <div className="flex items-center justify-between">
        <button
          onClick={submit}
          disabled={saving || !goalText.trim()}
          className="px-4 py-2 bg-brand-600 text-white rounded text-sm disabled:opacity-50"
        >
          {saving ? '保存中...' : '定下来, 开始'}
        </button>
        {existing && (
          <button
            onClick={clear}
            className="text-xs text-red-500 hover:text-red-700"
          >
            清除
          </button>
        )}
      </div>
    </div>
  )
}
