#!/usr/bin/env bash
# 本地 → 服务器 一键部署脚本 (rsync + remote build)
#
# 用法: ./deploy/push.sh
#
# 做什么:
#   1. rsync 源码到 /opt/edu/ (排除 node_modules / venv / DB / dist)
#   2. 服务器上 pip install (差量)
#   3. 服务器上 npm run build
#   4. restart edu-backend systemd 服务
#   5. 远程健康检查 + HTTPS 登录自检
#
# 安全: 不会碰 backend/data/edu.db 和 .secret_key

set -euo pipefail

# 以下值必须通过环境变量提供, 或在部署前修改.
# 示例: EDU_SERVER_HOST=1.2.3.4 EDU_SERVER_PORT=22 ./deploy/push.sh
SERVER_HOST=${EDU_SERVER_HOST:?'请设置 EDU_SERVER_HOST'}
SERVER_PORT=${EDU_SERVER_PORT:-22}
SERVER_USER=${EDU_SERVER_USER:-root}
REMOTE_DIR=${EDU_REMOTE_DIR:-/opt/edu}
DOMAIN=${EDU_DOMAIN:-example.com}

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LOCAL_DIR=$(cd "$SCRIPT_DIR/.." && pwd)

SSH="ssh -p $SERVER_PORT $SERVER_USER@$SERVER_HOST"
REMOTE="$SERVER_USER@$SERVER_HOST:$REMOTE_DIR/"

color() { printf '\033[%sm%s\033[0m\n' "$1" "$2"; }
step()  { color '1;36' "==> $*"; }
ok()    { color '1;32' "✓ $*"; }
fail()  { color '1;31' "✗ $*"; exit 1; }

# ---------------------------------------------------------------
step "1/5 rsync  $LOCAL_DIR  →  $REMOTE"
rsync -az --delete \
    --exclude='node_modules' \
    --exclude='venv' \
    --exclude='backend/data/*.db' \
    --exclude='backend/data/*.db-journal' \
    --exclude='backend/data/.secret_key' \
    --exclude='backend/data/.env' \
    --exclude='backend/data/uploads/' \
    --exclude='__pycache__' \
    --exclude='*.pyc' \
    --exclude='frontend/dist' \
    --exclude='.git' \
    --exclude='.DS_Store' \
    --exclude='.vite' \
    -e "ssh -p $SERVER_PORT" \
    "$LOCAL_DIR/" "$REMOTE"
ok "source synced"

# ---------------------------------------------------------------
step "2/5 remote: pip install (differential)"
$SSH "cd $REMOTE_DIR && ./venv/bin/pip install -r backend/requirements.txt --quiet"
ok "python deps up to date"

# ---------------------------------------------------------------
step "3/5 remote: npm install + build"
$SSH "cd $REMOTE_DIR/frontend && npm install --silent 2>&1 | tail -3 && npm run build 2>&1 | tail -8"
ok "frontend built"

# ---------------------------------------------------------------
step "4/5 remote: restart edu-backend (+ install logrotate/ffmpeg if needed)"
$SSH "
  # nginx: 仓库里是脱敏模板 (YOUR_DOMAIN), 不自动覆盖生产配置.
  # 首次部署时手动复制并替换域名: cp deploy/nginx-*.conf /etc/nginx/conf.d/YOUR_DOMAIN.conf
  # 后续部署只在手动要求时更新.
  # 只在文件不同时才更新 logrotate 配置
  if ! cmp -s $REMOTE_DIR/deploy/logrotate-edu.conf /etc/logrotate.d/edu 2>/dev/null; then
    cp $REMOTE_DIR/deploy/logrotate-edu.conf /etc/logrotate.d/edu
    echo '[logrotate] updated /etc/logrotate.d/edu'
  fi
  # ffmpeg (视频分析需要)
  if ! command -v ffmpeg &>/dev/null; then
    echo '[ffmpeg] installing...'
    apt-get update -qq && apt-get install -y -qq ffmpeg >/dev/null 2>&1
    echo '[ffmpeg] installed'
  fi
  # 证书健康检查脚本 → /etc/cron.d/edu-cert-check
  if ! grep -q 'cert-check.sh' /etc/cron.d/edu-cert-check 2>/dev/null; then
    echo '30 4 * * * root $REMOTE_DIR/deploy/cert-check.sh' > /etc/cron.d/edu-cert-check
    chmod 644 /etc/cron.d/edu-cert-check
    echo '[cron] installed /etc/cron.d/edu-cert-check'
  fi
  systemctl restart edu-backend && sleep 1 && systemctl is-active edu-backend
"
ok "service active"

# ---------------------------------------------------------------
step "5/5 verify"
health=$($SSH "curl -sf http://127.0.0.1:5060/api/health" || echo "FAIL")
[[ "$health" == *"ok"* ]] || fail "backend health: $health"
ok "backend /api/health"

https_code=$(curl -s -o /dev/null -w "%{http_code}" "https://$DOMAIN/")
[[ "$https_code" == "200" ]] || fail "https / returned $https_code"
ok "https frontend 200"

api_health=$(curl -s "https://$DOMAIN/api/health")
[[ "$api_health" == *"ok"* ]] || fail "https api health: $api_health"
ok "https /api/health"

echo ""
color '1;32' "🎉 deploy complete — https://$DOMAIN"
