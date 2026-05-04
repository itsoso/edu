# TestFlight 发布指南

> 让 EduMobile 走 App Store Connect → TestFlight 链路, 摆脱免费证书 7 天过期 + 3 app 上限的限制.
>
> 跟 HealthPilot 用 EAS 等价, 但我们 bare RN 走的是 Xcode Archive + altool 直传, 不依赖 Expo.

## 一次性准备 (大概 30 分钟)

### 1. App Store Connect 创建 app record

打开 <https://appstoreconnect.apple.com/apps>, 用你的 Apple ID (panbaokun@gmail.com) 登录.

点 **+ → New App**:
- **Platforms**: iOS
- **Name**: `EduMobile`  (商店里显示的名字, 12-30 字符)
- **Primary Language**: 简体中文
- **Bundle ID**: 选 `life.executor.edu.mobile` (如下拉里没有, 先去 [Identifiers](https://developer.apple.com/account/resources/identifiers/list) 注册一个)
- **SKU**: `edu-mobile-001` (随便填, 内部识别用)
- **User Access**: Full Access

创建后记下页面右上角的 **Apple ID** (一串数字, 比如 `6789012345`) — 后面 `eas.json` 里会叫 `ascAppId`. **我们的脚本不需要它**, altool 凭 bundle id 自动找.

### 2. 选一种上传凭据

脚本支持 3 种, 自动按优先级选. 推荐第 1 种.

#### 选项 A — App-Specific Password (最简, 推荐)

打开 <https://appleid.apple.com> → 登录 → **登录与安全 → App 专用密码 → 生成**:
- 起名: `edu-testflight`
- 拿到一串 16 位密码 (形如 `xxxx-xxxx-xxxx-xxxx`)

加到 `~/.zshrc`:
```bash
export EDU_APPLE_ID="panbaokun@gmail.com"
```

不用把密码也写到 .zshrc — 第一次跑脚本时会问你, 输完自动存进 macOS Keychain, 以后免输.

#### 选项 B — App Store Connect API Key (CI 用)

打开 <https://appstoreconnect.apple.com/access/api> → **Keys** tab → **Generate API Key**:
- Name: `edu-testflight-cli`
- Access: `App Manager`

下载 `.p8` 文件 → `mkdir -p ~/.appstoreconnect/private_keys && mv ~/Downloads/AuthKey_*.p8 ~/.appstoreconnect/private_keys/`

加到 `~/.zshrc`:
```bash
export EDU_ASC_KEY_ID="ABC123DEF4"
export EDU_ASC_ISSUER_ID="69a6de7f-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
export EDU_ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_ABC123DEF4.p8"
```

#### 选项 C — Transporter app (零配置)

什么环境变量都不设. 脚本生成 IPA 后自动 `open -a Transporter`, 你点 Deliver 完事.

前提: Mac App Store 装 [Transporter](https://apps.apple.com/app/transporter/id1450874784) (免费 Apple 官方).

### 4. 把自己加到 Internal Tester

打开 ASC → My Apps → EduMobile → **TestFlight** tab → **Internal Testing** → 创建一个 group (如 "家庭"), 把自己 (panbaokun@gmail.com) 加进去.

> Internal tester 不需要审核, 上传完几分钟就能装, 方便迭代. External 才走 Apple 审核 (1-3 天).

iPhone/iPad 装一下 [TestFlight app](https://apps.apple.com/app/testflight/id899247664) (App Store 直接搜).

## 日常发布

```bash
# 一键: 自动 +1 build, archive + export + upload
./deploy/testflight.sh
```

成功后:
- 大约 10-30 分钟 ASC 处理完毕, 邮件通知
- 在 ASC TestFlight tab 下能看到新 build
- 把 build 加到你的 Internal Testing group (一次性配, 之后新 build 自动加)
- iPhone / iPad 打开 TestFlight app → EduMobile → 更新 → 装

### 调试模式

```bash
# 只 archive, 不 export 不 upload (验证 archive 流程能跑)
ARCHIVE_ONLY=1 ./deploy/testflight.sh

# Archive + export 出 .ipa, 不上传 (验证 IPA 大小、内容)
SKIP_UPLOAD=1 ./deploy/testflight.sh
```

## 版本号管理

- **Build number** (`CFBundleVersion`): 脚本每次 +1, 必须递增 (TestFlight 不接受重复)
- **Marketing version** (`CFBundleShortVersionString`, 也叫 MARKETING_VERSION): 用户在 App Store 看到的 1.0 / 1.1 / 2.0. 改这个要去 `mobile/ios/EduMobile.xcodeproj/project.pbxproj` 里 `MARKETING_VERSION = 1.0;` 那行手动改.

约定: 每次重大功能 +0.1 marketing, 修小 bug 只 +1 build.

## 常见错误

### `No Account for Team "QA2U724DAN"`
Xcode 里没登录 Apple ID, 或登录的不是这个 team.
- 打开 Xcode → Settings → Accounts → 确认 panbaokun@gmail.com 已登录, 且能看到 team `QA2U724DAN`.

### `Provisioning profile doesn't include signing certificate`
Distribution cert 没生成. `signingStyle=automatic` 时 Xcode 会自动生成, 第一次 archive 慢一点.
- 命令行触发不了的话, 用 Xcode 一次: `open mobile/ios/EduMobile.xcworkspace` → Product → Archive (一次), 让 Xcode 弹 dialog 配证书. 之后命令行就行.

### `Apple Generic Versioning is not enabled`
.pbxproj 里 `VERSIONING_SYSTEM = "apple-generic"` 已经设了, 应该不会出.

### `altool: No suitable application records were found`
ASC 上还没创建 app record (步骤 1 漏了), 或 bundle id 不匹配.

### `ITMS-90713: Missing Info.plist value`
某个 `NS*UsageDescription` 漏了. 看 altool 输出具体哪个 key, 加到 `mobile/ios/EduMobile/Info.plist`.

### upload 卡住
altool 上传比较慢 (200MB+ IPA 可能 5-15 分钟). 网络差时换 wifi.

## 与 push.sh 的区别

| 用途 | push.sh | testflight.sh |
|---|---|---|
| 后端 + Web | ✅ | ✗ |
| iOS 装到自己设备 | ✗ (用 install 子命令) | ✗ |
| iOS 上 TestFlight | ✗ | ✅ |
| iOS 上 App Store | ✗ | ✅ (后续从 TestFlight 提交审核) |

平时迭代:
- 改后端 / web → `./deploy/push.sh`
- 改 iOS 想给家人装 → `./deploy/testflight.sh` (然后 TestFlight app 收新版)
- 改 iOS 自己测 → 用 `xcodebuild ... -destination "id=..."` + `devicectl install` 直接装

## 进一步: 上 App Store

走完几个 TestFlight build 稳定后:
1. ASC TestFlight 给一个 build 点 **Submit for Review** (App Store)
2. 填 metadata (描述、截图、隐私政策 URL、支持 URL)
3. 1-3 天 Apple 审核
4. 通过 → 上架 (你可以选自动发布 or 手动)
