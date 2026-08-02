#!/usr/bin/env bash
# 一键 TestFlight 发布脚本 (bare React Native, 不依赖 Expo/EAS)
#
# 流程:
#   1. 自动 +1 build number (CFBundleVersion)
#   2. xcodebuild archive (Release configuration)
#   3. xcodebuild -exportArchive 出 .ipa
#   4. xcrun altool --upload-app 上传到 App Store Connect
#   5. 提示: ~10-30 分钟后 build 在 TestFlight 出现, 处理完即可发给测试员
#
# 前置 (一次性):
#   A. App Store Connect 已为 life.executor.edu.mobile 创建 app record
#   B. 选一种凭据 (脚本按优先级自动选):
#      [推荐] App-Specific Password (最简, 16 位密码):
#         去 https://appleid.apple.com → 登录与安全 → App 专用密码 → 生成
#         export EDU_APPLE_ID="panbaokun@gmail.com"
#         脚本第一次会问你密码, 自动存进 macOS Keychain, 之后免输
#      [CI] App Store Connect API Key (.p8 文件):
#         export EDU_ASC_KEY_ID="ABCDEFGHIJ"
#         export EDU_ASC_ISSUER_ID="69a6de7f-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
#         export EDU_ASC_KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_ABCDEFGHIJ.p8"
#      [都不配] 自动启动 Transporter app, 你拖一下点 Deliver
#
# 用法:
#   ./deploy/testflight.sh                    # 普通发布
#   SKIP_UPLOAD=1 ./deploy/testflight.sh      # 只 archive + export, 不上传 (sanity)
#   ARCHIVE_ONLY=1 ./deploy/testflight.sh     # 只 archive 不 export 不 upload
#   SKIP_BUILD_BUMP=1 ./deploy/testflight.sh  # 使用已提交的 build 号, 保持源码干净

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PROJ_ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
IOS_DIR="$PROJ_ROOT/mobile/ios"

WORKSPACE="$IOS_DIR/EduMobile.xcworkspace"
SCHEME="EduMobile"
CONFIGURATION="Release"
BUILD_DIR="$IOS_DIR/build-archive"
ARCHIVE_PATH="$BUILD_DIR/EduMobile.xcarchive"
EXPORT_DIR="$BUILD_DIR/export"
EXPORT_OPTIONS="$IOS_DIR/ExportOptions.plist"
INFO_PLIST="$IOS_DIR/EduMobile/Info.plist"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step()  { color '1;36' "==> $*"; }
ok()    { color '1;32' "✓ $*"; }
fail()  { color '1;31' "✗ $*"; exit 1; }

# ---------------------------------------------------------------
step "Prerequisites check"

if [[ ! -f "$EXPORT_OPTIONS" ]]; then
    fail "$EXPORT_OPTIONS not found"
fi

# 决定上传方式 (按优先级):
#   1. ASC API key (.p8 + key id + issuer)            CI 用
#   2. App-specific password (Apple ID + 16位密码)    日常推荐
#   3. 都没有                                          降级到 Transporter app
UPLOAD_MODE="transporter"
if [[ -n "${EDU_ASC_KEY_ID:-}" && -n "${EDU_ASC_ISSUER_ID:-}" && -n "${EDU_ASC_KEY_PATH:-}" && -f "${EDU_ASC_KEY_PATH:-}" ]]; then
    UPLOAD_MODE="api_key"
    ok "found ASC API key → altool 自动上传"
elif [[ -n "${EDU_APPLE_ID:-}" ]]; then
    # 优先看 keychain 里有没有 app-specific password
    if security find-generic-password -s "edu-tf-altool" -a "$EDU_APPLE_ID" >/dev/null 2>&1; then
        UPLOAD_MODE="app_password_keychain"
        ok "found app-specific password in keychain → altool 自动上传"
    elif [[ -n "${EDU_APP_PASSWORD:-}" ]]; then
        UPLOAD_MODE="app_password_env"
        ok "found EDU_APP_PASSWORD env var → altool 自动上传 (会存进 keychain)"
    else
        UPLOAD_MODE="app_password_prompt"
        ok "EDU_APPLE_ID 已设, 上传前会问你要 app-specific password (一次性, 之后存 keychain)"
    fi
