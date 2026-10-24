# Edu 通过 Health 统一登录

用户已选择：Edu 跳转 Health 完成登录后返回，保留现有课表与成绩。浏览器采用跳转；原生 App 保持已安装版本的接口，由 Edu 后端把输入凭据交给 Health 验证，无需新包。

基线：Edu `cd33b4ddc6664c023dc7307f0021a06cdcf9446c`；Health `59c64cca666d85f3c7b738a508dd197d4ad6c84e`。Health 原工作区有其他未提交改动，候选位于 `/tmp/edu-health-sso-health`。

## 身份与数据边界

- Health 负责验证用户名、密码及当前账号状态；浏览器流程 Edu 不接收 Health 密码。旧原生 App 的兼容接口瞬时转交 Health 密码并接收登录响应，不持久化密码、Health token 或用户画像。
- 首期显式绑定一个 Health subject 到一个既有 Edu user ID；不按姓名、用户名或数值 ID 相等自动关联，不转移业务数据。
- Health 仅接受本人 Web cookie 会话签发票据，拒绝 API key、Bearer、代理模式与未批准/禁用/托管账号。
- 票据使用独立于其他系统的 HMAC secret，绑定 issuer、Edu audience、subject、随机 state、签发时间和 60 秒有效期。
- Edu 将随机 state 和浏览器 cookie 的散列存入 SQLite；校验后在事务中一次性删除。跨浏览器、过期、重放均失败。
- 登录后 Edu 会话最长 8 小时；Health 退出或停用账号不会主动撤销已经签发的 Edu 会话。需要即时撤销时应另行增加服务端会话检查，当前不可宣称全局单点退出。
- 启用后 Edu 本地密码登录/注册、旧 token 和旧 cookie 被拒绝；旧 App token-login 走 Health 密码验证和专用原生票据，返回原格式 Edu token。默认关闭，便于在完成映射和验收后切换。
- 不执行线上数据迁移、账号关联、commit、push 或部署。

## 配置与切换

Health：`EDU_SSO_ENABLED=true`、`EDU_SSO_SECRET`、`EDU_SSO_OWNER_ID`、`EDU_SSO_ORIGIN=https://edu.executor.life`、`EDU_SSO_ISSUER=https://health.executor.life`。

Edu：`EDU_HEALTH_SSO_ENABLED=1`、`EDU_HEALTH_SSO_SECRET`（与 Health Edu 专用 secret 相同）、`EDU_HEALTH_SSO_SUBJECT`（Health 用户 ID）、`EDU_HEALTH_SSO_USER_ID`（经确认的原有 Edu 用户 ID）、`EDU_HEALTH_SSO_ORIGIN=https://edu.executor.life`、`EDU_HEALTH_SSO_ISSUER=https://health.executor.life`。

secret 至少 32 字符，必须从秘密配置注入，不入库、不写日志。用户 ID 映射必须在切换前以现有两个账号的实际身份确认；当前候选没有填入真实映射。

先发布默认关闭的两端候选；核对无备份发布策略与部署 revision，再配置映射并开启；验证真实浏览器 Health 登录、返回 Edu、课表/成绩归属、退出、过期与旧密码拒绝。只有端到端证据齐全才能称为上线。回滚需同时关闭两侧开关；这将恢复 Edu 原有密码认证，须明确告知使用者。新增 pending 表无业务数据，回滚无需删除。

## 验证证据

- Edu 首次红测：17 项失败，缺失 SSO 路由与旧入口限制。
- Edu 后端 SSO、原认证、租户隔离、课表及跨仓库实际票据契约：51 passed。
- Edu 前端 3 项测试和生产构建通过；Health 后端 43 项、前端 12 项、类型检查、API 生成物、System Map 和 CSP smoke 通过。
- 真实 Health issuer → Edu callback 跨仓库测试通过（合成身份），原有课程归属、8 小时会话过期及映射变化失效已有测试覆盖。
- 独立安全复审：GO，仅适用于默认关闭的浏览器候选；不代表生产启用通过。
- 线上配置、真实账号登录、原生 App 实际账号登录：未执行。

## 同源与代理

