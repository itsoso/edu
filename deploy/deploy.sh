#!/usr/bin/env bash
# 服务器端部署脚本 — 在 ssh 到服务器后执行
# 前置: git clone https://github.com/itsoso/edu.git /opt/edu
set -euo pipefail

APP_DIR=/opt/edu
DOMAIN=YOUR_DOMAIN
NODE_BIN=$(command -v node || echo /usr/local/bin/node)

echo "==> 1. pull latest"
cd "$APP_DIR"
git pull

echo "==> 2. backend venv + deps"
if [ ! -d venv ]; then
    python3 -m venv venv
fi
./venv/bin/pip install --upgrade pip >/dev/null
./venv/bin/pip install -r backend/requirements.txt

echo "==> 3. init DB + seed (仅首次)"
mkdir -p backend/data
if [ ! -f backend/data/edu.db ]; then
    cd backend && ../venv/bin/python seed.py && cd ..
fi

echo "==> 4. build frontend"
cd frontend
if [ ! -d node_modules ]; then
    npm install
fi
npm run build
cd ..

echo "==> 5. prepare log dir"
mkdir -p /var/log/edu

echo "==> 6. install systemd unit"
cp deploy/edu-backend.service /etc/systemd/system/edu-backend.service
systemctl daemon-reload
systemctl enable edu-backend

echo "==> 7. install nginx conf"
cp deploy/nginx-YOUR_DOMAIN.conf /etc/nginx/sites-available/YOUR_DOMAIN.conf
ln -sf /etc/nginx/sites-available/YOUR_DOMAIN.conf /etc/nginx/sites-enabled/YOUR_DOMAIN.conf

echo "==> 8. (re)start backend"
systemctl restart edu-backend
sleep 1
systemctl status edu-backend --no-pager | head -15

echo ""
echo "==> backend health check"
curl -sf http://127.0.0.1:5060/api/health && echo " OK"

echo ""
echo "==> 9. test nginx config"
nginx -t

echo ""
echo "==> 10. reload nginx"
nginx -s reload

echo ""
echo "✅ Deploy finished. Next steps:"
echo "  1. Point $DOMAIN A record to this server"
echo "  2. Run: certbot --nginx -d $DOMAIN"
echo "  3. Visit https://$DOMAIN"
