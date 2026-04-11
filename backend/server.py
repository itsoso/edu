#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
supervisor 启动适配层 (与 llms-board 风格一致)

将 infra-framework 风格的启动参数映射到 Flask 应用:
  python3 server.py --hp <port> --gp <grpc_port> --service-name <name>

生产环境用 gunicorn 启动 (见 deploy/gunicorn 或 .service 文件).
这个适配层主要用于本地/简易场景, 与 llms-board 保持一致.
"""
import argparse
import os
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--hp', type=int, required=True, help='HTTP 端口')
parser.add_argument('--gp', type=int, default=0, help='健康检查端口 (未使用)')
parser.add_argument('--service-name', type=str, default='', help='服务名 (未使用)')
args = parser.parse_args()

os.environ['EDU_PORT'] = str(args.hp)

# 确保可以 import db / app
sys_dir = Path(__file__).resolve().parent
os.chdir(sys_dir)

from db import init_db  # noqa: E402
from app import app     # noqa: E402

init_db()
app.run(host='127.0.0.1', port=args.hp, debug=False, use_reloader=False)
