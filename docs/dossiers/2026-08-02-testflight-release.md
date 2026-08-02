# 2026-08-02 TestFlight 发布档案

## S0 Intake

- 用户原话：`发一个testflight版本`
- 范围确认：用户确认按当前工作区全部改动作为同一发布批次；先完成测试和整理提交，再部署后端/前端，最后上传 TestFlight。
- 目标用户：EduMobile 的 TestFlight 内部测试用户。
- 目标：让当前移动端功能及其依赖的服务端接口形成可复现、可验证的发布版本。

## 当前状态

- 阶段：G6 PASS，发布完成
- 状态：COMPLETE
- 目标分支：`main`
- iOS 技术栈：React Native 0.76 bare workflow；Xcode archive + App Store Connect/TestFlight。
- Bundle ID：`life.executor.edu.mobile`
- Marketing version：`1.0`
- 已发布 build：`11`
- 发布快照：`cbdf97a0b3ccb00d0436a6f6058a805df398d060`

## S1 现状勘察

- 项目没有 `docs/system-map/INDEX.md`，因此按仓库 `CLAUDE.md`、`README.md`、`deploy/TESTFLIGHT.md` 和发布脚本核对现状。
- 当前工作区含跨 backend、frontend、mobile 的同批未提交改动；移动端新入口依赖新增后端接口，不能只上传客户端。
- `main` 相对 `origin/main` 领先 2 个文档提交。
- 发布脚本 `deploy/testflight.sh` 使用 Xcode archive/export 和 `altool`；若无 CLI 上传凭据则使用 Transporter。
- 已发现 iOS build number 来源漂移：项目设置为 `10`，App Info.plist 被硬编码为 `10`，会绕过脚本后续自增。

## Gate 记录

| Gate | 状态 | 证据 / 裁决 |
|---|---|---|
| G1 准入 | PASS | 用户明确要求发布 TestFlight，并确认发布当前全部改动。 |
| G2 可行性 + 风险压测 | PASS | 已确认正确生产服务器、发布通道和回滚需求；iOS 26.5 平台组件安装完成。 |
| G3 测试 | PASS | 后端 108/108；前端 12/12 + production build；移动端 TypeScript、ESLint error、Jest 5/5；iOS Release device build（无签名）成功；发布脚本回归检查通过。 |
| G4 评审 | PASS | 第三轮独立复审确认所有 P0/P1 闭环；Web scan-solve 轮询及真实临时账号 token 登录 smoke 均有回归证据。 |
| G5 部署健康 | PASS | 发布前 SQLite/source/Nginx/service 配置备份完整；生产部署成功，Nginx 配置检查、后端服务、公开健康检查、首页、9 MiB 请求转发、临时账号全链路 smoke 和数据库完整性均通过。 |
| G6 上线验证 | PASS | Apple 预检与正式上传均无错误；build `1.0 (11)` 为 `VALID`，出口合规已确认，已进入内部测试组 `friends-and-family`。 |

## 回滚计划

- 服务端：从 `/opt/edu-backups/20260802T055146Z-pre-cbdf97a` 恢复 SQLite 一致性备份、源代码及 Nginx/service 配置，重启服务后重复健康检查与登录 smoke。
- TestFlight：已上传 build 不覆盖旧 build；停止分发新 build，并将内部测试组继续指向上一个已验证 build。

## 发布证据

- 部署前生产基线：`https://edu.executor.life/api/health` 返回 `{\"ok\":true}`；生产主机 `47.237.191.17:22222`，`/opt/edu` 存在，`edu-backend` active。
- G3：backend `108 passed`；frontend `8 files / 12 tests passed`，Vite production build 成功；mobile TypeScript 和 ESLint error 为 0，Jest `5 passed`；iOS Release device build 成功；`test_push_config.sh` 与 `test_testflight_config.sh` 通过。
- 数据安全整改：`rsync` 明确排除 `*.db-wal` / `*.db-shm`；上线前须用 SQLite `.backup` 生成一致性备份。
- 隐私与超时整改：拍照解题、范文生成均改为后台任务 + 客户端轮询；范文 prompt 只使用用户确认的主题、类型、字数元数据。
- 登录 smoke：部署后创建唯一临时学生，执行 token 登录与 Bearer `/api/auth/me`，删除账号并验证不可再解析；trap 负责失败路径清理。
- 发布提交：`cbdf97a0b3ccb00d0436a6f6058a805df398d060` 已推送至 `origin/main`；远端关键源文件和前端构建产物的校验和与本地一致。
- 生产备份：`/opt/edu-backups/20260802T055146Z-pre-cbdf97a`；SQLite `.backup` 通过 `integrity_check`。数据库 SHA-256 `5721eb0bf6d6ee4972779607b6a66690d3af820fe5d37200180598425f1670af`，源代码归档 SHA-256 `722334b8763d37152abe88a702550816822b9e5f3a866e6cdc53f49ab6809646`，Nginx 配置 SHA-256 `7334c21087d8074b52f6ed65e16200939792bf5e7fc8ca27fa6a8e8ff9bc64d1`。
- 生产验证：`edu-backend` active；`https://edu.executor.life/api/health` 与首页正常；9 MiB 未认证请求到达后端并返回 `401` 而非 Nginx `413`；临时账号注册 → token 登录 → Bearer `/api/auth/me` → 删除 → 删除后不可解析全链路通过，临时用户残留为 0，生产数据库完整性检查通过。
- 签名与制品：App Store provisioning profile API ID `92R46DS63H`、UUID `dd7072ea-e2aa-4b62-8a29-fe17d9571fce`，匹配当前 Apple Distribution 证书；IPA 大小 `13051595` 字节，SHA-256 `440c7979334f638fecdc643aa93a8f54dcea7ae420ff3678d7e76eda170e01cf`，包内版本、build、profile、`get-task-allow=false`、`beta-reports-active=true` 均核验通过。
- Apple 回执：`altool --validate-app` 为 `VERIFY SUCCEEDED with no errors`；正式上传为 `UPLOAD SUCCEEDED with no errors`，Delivery UUID `f66d2303-80d2-4e3a-bd5f-68eb3db9d58a`。
- TestFlight：App Store Connect build ID `f66d2303-80d2-4e3a-bd5f-68eb3db9d58a`；上传 `COMPLETE` 且 errors/warnings/infos 均为空；处理状态 `VALID`；`usesNonExemptEncryption=false`；内部组 `friends-and-family` 的构建关系已包含 build 11。
