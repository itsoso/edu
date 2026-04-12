/**
 * AI 作文批改结果展示. 分数 + 亮点/不足 + 三维分析 + 改写示例 + 总评.
 */
import { EssayAnalysis } from '../api'

export default function EssayAnalysisView({ a }: { a: EssayAnalysis }) {
  const scoreColor =
    a.score >= 85 ? 'text-green-600' :
    a.score >= 70 ? 'text-brand-700' :
    a.score >= 55 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-4 text-sm">
      {/* 分数卡片 */}
      <div className="bg-gradient-to-r from-brand-50 to-purple-50 border border-brand-200 rounded-lg p-4 flex items-center gap-4">
        <div className="text-center">
          <div className={`text-4xl font-bold ${scoreColor}`}>{a.score}</div>
          <div className="text-xs text-slate-500">/ 100</div>
        </div>
        <div className="flex-1">
          <span className={`px-2 py-1 rounded text-sm font-medium ${
            a.grade?.startsWith('A') ? 'bg-green-100 text-green-700' :
            a.grade?.startsWith('B') ? 'bg-brand-100 text-brand-700' :
            a.grade?.startsWith('C') ? 'bg-amber-100 text-amber-700' :
            'bg-red-100 text-red-700'
          }`}>
            {a.grade}
          </span>
        </div>
      </div>

      {/* 总评 */}
      {a.overall_comment && (
        <div className="bg-slate-50 border border-slate-200 rounded p-3 text-slate-700 leading-relaxed">
          {a.overall_comment}
        </div>
      )}

      {/* 亮点 + 不足 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {a.strengths?.length > 0 && (
          <div className="bg-green-50 border border-green-200 rounded p-3">
            <div className="font-semibold text-green-700 mb-2">亮点</div>
            <ul className="space-y-1 list-disc pl-5 text-slate-700">
              {a.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
        {a.weaknesses?.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded p-3">
            <div className="font-semibold text-amber-700 mb-2">不足</div>
            <ul className="space-y-1 list-disc pl-5 text-slate-700">
              {a.weaknesses.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        )}
      </div>

      {/* 三维分析 */}
      <details>
        <summary className="cursor-pointer text-brand-700 font-medium">▶ 详细分析</summary>
        <div className="mt-2 space-y-3">
          {a.structure_analysis && (
            <div><b className="text-slate-800">结构分析:</b> <span className="text-slate-700">{a.structure_analysis}</span></div>
          )}
          {a.language_analysis && (
            <div><b className="text-slate-800">语言分析:</b> <span className="text-slate-700">{a.language_analysis}</span></div>
          )}
          {a.content_analysis && (
            <div><b className="text-slate-800">内容分析:</b> <span className="text-slate-700">{a.content_analysis}</span></div>
          )}
        </div>
      </details>

      {/* 改进建议 */}
      {a.improvement_suggestions?.length > 0 && (
        <div>
          <div className="font-semibold text-slate-800 mb-2">改进建议</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-700">
            {a.improvement_suggestions.map((s, i) => <li key={i}>{s}</li>)}
          </ol>
        </div>
      )}

      {/* 改写示例 */}
      {a.model_sentences?.length > 0 && (
        <div>
          <div className="font-semibold text-slate-800 mb-2">优秀改写示例</div>
          <div className="space-y-2">
            {a.model_sentences.map((m, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded p-3">
                <div className="text-xs text-red-500 line-through mb-1">原文: {m.original}</div>
                <div className="text-xs text-green-700 mb-1">改写: {m.improved}</div>
                <div className="text-[11px] text-slate-500">理由: {m.reason}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
