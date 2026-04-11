import { useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { api } from '../api'

export default function MdViewer({ name }: { name: string }) {
  const [content, setContent] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    setErr('')
    api
      .getContent(name)
      .then((r) => setContent(r.content))
      .catch((e) => setErr(String(e)))
  }, [name])

  if (err) return <div className="text-red-600">加载失败: {err}</div>
  if (!content) return <div className="text-slate-400">加载中...</div>
  return (
    <div className="md-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  )
}
