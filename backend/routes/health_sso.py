"""Browser-only Health SSO endpoints with durable single-use request binding."""
import secrets
import time

from flask import Blueprint, jsonify, redirect, request, session
from db import db
import health_sso as sso

bp = Blueprint('health_sso', __name__)


@bp.after_request
def private_response(response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['Referrer-Policy'] = 'no-referrer'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@bp.get('/api/auth/provider')
def provider():
    return jsonify(provider='health' if sso.enabled() else 'local')


@bp.get('/api/auth/health/start')
def start():
    try:
        cfg = sso.config()
    except ValueError:
        return jsonify(error='health_sso_not_configured'), 503
    if request.host_url.rstrip('/') != cfg['origin']:
        return jsonify(error='invalid_login_origin'), 400
    state, browser = secrets.token_urlsafe(32), secrets.token_urlsafe(32)
    now = int(time.time())
    with db() as conn:
        if not conn.execute('SELECT 1 FROM users WHERE id=?', (cfg['user_id'],)).fetchone():
            return jsonify(error='health_sso_not_configured'), 503
        conn.execute('DELETE FROM health_sso_pending WHERE expires_at <= ?', (now,))
        previous = request.cookies.get(sso.COOKIE, '')
        if previous:
            conn.execute('DELETE FROM health_sso_pending WHERE browser_hash=?', (sso.digest(previous),))
        conn.execute('INSERT INTO health_sso_pending (state_hash,browser_hash,expires_at) VALUES (?,?,?)',
                     (sso.digest(state), sso.digest(browser), now + 600))
    response = redirect(cfg['issuer'] + '/connect/edu?state=' + state)
    response.set_cookie(sso.COOKIE, browser, max_age=600, secure=True, httponly=True, samesite='None', path='/')
    return response


@bp.post('/api/auth/health/callback')
def callback():
    try:
        cfg = sso.config()
    except ValueError:
        return jsonify(error='health_sso_not_configured'), 503
    if (request.host_url.rstrip('/') != cfg['origin'] or request.headers.get('Origin') != cfg['issuer']
            or request.content_length is None or request.content_length > 4096
            or list(request.form.keys()) != ['ticket'] or len(request.form.getlist('ticket')) != 1):
        return jsonify(error='invalid_health_login'), 400
    browser = request.cookies.get(sso.COOKIE, '')
    if not sso.STATE_RE.fullmatch(browser):
        return jsonify(error='invalid_health_login'), 400
    try:
        claims = sso.verify_ticket(request.form['ticket'], cfg)
        cfg = sso.identity_config(cfg, claims['sub'])
    except (ValueError, UnicodeError):
        return jsonify(error='invalid_health_login'), 400
    now = int(time.time())
    with db() as conn:
        conn.execute('BEGIN IMMEDIATE')
        user = conn.execute('SELECT id FROM users WHERE id=?', (cfg['user_id'],)).fetchone()
        if not user:
            return jsonify(error='invalid_health_login'), 400
        consumed = conn.execute('DELETE FROM health_sso_pending WHERE state_hash=? AND browser_hash=? AND expires_at>?',
                                (sso.digest(claims['state']), sso.digest(browser), now)).rowcount
        if consumed != 1:
            return jsonify(error='invalid_health_login'), 400
    session.clear()
    session.update(user_id=cfg['user_id'], health_subject=claims['sub'],
                   health_issuer=claims['iss'], health_expires_at=now + 8 * 3600)
    response = redirect('/', code=303)
    response.delete_cookie(sso.COOKIE, secure=True, httponly=True, samesite='None', path='/')
    return response
