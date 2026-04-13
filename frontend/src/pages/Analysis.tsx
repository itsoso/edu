import MdViewer from '../components/MdViewer'

export default function Analysis() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">完整分析报告</h1>
        <p className="text-slate-500 mt-1 text-sm">专属的学业诊断与 4 周提升方案</p>
      </div>
      <div className="bg-white border border-slate-200 rounded-lg p-5 md:p-8">
        <MdViewer name="analysis" />
      </div>
    </div>
  )
}
