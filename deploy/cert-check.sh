#!/usr/bin/env bash
# 证书健康检查. 每天跑一次 (cron), 不发续签, 只检查:
#   1. certbot renew --dry-run 能不能成功
#   2. 当前证书距离到期 < 14 天
#
# 任何问题都写到 /var/log/edu/cert-check.log 和 /var/log/edu/cert-alerts.log,
# 后者只在出问题时写, 方便 `tail` 时一眼看到.
#
# 安装:
#   crontab -e
#   添加: 30 4 * * * /opt/edu/deploy/cert-check.sh
#
# 手动检查: /opt/edu/deploy/cert-check.sh

set -u

# 用 flock 防止多实例并发调 certbot (会踩 certbot 自己的 lock)
LOCK=/var/lock/edu-cert-check.lock
exec 9> "$LOCK"
if ! flock -n 9; then
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] skipped: another cert-check running" >> /var/log/edu/cert-check.log
    exit 0
fi

DOMAIN=${EDU_DOMAIN:-edu.executor.life}
LOG=/var/log/edu/cert-check.log
ALERTS=/var/log/edu/cert-alerts.log
CERT=/etc/letsencrypt/live/$DOMAIN/cert.pem

mkdir -p /var/log/edu
ts() { date '+%Y-%m-%d %H:%M:%S'; }

log() { echo "[$(ts)] $*" >> "$LOG"; }
alert() {
    echo "[$(ts)] [ALERT] $*" >> "$LOG"
    echo "[$(ts)] $*" >> "$ALERTS"
}

log "=== cert-check start for $DOMAIN ==="

# 1. 检查证书文件存在
if [ ! -f "$CERT" ]; then
    alert "certificate file missing: $CERT"
    exit 1
fi

# 2. 检查剩余有效天数
exp_epoch=$(date -d "$(openssl x509 -enddate -noout -in "$CERT" | cut -d= -f2)" +%s 2>/dev/null || echo 0)
now_epoch=$(date +%s)
days_left=$(( (exp_epoch - now_epoch) / 86400 ))
log "cert expires in $days_left days"

if [ "$days_left" -lt 14 ]; then
    alert "$DOMAIN cert expires in $days_left days (< 14)"
fi

# 3. dry-run 续签能否成功
if ! output=$(certbot renew --dry-run --cert-name "$DOMAIN" 2>&1); then
    alert "certbot dry-run failed for $DOMAIN"
    echo "$output" | tail -20 >> "$LOG"
    exit 2
fi

log "dry-run OK"
log "=== cert-check done ==="
exit 0
