import base64
import hashlib
import hmac
import json
import time
from urllib.parse import parse_qs, urlsplit

import pytest

SECRET = 'synthetic-edu-health-secret-at-least-32-bytes'
EDU = 'https://edu.example.test'
HEALTH = 'https://health.example.test'


def ticket(request_state, **changes):
    now = int(time.time())
    claims = dict(v=1, purpose='edu-browser-login', iss=HEALTH, aud=EDU,
                  sub='7', state=request_state, iat=now, exp=now + 60)
    claims.update(changes)
    encode = lambda b: base64.urlsafe_b64encode(b).decode().rstrip('=')
    payload = encode(json.dumps(claims).encode())
    signature = encode(hmac.new(SECRET.encode(), ('edu-login-v1.' + payload).encode(), hashlib.sha256).digest())
    return payload + '.' + signature


@pytest.fixture
def configured(client, helpers, monkeypatch):
    user = helpers.register_student(client)
    helpers.logout(client)
    for key, value in dict(EDU_HEALTH_SSO_ENABLED='1', EDU_HEALTH_SSO_SECRET=SECRET,
                           EDU_HEALTH_SSO_ISSUER=HEALTH, EDU_HEALTH_SSO_ORIGIN=EDU,
                           EDU_HEALTH_SSO_SUBJECT='7', EDU_HEALTH_SSO_USER_ID=str(user['id'])).items():
        monkeypatch.setenv(key, value)
    return client, user


def begin(client):
    response = client.get('/api/auth/health/start', base_url=EDU)
    assert response.status_code == 302
    assert response.location.startswith(HEALTH + '/connect/edu?state=')
    assert 'Secure' in response.headers['Set-Cookie']
    assert 'SameSite=None' in response.headers['Set-Cookie']
    return parse_qs(urlsplit(response.location).query)['state'][0]


def complete(client, proof):
    return client.post('/api/auth/health/callback', data={'ticket': proof},
                       headers={'Origin': HEALTH}, base_url=EDU)


def test_sso_preserves_existing_user_and_consumes_once(configured):
    client, user = configured
    from db import db
    with db() as conn:
        conn.execute("INSERT INTO courses (owner_user_id,child_name,course_name,weekday,start_time,end_time) VALUES (?,?,?,?,?,?)",
                     (user['id'], 'Synthetic child', 'Existing class', 6, '10:00', '11:30'))
    state = begin(client)
    proof = ticket(state)
    response = complete(client, proof)
    assert response.status_code == 303
    assert response.location == '/'
    assert response.headers['Cache-Control'] == 'no-store'
    assert client.get('/api/auth/me', base_url=EDU).json['user']['id'] == user['id']
    assert complete(client, proof).status_code == 400
    courses = client.get('/api/schedule/courses', base_url=EDU).json
    assert [(c['course_name'], c['start_time'], c['end_time']) for c in courses] == [('Existing class', '10:00', '11:30')]


@pytest.mark.parametrize('changes', [dict(sub='8'), dict(aud='https://evil.test'),
    dict(iss='https://evil.test'), dict(purpose='kbase-browser-login'), dict(v=2),
    dict(exp=0), dict(iat=int(time.time()) + 120), dict(exp=int(time.time()) + 3600),
    dict(iat=True), dict(state='x'*43)])
def test_invalid_claims_fail_closed(configured, changes):
    client, _ = configured
    state = begin(client)
    assert complete(client, ticket(state, **changes)).status_code == 400
    assert client.get('/api/auth/me', base_url=EDU).json['user'] is None


def test_ticket_needs_same_browser_and_signature(configured):
    client, _ = configured
    state = begin(client)
    assert complete(client, ticket(state) + 'x').status_code == 400
    other = client.application.test_client()
    assert complete(other, ticket(state)).status_code == 400
    assert complete(client, ticket(state)).status_code == 303


def test_cross_origin_callback_and_duplicate_fields_rejected(configured):
    client, _ = configured
    state = begin(client)
    assert client.post('/api/auth/health/callback', data={'ticket': ticket(state)},
                       base_url=EDU, headers={'Origin':'https://evil.test'}).status_code == 400
    from werkzeug.datastructures import MultiDict
    assert client.post('/api/auth/health/callback', data=MultiDict([('ticket',ticket(state)),('ticket',ticket(state))]),
                       base_url=EDU, headers={'Origin':HEALTH}).status_code == 400


def test_local_login_registration_and_old_sessions_disabled(configured):
    client, user = configured
    for route in ['login','register','token-register']:
        assert client.post('/api/auth/' + route, json={'username':'alice','password':'alice1234'}).status_code == 409
    with client.session_transaction(base_url=EDU) as session:
        session['user_id'] = user['id']
    assert client.get('/api/auth/me', base_url=EDU).json['user'] is None
    from auth import issue_token
    assert client.get('/api/exams', base_url=EDU, headers={'Authorization':'Bearer ' + issue_token(user['id'])}).status_code == 401