else
    ok "未设任何凭据 → 降级到 Transporter (生成 IPA 后自动打开, 你点 Deliver)"
fi

# ---------------------------------------------------------------
step "Bumping build number (CURRENT_PROJECT_VERSION in .pbxproj)"

PBXPROJ="$IOS_DIR/EduMobile.xcodeproj/project.pbxproj"
[[ -f "$PBXPROJ" ]] || fail "pbxproj not found: $PBXPROJ"

CURRENT_BUILD=$(grep -m1 -E '^[[:space:]]+CURRENT_PROJECT_VERSION = [0-9]+;' "$PBXPROJ" | grep -oE '[0-9]+' | head -1)
[[ -n "$CURRENT_BUILD" ]] || fail "could not parse CURRENT_PROJECT_VERSION"
NEXT_BUILD=$((CURRENT_BUILD + 1))

if [[ -n "${SKIP_BUILD_BUMP:-}" ]]; then
    NEXT_BUILD=$CURRENT_BUILD
    ok "using committed build $CURRENT_BUILD (SKIP_BUILD_BUMP)"
else
    # 同时更新所有 CURRENT_PROJECT_VERSION = N; 行
    sed -i '' "s/CURRENT_PROJECT_VERSION = $CURRENT_BUILD;/CURRENT_PROJECT_VERSION = $NEXT_BUILD;/g" "$PBXPROJ"
    ok "build $CURRENT_BUILD → $NEXT_BUILD"
fi

MARKETING_VERSION=$(grep -m1 -E '^[[:space:]]+MARKETING_VERSION = [^;]+;' "$PBXPROJ" | sed 's/.*= *//; s/;//' | tr -d '"')
ok "marketing version: $MARKETING_VERSION (改 .pbxproj MARKETING_VERSION 才会变)"

# ---------------------------------------------------------------
step "Cleaning old archive"
rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

# ---------------------------------------------------------------
step "Archiving (Release, generic iOS device)..."

xcodebuild \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration "$CONFIGURATION" \
    -destination "generic/platform=iOS" \
    -archivePath "$ARCHIVE_PATH" \
    -allowProvisioningUpdates \
    archive

[[ -d "$ARCHIVE_PATH" ]] || fail "archive failed"
ok "archive at $ARCHIVE_PATH"

if [[ -n "${ARCHIVE_ONLY:-}" ]]; then
    color '1;33' "ARCHIVE_ONLY 模式, 跳过 export + upload"
    exit 0
fi

# ---------------------------------------------------------------
step "Exporting IPA..."

xcodebuild \
    -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportPath "$EXPORT_DIR" \
    -exportOptionsPlist "$EXPORT_OPTIONS" \
    -allowProvisioningUpdates

IPA_PATH=$(find "$EXPORT_DIR" -name "*.ipa" | head -1)
[[ -n "$IPA_PATH" && -f "$IPA_PATH" ]] || fail "IPA not generated"
IPA_SIZE=$(du -h "$IPA_PATH" | cut -f1)
ok "IPA: $IPA_PATH ($IPA_SIZE)"

if [[ -n "${SKIP_UPLOAD:-}" ]]; then
    color '1;33' "SKIP_UPLOAD 模式, 不上传"
    color '0' "IPA: $IPA_PATH"
    exit 0
fi

# ---------------------------------------------------------------
step "Uploading to App Store Connect (mode: $UPLOAD_MODE)..."

