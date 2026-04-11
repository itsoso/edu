#!/usr/bin/env bash
# 一键启动 edu 教育模块 (后端 + 前端 dev)
set -e
cd "$(dirname "$0")"

# 后端
cd backend
if [ ! -f data/edu.db ]; then
  echo "[edu] First run: initializing DB + seeding..."
  python3 seed.py
fi
echo "[edu] Starting backend on http://127.0.0.1:5060 ..."
python3 app.py > /tmp/edu_backend.log 2>&1 &
BACKEND_PID=$!
cd ..

# 前端
cd frontend
if [ ! -d node_modules ]; then
  echo "[edu] Installing frontend deps (first run only)..."
  npm install
fi
echo "[edu] Starting frontend on http://127.0.0.1:5173 ..."
trap "kill $BACKEND_PID 2>/dev/null" EXIT
npm run dev