def test_provider_disabled_and_bad_config(client, monkeypatch):
    assert client.get('/api/auth/provider').json == {'provider':'local'}
    assert client.get('/api/auth/health/start').status_code == 503
    monkeypatch.setenv('EDU_HEALTH_SSO_ENABLED','1')
    assert client.get('/api/auth/provider').json == {'provider':'health'}
    assert client.get('/api/auth/health/start').status_code == 503


def test_expired_pending_request(configured):
    client, _ = configured
    state = begin(client)
    from db import db
    with db() as conn:
        conn.execute('UPDATE health_sso_pending SET expires_at=0')
    assert complete(client, ticket(state)).status_code == 400


def test_deletion_requires_health_account_management(configured):
    client, _ = configured
    complete(client,ticket(begin(client)))
    assert client.delete('/api/auth/me',base_url=EDU,json={'password':'alice1234'}).status_code == 409


def test_health_issuer_wire_contract(configured):
    """Optional cross-repository integration; both real implementations, synthetic identity."""
    import os
    import subprocess
    issuer_root = os.environ.get('HEALTH_SSO_CONTRACT_ROOT')
    interpreter = os.environ.get('HEALTH_SSO_CONTRACT_PYTHON')
    if not issuer_root or not interpreter:
        pytest.skip('set HEALTH_SSO_CONTRACT_ROOT and HEALTH_SSO_CONTRACT_PYTHON for paired integration')
    client, user = configured
    state = begin(client)
    script = '''
import json,sys
from types import SimpleNamespace
from app.services import edu_sso
values=json.load(sys.stdin)
edu_sso.settings=SimpleNamespace(edu_sso_enabled=True,edu_sso_secret=values['secret'],
    edu_sso_owner_id=7,edu_sso_origin=values['origin'],edu_sso_issuer=values['issuer'])
user=SimpleNamespace(id=7,is_active=True,is_approved=True,is_managed=False)
print(json.dumps(edu_sso.issue_ticket(user,values['state'],7)))
'''
    result = subprocess.run([interpreter, '-c', script], cwd=issuer_root + '/backend',
                            input=json.dumps(dict(secret=SECRET,origin=EDU,issuer=HEALTH,state=state)),
                            text=True, capture_output=True, check=True, timeout=30)
    result = json.loads(result.stdout)
    assert result['callback_url'] == EDU + '/api/auth/health/callback'
    assert complete(client, result['ticket']).status_code == 303
    assert client.get('/api/auth/me',base_url=EDU).json['user']['id'] == user['id']
    assert complete(client, result['ticket']).status_code == 400


def test_health_session_expires_and_mapping_change_revokes(configured, monkeypatch):
    client, _ = configured
    assert complete(client, ticket(begin(client))).status_code == 303
    with client.session_transaction(base_url=EDU) as session:
        session['health_expires_at'] = 0
    assert client.get('/api/exams',base_url=EDU).status_code == 401
    assert complete(client, ticket(begin(client))).status_code == 303
    monkeypatch.setenv('EDU_HEALTH_SSO_SUBJECT','8')
    assert client.get('/api/exams',base_url=EDU).status_code == 401


def test_missing_user_does_not_create_or_claim_other_account(configured, monkeypatch):
    client, _ = configured
    monkeypatch.setenv('EDU_HEALTH_SSO_USER_ID','999999')
    assert client.get('/api/auth/health/start',base_url=EDU).status_code == 503


def test_logout_clears_health_session(configured):
    client, _ = configured
    assert complete(client, ticket(begin(client))).status_code == 303
    assert client.post('/api/auth/logout',base_url=EDU,headers={'Origin':EDU}).status_code == 200
    assert client.get('/api/exams',base_url=EDU).status_code == 401


def test_sso_writes_reject_untrusted_origin(configured):
    client, _ = configured
    assert complete(client,ticket(begin(client))).status_code == 303
    assert client.post('/api/auth/logout',base_url=EDU,headers={'Origin':'https://sibling.example.test'}).status_code == 403
    assert client.get('/api/exams',base_url=EDU).status_code == 200
    assert client.post('/api/auth/logout',base_url=EDU,headers={'Origin':EDU}).status_code == 200


def test_sso_app_does_not_allow_cross_origin_credentials(configured):
    from app import create_app
    app = create_app()
    response = app.test_client().get('/api/auth/provider',base_url=EDU,headers={'Origin':'https://sibling.example.test'})
    assert 'Access-Control-Allow-Origin' not in response.headers