case "$UPLOAD_MODE" in
    api_key)
        # altool 默认从 ~/.appstoreconnect/private_keys/AuthKey_${KEY_ID}.p8 找 key
        KEY_DIR="$HOME/.appstoreconnect/private_keys"
        EXPECTED_KEY="$KEY_DIR/AuthKey_${EDU_ASC_KEY_ID}.p8"
        if [[ ! -f "$EXPECTED_KEY" ]]; then
            mkdir -p "$KEY_DIR"
            cp "$EDU_ASC_KEY_PATH" "$EXPECTED_KEY"
            ok "key copied to $EXPECTED_KEY"
        fi
        xcrun altool --upload-app \
            -f "$IPA_PATH" \
            -t ios \
            --apiKey "$EDU_ASC_KEY_ID" \
            --apiIssuer "$EDU_ASC_ISSUER_ID" \
            --output-format json
        ok "altool upload done"
        ;;

    app_password_keychain)
        # 用 keychain 存的 app-specific password
        xcrun altool --upload-app \
            -f "$IPA_PATH" \
            -t ios \
            --username "$EDU_APPLE_ID" \
            --password "@keychain:edu-tf-altool" \
            --output-format json
        ok "altool upload done (keychain pwd)"
        ;;

    app_password_env)
        xcrun altool --upload-app \
            -f "$IPA_PATH" \
            -t ios \
            --username "$EDU_APPLE_ID" \
            --password "$EDU_APP_PASSWORD" \
            --output-format json
        ok "altool upload done; 把 password 存进 keychain 下次免输:"
        color '0' "  security add-generic-password -s edu-tf-altool -a $EDU_APPLE_ID -w 'YOUR_PASSWORD'"
        ;;

    app_password_prompt)
        # 交互式问一次, 同时存进 keychain
        color '1;33' ""
        color '1;33' "需要 App-Specific Password (16 位, 形如 xxxx-xxxx-xxxx-xxxx)"
        color '0'    "去 https://appleid.apple.com → 登录与安全 → App 专用密码 → 生成"
        color '0'    "(只问这一次, 之后存进 macOS Keychain)"
        printf "粘贴 password (隐藏输入): "
        read -s ASP_INPUT
        echo
        [[ -n "$ASP_INPUT" ]] || fail "empty password"

        # 先存 keychain (失败不致命)
        security add-generic-password -U \
            -s "edu-tf-altool" \
            -a "$EDU_APPLE_ID" \
            -w "$ASP_INPUT" 2>/dev/null && ok "已存进 keychain (service: edu-tf-altool)"

        xcrun altool --upload-app \
            -f "$IPA_PATH" \
            -t ios \
            --username "$EDU_APPLE_ID" \
            --password "$ASP_INPUT" \
            --output-format json
        unset ASP_INPUT
        ok "altool upload done"
        ;;

    transporter)
        color '1;33' ""
        color '1;33' "未配置 CLI 凭据, 启动 Transporter 让你点 Deliver"
        if [[ ! -d "/Applications/Transporter.app" ]]; then
            color '1;31' "Transporter 没装. App Store 搜 Transporter 装一下后再跑."
            color '0'    "或最快路径: 给 EDU_APPLE_ID 设 Apple ID, 重跑脚本会要你 app-specific password"
            color '0'    ""
            color '0'    "IPA 路径: $IPA_PATH"
            exit 1
        fi
        open -a Transporter "$IPA_PATH"
        color '1;33' "Transporter 已打开, IPA 已加载. 点 Deliver 后以回执为准."
        color '0' "当前状态: 等待人工 Deliver, 尚未上传成功."
        exit 2
        ;;
esac

# ---------------------------------------------------------------
color '1;32' ""
color '1;32' "🎉 上传成功 — App Store Connect 处理中"
color '0'    ""
color '0'    "下一步:"
color '0'    "  1. 等 ~10-30 分钟, ASC 处理完 build (会发邮件)"
color '0'    "  2. 进 App Store Connect → My Apps → EduMobile → TestFlight"
color '0'    "  3. 把这个 build 加到 Internal Testing group"
color '0'    "  4. iPhone/iPad 打开 TestFlight app, 接受邀请, 装最新版"
color '0'    ""
color '0'    "build 号: $NEXT_BUILD  marketing: $MARKETING_VERSION"
