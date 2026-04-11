"""Gunicorn config for edu Flask backend.

Usage:
    gunicorn -c deploy/gunicorn.conf.py -b 127.0.0.1:5060 'app:app'
"""
import multiprocessing

bind = "127.0.0.1:5060"
workers = max(2, multiprocessing.cpu_count() // 2 + 1)
worker_class = "sync"
threads = 2
timeout = 60
keepalive = 5
accesslog = "-"       # stdout (supervisor/systemd 捕获)
errorlog = "-"
loglevel = "info"
preload_app = True
