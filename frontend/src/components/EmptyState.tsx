import { ReactNode } from 'react'
import { Link } from 'react-router-dom'

type Props = {
  icon?: string
  title: string
  description?: string | ReactNode
  ctaLabel?: string
  ctaTo?: string
  ctaOnClick?: () => void
  variant?: 'card' | 'inline'
}

/**
 * 统一的空状态组件. 替换散落在各页面的 "还没有..." 文本.
 *
 * 用法:
 *   <EmptyState
 *     icon="📸"
 *     title="还没有上传过试卷"
 *     description="拍一张试卷照片, AI 会帮你识别错题"
 *     ctaLabel="上传第一张"
 *     ctaOnClick={() => fileRef.current?.click()}
 *   />
 */
export default function EmptyState({
  icon = '✨',
  title,
  description,
  ctaLabel,
  ctaTo,
  ctaOnClick,
  variant = 'card',
}: Props) {
  const wrapperCls =
    variant === 'card'
      ? 'bg-white border border-dashed border-slate-300 rounded-lg p-8 text-center'
      : 'py-8 text-center'

  const cta = ctaLabel ? (
    ctaTo ? (
      <Link
        to={ctaTo}
        className="inline-block mt-4 px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
      >
        {ctaLabel}
      </Link>
    ) : (
      <button
        onClick={ctaOnClick}
        className="inline-block mt-4 px-4 py-2 bg-brand-600 text-white rounded text-sm hover:bg-brand-700"
      >
        {ctaLabel}
      </button>
    )
  ) : null

  return (
    <div className={wrapperCls}>
      <div className="text-5xl mb-3 opacity-70">{icon}</div>
      <div className="font-semibold text-slate-700">{title}</div>
      {description && (
        <div className="text-sm text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
          {description}
        </div>
      )}
      {cta}
    </div>
  )
}
