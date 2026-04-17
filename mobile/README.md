# edu-mobile — React Native MVP

React Native (Expo) 版本，和 web 版共享后端 (`backend/`)。

**这是 MVP**：目前只实现了最小验证链路 (登录/注册/今日)。完整功能用 web 版 https://YOUR_DOMAIN

## 技术栈

- **Expo** managed workflow (不需要 native SDK 配置)
- **React Navigation** 原生导航
- **expo-secure-store** 存 bearer token (iOS Keychain / Android Encrypted SharedPreferences)
- **后端认证**：`POST /api/auth/token-login` → bearer token → `Authorization: Bearer <token>`

## 目录

```
mobile/
├── App.tsx                      # 路由 + AuthProvider
├── index.ts                     # 入口
├── app.json                     # Expo 配置 (apiBaseUrl 在 extra 里)
├── package.json
├── tsconfig.json
├── babel.config.js
└── src/
    ├── lib/
    │   ├── api.ts              # HTTP 客户端 + bearer token
    │   ├── auth.tsx            # AuthContext
    │   └── theme.ts            # 颜色常量
    └── screens/
        ├── LoginScreen.tsx
        ├── RegisterScreen.tsx
        └── TodayScreen.tsx     # 今日任务打卡
```

## 快速开始

### 1. 安装依赖

```bash
cd mobile
npm install
```

### 2. 指向你的后端

编辑 `app.json` 里的 `extra.apiBaseUrl`:
```json
"extra": { "apiBaseUrl": "https://your-deployed-domain.com" }
```

或者本地开发指向本地后端 (同 Wi-Fi 的电脑 IP):
```json
"extra": { "apiBaseUrl": "http://192.168.x.x:5060" }
```
（不能用 `localhost`，手机解析不到电脑）

### 3. 启动

```bash
npm start
```

Expo DevTools 会开一个网页，扫码或在模拟器里运行。

### 4. 在 iPhone/iPad 真机预览

- App Store 装 **Expo Go**
- 手机和电脑连同一 Wi-Fi
- 扫 `expo start` 终端里的 QR 码

### 5. 打包 App Store 版本

用 EAS Build（Expo 的云构建）:
```bash
npm install -g eas-cli
eas login
eas build --platform ios
```

需要 Apple Developer Account (¥688/年)。

## 当前 MVP 支持的功能

- ✅ 学生/家长注册 (含 join_code 绑定)
- ✅ 登录 / Token 持久化 (SecureStore)
- ✅ 今日任务列表 + 打卡
- ✅ 周切换 (1-4)

## 未迁移的 web 功能 (TODO 按需)

- ❌ 趋势图 (需要 victory-native)
- ❌ 错题本
- ❌ 扫试卷 (需要 expo-camera)
- ❌ 训练 / AI 批改
- ❌ 日记 (多媒体录制)
- ❌ 作文管理
- ❌ 月度复盘
- ❌ 方法卡 / 完整分析 (Markdown 渲染)

每个功能移植的工作量约 0.5-2 天。**推荐的做法：用户真的开始用 Mobile 版、
反馈哪些功能最需要，再逐个移植，而不是一次性全做。**

## 和 Web 版的权衡

- **共享**：后端 100% 复用，用户数据互通 (bearer token vs session cookie)
- **不共享**：前端 UI 代码完全独立，改动不同步

所以这个项目是双前端单后端架构。web 改动只影响 web，mobile 改动只影响
mobile。共享逻辑（如 API 契约）靠两边的 TS 类型手动保持一致。
