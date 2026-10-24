"""Health login proofs; browser redirect and transient native credential relay."""
import base64
import hashlib
import hmac
import json
import os
import re
import time
import secrets
import httpx
from urllib.parse import urlsplit

STATE_RE = re.compile(r'[A-Za-z0-9_-]{43}\Z')
COOKIE = '__Host-edu-health-flow'


def enabled():
    return os.environ.get('EDU_HEALTH_SSO_ENABLED', '0') == '1'


def config():
    def origin(name):
        value = os.environ.get(name, '')
        parsed = urlsplit(value)
        if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment or parsed.port not in (None, 443)
                or value != 'https://' + parsed.netloc):
            raise ValueError('invalid_sso_configuration')
        return value

    secret = os.environ.get('EDU_HEALTH_SSO_SECRET', '')
    subject = os.environ.get('EDU_HEALTH_SSO_SUBJECT', '')
    uid = int(os.environ.get('EDU_HEALTH_SSO_USER_ID', '0'))
    if not enabled() or len(secret) < 32 or not re.fullmatch(r'[1-9][0-9]*', subject) or uid <= 0:
        raise ValueError('invalid_sso_configuration')
    return dict(secret=secret, subject=subject, user_id=uid,
                issuer=origin('EDU_HEALTH_SSO_ISSUER'), origin=origin('EDU_HEALTH_SSO_ORIGIN'))


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def verify_ticket(ticket, cfg, *, native=False):
    if not isinstance(ticket, str) or len(ticket) > 2048 or not re.fullmatch(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}', ticket):
        raise ValueError('invalid_ticket')
    payload, signature = ticket.split('.')
    expected = base64.urlsafe_b64encode(hmac.new(cfg['secret'].encode(),
        (('edu-native-login-v1.' if native else 'edu-login-v1.') + payload).encode(), hashlib.sha256).digest()).decode().rstrip('=')
    if not hmac.compare_digest(signature, expected):
        raise ValueError('invalid_ticket')
    claims = json.loads(base64.urlsafe_b64decode(payload + '=' * (-len(payload) % 4)))
    if not isinstance(claims, dict) or set(claims) != {'v','purpose','iss','aud','sub','state','iat','exp'}:
        raise ValueError('invalid_ticket')
    now = int(time.time())
    if (type(claims['v']) is not int or claims['v'] != 1
            or claims['purpose'] != ('edu-native-login' if native else 'edu-browser-login') or claims['iss'] != cfg['issuer']
            or claims['aud'] != cfg['origin'] or claims['sub'] != cfg['subject']
            or not isinstance(claims['state'], str) or not STATE_RE.fullmatch(claims['state'])
            or type(claims['iat']) is not int or type(claims['exp']) is not int
            or not now - 60 <= claims['iat'] <= now
            or not now < claims['exp'] <= claims['iat'] + 60):
        raise ValueError('invalid_ticket')
    return claims


def session_user(session):
    try:
        cfg = config()
    except ValueError:
        return None
    expires = session.get('health_expires_at')
    if (session.get('health_subject') != cfg['subject']
            or session.get('health_issuer') != cfg['issuer']
            or session.get('user_id') != cfg['user_id']
            or type(expires) is not int or expires <= int(time.time())):
        return None
    return cfg['user_id']


# Injectable transport only for deterministic tests; production uses verified HTTPS.
native_transport = None


class NativeLoginError(Exception):
    def __init__(self, status, code):
        self.status, self.code = status, code


def native_identity(username, password):
    try:
        cfg = config()
    except ValueError:
        raise NativeLoginError(503, 'health_sso_not_configured') from None
    if (not isinstance(username, str) or not isinstance(password, str)
            or not username.strip() or not password or len(username) > 320 or len(password) > 1024):
        raise NativeLoginError(400, 'invalid_credentials')
    state = secrets.token_urlsafe(32)
    try:
        with httpx.Client(timeout=10.0, follow_redirects=False, trust_env=False,
                          transport=native_transport) as client:
            response = client.post(cfg['issuer'] + '/api/v1/auth/login/json',
                                   json={'username':username.strip(), 'password':password})
            _check_upstream(response)
            login = response.json()
            if not isinstance(login, dict) or not isinstance(login.get('user'), dict):
                raise ValueError('invalid_upstream')
            identity = login['user'].get('id')
            if type(identity) is not int or str(identity) != cfg['subject']:
                raise NativeLoginError(403, 'health_account_not_linked')
            token = login.get('access_token')
            if not isinstance(token, str) or not token or len(token) > 16384:
                raise ValueError('invalid_upstream')
            response = client.post(cfg['issuer'] + '/api/v1/auth/sso/edu/native',
                headers={'Authorization':'Bearer ' + token},
                json={'state':state, 'expected_user_id':identity})
            _check_upstream(response)
            proof = response.json()
            if not isinstance(proof, dict):
                raise ValueError('invalid_upstream')
            claims = verify_ticket(proof.get('ticket'), cfg, native=True)
            if claims['state'] != state:
                raise ValueError('invalid_upstream')
            return cfg
    except (httpx.HTTPError, ValueError, UnicodeError):
        raise NativeLoginError(503, 'health_login_unavailable') from None


def _check_upstream(response):
    if response.status_code in (401, 403, 429):
        code = {401:'invalid_credentials', 403:'health_account_not_allowed',429:'health_login_rate_limited'}[response.status_code]
        raise NativeLoginError(response.status_code, code)
    if response.status_code != 200 or len(response.content) > 65536:
        raise NativeLoginError(503, 'health_login_unavailable')
