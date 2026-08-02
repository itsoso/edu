# 2026-08-02 TestFlight 发布档案

## S0 Intake

- 用户原话：`发一个testflight版本`
- 范围确认：用户确认按当前工作区全部改动作为同一发布批次；先完成测试和整理提交，再部署后端/前端，最后上传 TestFlight。
- 目标用户：EduMobile 的 TestFlight 内部测试用户。
- 目标：让当前移动端功能及其依赖的服务端接口形成可复现、可验证的发布版本。

## 当前状态

- 阶段：G4 PASS，准备提交干净发布快照
- 状态：IN_PROGRESS
- 目标分支：`main`
- iOS 技术栈：React Native 0.76 bare workflow；Xcode archive + App Store Connect/TestFlight。
- Bundle ID：`life.executor.edu.mobile`
- Marketing version：`1.0`
- 待发布 build：`11`（已写入项目设置，发布时使用已提交 build 号）。

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
| G5 部署健康 | PENDING | 服务端部署及生产健康/smoke 待验证。 |
| G6 上线验证 | PENDING | TestFlight 上传处理状态和内部测试可见性待验证。 |

## 回滚计划

- 服务端：部署失败或健康检查失败时，恢复到发布前服务端提交并重启服务，再重复健康检查。
- TestFlight：已上传 build 不覆盖旧 build；停止分发新 build，并将内部测试组继续指向上一个已验证 build。

## 发布证据

- 部署前生产基线：`https://edu.executor.life/api/health` 返回 `{\"ok\":true}`；生产主机 `47.237.191.17:22222`，`/opt/edu` 存在，`edu-backend` active。
- G3：backend `108 passed`；frontend `8 files / 12 tests passed`，Vite production build 成功；mobile TypeScript 和 ESLint error 为 0，Jest `5 passed`；iOS Release device build 成功；`test_push_config.sh` 与 `test_testflight_config.sh` 通过。
- 数据安全整改：`rsync` 明确排除 `*.db-wal` / `*.db-shm`；上线前须用 SQLite `.backup` 生成一致性备份。
- 隐私与超时整改：拍照解题、范文生成均改为后台任务 + 客户端轮询；范文 prompt 只使用用户确认的主题、类型、字数元数据。
- 登录 smoke：部署后创建唯一临时学生，执行 token 登录与 Bearer `/api/auth/me`，删除账号并验证不可再解析；trap 负责失败路径清理。
