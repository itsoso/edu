import json
import time
import pytest
import httpx
from .test_health_sso import configured, SECRET, EDU, HEALTH, ticket


def native_ticket(state, **changes):
    import base64,hashlib,hmac
    raw=ticket(state, purpose='edu-native-login', **changes).split('.')[0]
    signature=base64.urlsafe_b64encode(hmac.new(SECRET.encode(),('edu-native-login-v1.'+raw).encode(),hashlib.sha256).digest()).decode().rstrip('=')
    return raw+'.'+signature


@pytest.fixture
def upstream(monkeypatch):
    import health_sso
    calls=[]
    def send(request):
        calls.append(request)
        body=json.loads(request.content)
        if request.url.path.endswith('/login/json'):
            assert body == {'username':'owner@example.test','password':'health-password'}
            return httpx.Response(200,json={'access_token':'health-jwt','token_type':'bearer','user':{'id':7}})
        assert request.url.path == '/api/v1/auth/sso/edu/native'
        assert request.headers['Authorization'] == 'Bearer health-jwt'
        assert body['expected_user_id'] == 7
        return httpx.Response(200,json={'ticket':native_ticket(body['state'])})
    monkeypatch.setattr(health_sso,'native_transport',httpx.MockTransport(send))
    return calls


def login(client):
    return client.post('/api/auth/token-login',base_url=EDU,json={'username':'owner@example.test','password':'health-password'})


def test_old_app_contract_uses_health_and_supports_read_and_write(configured,upstream):
    client,user=configured
    response=login(client)
    assert response.status_code == 200
    assert response.json['user']['id'] == user['id']
    assert len(upstream)==2
    bearer={'Authorization':'Bearer '+response.json['token']}
    assert client.get('/api/auth/me',base_url=EDU,headers=bearer).json['user']['id']==user['id']
    assert client.get('/api/schedule/courses',base_url=EDU,headers=bearer).status_code==200
    assert client.post('/api/schedule/courses',base_url=EDU,headers=bearer,json={
        'child_name':'Synthetic child','course_name':'Native test','weekday':6,'start_time':'10:00','end_time':'11:00'}).status_code in (200,201)


@pytest.mark.parametrize('status,expected',[(401,401),(403,403),(429,429),(500,503),(302,503)])
def test_health_failure_never_falls_back_to_local(configured,monkeypatch,status,expected):
    import health_sso
    monkeypatch.setattr(health_sso,'native_transport',httpx.MockTransport(lambda r:httpx.Response(status,json={'detail':'not echoed'})))
    client,_=configured
    assert login(client).status_code==expected


def test_foreign_health_identity_cannot_claim_existing_edu(configured,monkeypatch):
    import health_sso
    monkeypatch.setattr(health_sso,'native_transport',httpx.MockTransport(lambda r:httpx.Response(200,json={'access_token':'not-logged','user':{'id':8}})))
    assert login(configured[0]).status_code==403


def test_native_proof_and_old_token_are_not_interchangeable(configured,upstream):
    from auth import issue_token
    client,user=configured
    old=issue_token(user['id'])
    assert client.get('/api/exams',base_url=EDU,headers={'Authorization':'Bearer '+old}).status_code==401
    token=login(client).json['token']
    from auth import _get_serializer
    assert _get_serializer().loads(token)['health_subject']=='7'


def test_native_health_unavailable(configured,monkeypatch):
    import health_sso
    def fail(request):raise httpx.ConnectError('private upstream details')
    monkeypatch.setattr(health_sso,'native_transport',httpx.MockTransport(fail))
    response=login(configured[0])
    assert response.status_code==503
    assert b'private upstream' not in response.data


def test_browser_ticket_cannot_be_used_as_native_identity(configured,monkeypatch):
    import health_sso
    def send(request):
        if request.url.path.endswith('/login/json'):
            return httpx.Response(200,json={'access_token':'health-jwt','user':{'id':7}})
        return httpx.Response(200,json={'ticket':ticket(json.loads(request.content)['state'])})
    monkeypatch.setattr(health_sso,'native_transport',httpx.MockTransport(send))
    assert login(configured[0]).status_code==503


def test_native_config_change_revokes(configured,upstream,monkeypatch):
    import auth
    client,_=configured
    token=login(client).json['token']
    bearer={'Authorization':'Bearer '+token}
    monkeypatch.setenv('EDU_HEALTH_SSO_SUBJECT','8')
    assert client.get('/api/exams',base_url=EDU,headers=bearer).status_code==401


def test_native_real_health_issuer_contract(configured,monkeypatch):
    import os,subprocess
    import health_sso
    root=os.environ.get('HEALTH_SSO_CONTRACT_ROOT')
    interpreter=os.environ.get('HEALTH_SSO_CONTRACT_PYTHON')
    if not root or not interpreter:pytest.skip('paired Health interpreter needed')
    def send(request):
        if request.url.path.endswith('/login/json'):
            return httpx.Response(200,json={'access_token':'health-jwt','user':{'id':7}})
        body=json.loads(request.content)
        script="""
import json,sys
from types import SimpleNamespace
from app.services import edu_sso
v=json.load(sys.stdin)
edu_sso.settings=SimpleNamespace(edu_sso_enabled=True,edu_sso_secret=v['secret'],edu_sso_owner_id=7,edu_sso_origin=v['origin'],edu_sso_issuer=v['issuer'])
print(json.dumps(edu_sso.issue_native_ticket(SimpleNamespace(id=7,is_active=True,is_approved=True,is_managed=False),v['state'],7)))
"""
        result=subprocess.run([interpreter,'-c',script],cwd=root+'/backend',text=True,input=json.dumps(dict(secret=SECRET,origin=EDU,issuer=HEALTH,state=body['state'])),capture_output=True,check=True,timeout=30)
        return httpx.Response(200,json=json.loads(result.stdout))
    monkeypatch.setattr(health_sso,'native_transport',httpx.MockTransport(send))
    response=login(configured[0])
    assert response.status_code==200
    assert configured[0].get('/api/auth/me',base_url=EDU,headers={'Authorization':'Bearer '+response.json['token']}).json['user']['id']==configured[1]['id']


def test_native_token_expires_after_eight_hours(configured,upstream,monkeypatch):
    from itsdangerous.timed import TimestampSigner
    client,_=configured
    token=login(client).json['token']
    stamp=int(time.time())
    monkeypatch.setattr(TimestampSigner,'get_timestamp',lambda self:stamp+8*3600+2)
    assert client.get('/api/exams',base_url=EDU,headers={'Authorization':'Bearer '+token}).status_code==401
