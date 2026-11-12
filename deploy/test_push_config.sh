#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
PUSH_SCRIPT="$SCRIPT_DIR/push.sh"
NGINX_CONFIG="$SCRIPT_DIR/nginx-edu.executor.life.conf"

if grep -Eq '\|[[:space:]]*tail([[:space:]]|$)' "$PUSH_SCRIPT"; then
    printf 'push script must not hide remote install or build failures behind tail\n' >&2
    exit 1
fi

if grep -Fq '== *"ok"*' "$PUSH_SCRIPT"; then
    printf 'push health checks must validate ok=true, not an ok substring\n' >&2
    exit 1
fi
for auth_evidence in '/api/auth/token-login' 'Authorization: Bearer' '-X DELETE' 'release_smoke_'; do
    if ! grep -Fq -- "$auth_evidence" "$PUSH_SCRIPT"; then
        printf 'push script must exercise temporary-account token auth (%s missing)\n' "$auth_evidence" >&2
        exit 1
    fi
done

for suffix in db-wal db-shm; do
    if ! grep -Fq -- "--exclude='backend/data/*.$suffix'" "$PUSH_SCRIPT"; then
        printf 'push script must exclude SQLite %s files from rsync\n' "$suffix" >&2
        exit 1
    fi
done

global_body_limit=$(awk '
    /^[[:space:]]*location[[:space:]]/ { exit }
    /client_max_body_size/ { gsub(";", "", $2); print $2 }
' "$NGINX_CONFIG")
if [[ "$global_body_limit" != "25M" ]]; then
    printf 'nginx global body limit must match Flask 25M limit, got %s\n' "$global_body_limit" >&2
    exit 1
fi

printf 'Production push configuration checks passed\n'
