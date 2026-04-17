# edu-mobile — Bare React Native

原生 React Native (CLI) 项目，**不用 Expo**，和 web 版共享后端。

在 iPhone 和 iPad 上都可以安装运行，支持未来提交到 App Store。

## 技术栈

- **React Native 0.76.5 (CLI, 无 Expo)** — 真原生 UI, 不是 WebView
- **React Navigation 6** (`native-stack`) — 原生导航栈
- **react-native-keychain** — token 存在 iOS Keychain / Android Keystore
- **React Native Safe Area Context** — 刘海屏适配

和后端的认证方式:
- Web 端: `Flask session cookie` (不变)
- 移动端: `Authorization: Bearer <token>` — `POST /api/auth/token-login` 拿 token

两种认证**并存**在同一后端, Web 行为不受影响.

## 目录

```
mobile/
├── App.tsx                      # 入口 + Navigator + AuthProvider
├── index.js                     # AppRegistry.registerComponent
├── ios/                         # 原生 iOS 工程 (Xcode, CocoaPods)
│   ├── EduMobile.xcworkspace    # 用这个打开, 不是 .xcodeproj
│   ├── EduMobile/Info.plist
│   └── Podfile
├── android/                     # 原生 Android 工程 (Gradle)
├── package.json
├── src/
│   ├── lib/
│   │   ├── api.ts              # HTTP 客户端 + bearer token + Keychain
│   │   ├── auth.tsx            # AuthContext (login / register / logout)
│   │   ├── config.ts           # API_BASE_URL
│   │   └── theme.ts            # 颜色常量 (对齐 web 的 brand/slate 色板)
│   └── screens/
│       ├── LoginScreen.tsx
│       ├── RegisterScreen.tsx
│       └── TodayScreen.tsx     # 今日任务 + 周切换 + 打卡
└── README.md
```

## 环境要求

必须本地有:

- **Node.js >= 18**
- **Xcode 15+** (已装于 `/Applications/Xcode.app`)
- **CocoaPods >= 1.13** (`pod --version` 验证, `brew install cocoapods` 装)
- **Ruby** (系统自带)

可选:
- Android Studio + Android SDK (跑 Android 才需要)

## 快速开始

### 1. 安装 JS 依赖

```bash
cd mobile
npm install --legacy-peer-deps
```

### 2. 安装 iOS 原生依赖 (CocoaPods)

```bash
cd ios
export LANG=en_US.UTF-8
pod install
cd ..
```

首次 `pod install` 约 5 分钟 (下 68 个 Pod).

### 3. 启动 Metro

```bash
npm start
```

### 4. 跑 iOS

**模拟器:**
```bash
npm run ios
# 指定设备: npx react-native run-ios --simulator="iPhone 17 Pro Max"
```

**真机 (iPhone/iPad, Mac 连数据线):**

用 Xcode 打开 `mobile/ios/EduMobile.xcworkspace`, 选中真机, Run.
首次需要配置 Signing Team (免费 Apple ID 也可以).

### 5. 跑 Android (可选)

```bash
npm run android
```

## API 端点配置

编辑 `src/lib/config.ts`:

```typescript
export const API_BASE_URL = 'https://edu.executor.life'
```

**本地开发指向本地后端** (手机要能访问到的 IP, 不是 localhost):
```typescript
export const API_BASE_URL = 'http://192.168.x.x:5060'
```

## 当前 MVP 已实现

- ✅ 学生 / 家长注册 (含 join_code 家长绑定)
- ✅ 登录 / Token 持久化 (Keychain)
- ✅ 今日任务列表 + 打卡 (tap 切换)
- ✅ 周切换 (1-4)
- ✅ Pull-to-refresh
- ✅ 绑定码展示 (学生)

## 未迁移的 web 功能 (按需逐个移植)

每个约 0.5-2 天工作量:

| 功能 | 需要的原生 API |
|---|---|
| 趋势图 | `victory-native` 或 `react-native-svg` |
| 错题本 | 纯 UI (API 共享) |
| 扫试卷 | `react-native-image-picker` 或 `react-native-vision-camera` |
| 训练 + AI 批改 | 纯 UI + 轮询 |
| 日记多媒体 | `react-native-audio-recorder-player` + `react-native-video` |
| 月度复盘 | `react-native-markdown-display` |
| 作文管理 | 文档选择 `react-native-document-picker` |
| 数学公式渲染 | `react-native-math-view` (KaTeX native) |

**推荐策略**: 用户真的开始用 Mobile 版后, 根据反馈优先级逐个移植, 不要一次性做全量.

## 打包上 App Store

1. Apple Developer Account ($99/年)
2. Xcode → Product → Archive
3. Distribute App → App Store Connect → Upload
4. 在 App Store Connect 配 metadata 提审

详见 Apple 官方文档.

## 和 Web 版的关系

- **后端 100% 共享** (一套 `backend/`, 两种认证方式)
- **前端完全独立** (web: React/Tailwind; mobile: RN/StyleSheet)
- **共享 API 契约靠手动** (两边 TS 类型需要同步更新)

修改 API 时记得更新两边的 `api.ts`.

## 故障排查

**`pod install` 报 `Invalid Podfile: Error: Unknown prop type ...`**
- `react-native-screens` 版本和 RN 不兼容. 装 `~3.35.0` + navigation v6
- 已在本项目固定版本

**`No bundle URL present`**
- Metro 没启动. `npm start` 先

**iOS 真机 "Could not find a valid device"**
- Xcode 里手动选 Signing Team
- 或 `xcrun xctrace list devices` 验证设备 UDID

**修改 RN 代码不生效**
- Metro 的 `r` 或模拟器 Cmd+R 重载
- 如果改了 `ios/` 原生代码需要重新 `npm run ios`
