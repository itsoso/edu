import { useState } from 'react'

const origin = 'https://edu.executor.life'
const manifest = `${origin}/.well-known/edu-skills.json`
const skill = `${origin}/api/skills/edu-learning/SKILL.md`
const instruction = `请读取 ${skill}，按其中的说明接入 Edu。发现清单：${manifest}。先检查登录身份，再读取我授权的学习数据；没有凭据时请引导我在可信客户端完成登录，不要索取聊天中的密码。`
const config = `EDU_BASE_URL=${origin}
EDU_TOKEN=<由客户端秘密存储注入的 Edu token>

Authorization: Bearer <EDU_TOKEN>`

export default function SkillsAccess() {
  const [message, setMessage] = useState('')
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setMessage('已复制')
    } catch {
      setMessage('复制失败，请手动选中下方内容复制。')
    }
  }
  return (
    <section aria-labelledby="skills-title" className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div>
        <h2 id="skills-title" className="font-semibold">Skills 订阅与 Agent 接入</h2>
        <p className="text-sm text-slate-600 mt-1">让你使用的 Agent 帮你查看学习进度、考试、错题和课程。支持读取网页或发送 HTTP 请求的 Agent 均可接入。</p>
      </div>
      <div className="rounded-lg bg-brand-50 p-3 text-sm text-brand-900">
        技能说明公开可读；学习数据需要登录授权。关联的只读账号只能查看其绑定学生的数据。
      </div>
      <div className="space-y-2 text-sm">
        <h3 className="font-medium">1. 订阅技能说明</h3>
        <p className="text-slate-600">把下面的接入说明发给 Agent；支持 SKILL.md 的客户端也可将技能文档保存到自己的技能目录。</p>
        <a href={skill} target="_blank" rel="noopener noreferrer" className="block text-brand-700 underline break-all">查看 / 下载 SKILL.md</a>
        <a href={manifest} target="_blank" rel="noopener noreferrer" className="block text-brand-700 underline break-all">{manifest}</a>
        <p className="text-xs text-slate-500">订阅采用主动拉取：每次使用前读取清单版本并更新文档。不会自动安装或推送；不支持自动更新的客户端请手动更新。</p>
        <p className="rounded bg-slate-50 p-3 break-words text-xs leading-relaxed">{instruction}</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => copy(instruction)} className="px-3 py-2 rounded bg-brand-600 text-white">复制接入说明</button>
          <button type="button" onClick={() => copy(manifest)} className="px-3 py-2 rounded border border-slate-300">复制订阅地址</button>
        </div>
      </div>
      <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
        <h3 className="font-medium">2. 配置账户授权</h3>
        <p className="text-slate-600">在可信客户端通过 <code>/api/auth/token-login</code> 使用已关联的 Health 账号登录，取得 Edu token，并存入客户端的秘密存储。不要把密码或 token 发到聊天中。</p>
        <pre className="text-xs bg-slate-50 p-3 rounded whitespace-pre-wrap break-all">{config}</pre>
        <p className="text-xs text-slate-500">这是通用 HTTP 配置示例，需按客户端方式填写，并非 MCP 配置。Health 登录模式的 Edu token 有效期为 8 小时；到期需重新登录。网页登录不会自动授权外部 Agent。</p>
      </div>
      <div className="space-y-2 text-sm border-t border-slate-100 pt-3">
        <h3 className="font-medium">3. 验证并开始使用</h3>
        <p className="text-slate-600">请 Agent 先请求 <code>/api/auth/me</code> 确认身份，再尝试“总结我的学习进度”或“查看最近考试和错题”。返回 401 时重新登录；403 时检查账号关联与权限。</p>
        <p className="text-xs text-slate-500">只具备网页阅读能力的 Agent 可以阅读说明；查询个人数据还需支持带认证请求的 HTTP 工具。本入口不提供专用 API key 或 MCP 服务。</p>
      </div>
      {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
    </section>
  )
}