统一登录启用时不注册跨域凭证授权；写请求要求 Origin 等于配置的 Edu origin。Health 回调另行要求 Health origin 与已签名的一次性浏览器请求。Health Next 为 Edu 票据路由设置精确重写，生产 Nginx 原样代理 `/api/v1/`；避免开发入口重复 `/v1`。

Edu 的 Nginx 必须覆盖传入 `X-Forwarded-Proto`，后端 Gunicorn 只监听 loopback 并使用其可信代理 scheme 支持。不得把任意互联网客户端提供的转发头直接当作可信信息。

本地复现：

```sh
HEALTH_SSO_CONTRACT_ROOT=/tmp/edu-health-sso-health \
HEALTH_SSO_CONTRACT_PYTHON=/Users/liqiuhua/work/personal/health-llm-driven/backend/venv/bin/python \
python3 -m pytest backend/tests/test_health_sso.py backend/tests/test_auth_and_isolation.py backend/tests/test_bearer_token.py backend/tests/test_schedule.py -q
cd frontend
npm test -- --run src/healthAuth.test.tsx
npm run build
```

## 独立复审结果

只读 reviewer 已检查两端工作差异与新文件，最终 GO。受审源码 bundle SHA-256：Edu `030dc80c6a1ba97e8cacb498719ffcfc3ca5e2ebde14438a50ebb8c77afbabf5`；Health `20f38b973cf2ac06b43d068458a149418ca41b6aa87f729b0d0b343c4aba5c6e`。这是源码包指纹，不是 commit 或部署制品。

待完成：两端提交/发布授权与精确 revision 完整发布门禁；真实浏览器和原数据验收。当前停留在已验证浏览器候选，没有线上切换。

## 账号核对进展

2026-10-24：用户指定 Health 邮箱后，对生产 Health 进行了精确邮箱/用户名过滤的只读查询，并核对 Edu 原数据账号及课程归属。Health 返回唯一、启用、已审核、非托管账号；Edu 目标为已有学生账号，包含两个孩子的课程。身份对应关系已确定。

真实邮箱、用户名与内部 ID 不写入版本控制文档。两侧待发布配置保存在仓库外私有目录 `~/.config/edu/sso-pending/`，目录 0700、文件 0600，开关仍关闭；尚未配置共享密钥或修改生产环境。发布已由用户明确授权；原生兼容代码已补齐，发布门禁与真实登录验收仍待完成。

## 已安装原生 App 兼容

旧 `/api/auth/token-login` 接口保持 `user`/`token` 响应形状。输入的 Health 凭据仅转交固定 HTTPS Health `/login/json`，禁用重定向与环境代理；随后用短暂 Health JWT 调用仅允许本人 JWT 的专用原生票据接口。Edu 校验与浏览器隔离的 purpose/signature prefix、subject、state 与 TTL 后签发 8 小时 Edu token。失败不回退到 Edu 密码库，错误不透传上游正文。原生 token 写操作不依赖 Origin，必须先验证 provider/subject/issuer/用户 ID；Cookie 写操作继续同源限制。

原生注销沿用旧 App 清除 Keychain token；现有密码删除账号入口在统一登录模式下仍拒绝，不能误称支持所有账号管理操作。

## 发布续接（用户明确授权）

用户要求完成发布切换并支持原来的 App。原生兼容采用原接口向 Health 转交凭据的方案，不要求升级二进制。认证安全独立复审 GO。Edu 完整后端 141 passed / 2 skipped（两个跨仓库测试另以配对运行通过），前端 15 passed；额外原生 8 小时过期测试通过。Health 浏览器/原生/KBase 后端 48 passed，前端 12 passed；发布器相关 109 passed / 1 skipped。所有跳过项不能当成端到端生产证据。

Edu 原无远端 CI，本次增加后端全测、前端测试/构建与发布脚本检查 workflow，发布须等待对应 commit 的运行结果。Health 生产基线和现有授权均为 `59c64cca666d85f3c7b738a508dd197d4ad6c84e`，预检时无业务发布锁；Edu 线上使用 rsync，Git HEAD 不能代表当前已部署源码，需按候选逐文件摘要复验。
