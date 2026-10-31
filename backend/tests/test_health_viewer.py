import json
import httpx
import pytest
from .test_health_sso import configured, begin, complete, ticket, EDU
from .test_health_native import native_ticket

@pytest.fixture
def viewer(configured, monkeypatch):
    client, owner = configured
    from db import db
    from auth import create_parent
    with db() as conn:
        parent = create_parent(conn, 'viewer@example.test', 'unusable-test-password', 'Viewer', owner['join_code'])
        conn.execute("INSERT INTO exams(owner_user_id, exam_name) VALUES (?,?)", (owner['id'], 'Shared exam'))
    monkeypatch.setenv('EDU_HEALTH_SSO_VIEWERS', json.dumps({'8': parent['id']}))
    return client, owner, parent

def test_viewer_browser_reads_owner_and_cannot_write(viewer):
    client, owner, parent = viewer
    assert complete(client, ticket(begin(client), sub='8')).status_code == 303
    me = client.get('/api/auth/me', base_url=EDU).json
    assert me['user']['id'] == parent['id']
    assert me['bound_student']['id'] == owner['id']
    assert client.get('/api/exams', base_url=EDU).json[0]['exam_name'] == 'Shared exam'
    for method, path in [('POST','/api/exams'), ('DELETE','/api/exams/1'), ('POST','/api/guardian/scan')]:
        assert client.open(path, method=method, json={}, base_url=EDU, headers={'Origin':EDU}).status_code == 403
    assert client.post('/api/auth/logout', base_url=EDU, headers={'Origin':EDU}).status_code == 200

def test_viewer_revocation_invalidates_browser(viewer, monkeypatch):
    client, _, _ = viewer
    assert complete(client, ticket(begin(client), sub='8')).status_code == 303
    monkeypatch.delenv('EDU_HEALTH_SSO_VIEWERS')
    assert client.get('/api/exams', base_url=EDU).status_code == 401

def test_viewer_native_keeps_separate_identity_and_revokes(viewer, monkeypatch):
    client, _, parent = viewer
    import health_sso
    def send(request):
        if request.url.path.endswith('/login/json'):
            return httpx.Response(200,json={'access_token':'test-jwt','user':{'id':8}})
        return httpx.Response(200,json={'ticket':native_ticket(json.loads(request.content)['state'],sub='8')})
    monkeypatch.setattr(health_sso, 'native_transport', httpx.MockTransport(send))
    response = client.post('/api/auth/token-login',base_url=EDU,json={'username':'viewer@example.test','password':'test'})
    assert response.status_code == 200
    assert response.json['user']['id'] == parent['id']
    headers = {'Authorization':'Bearer '+response.json['token']}
    assert client.get('/api/exams',base_url=EDU,headers=headers).status_code == 200
    assert client.post('/api/exams',base_url=EDU,headers=headers,json={}).status_code == 403
    monkeypatch.delenv('EDU_HEALTH_SSO_VIEWERS')
    assert client.get('/api/exams',base_url=EDU,headers=headers).status_code == 401

@pytest.mark.parametrize('value', ['[]','{"7":2}','{"8":true}','{"8":0}','{"8":"2"}'])
def test_bad_viewer_configuration_fails_closed(configured, monkeypatch, value):
    import health_sso
    monkeypatch.setenv('EDU_HEALTH_SSO_VIEWERS',value)
    with pytest.raises(ValueError): health_sso.config()

def test_viewer_cannot_map_to_student(viewer, monkeypatch):
    client, owner, _ = viewer
    monkeypatch.setenv('EDU_HEALTH_SSO_VIEWERS',json.dumps({'8':owner['id']}))
    assert complete(client,ticket(begin(client),sub='8')).status_code == 400


def test_viewer_gets_cannot_generate_or_read_admin_data(viewer, monkeypatch):
    client, _, _ = viewer
    assert complete(client, ticket(begin(client), sub='8')).status_code == 303
    def unexpected(*args, **kwargs):
        raise AssertionError('Viewer must not invoke LLM or background jobs')
    monkeypatch.setattr('routes.tasks.get_llm', unexpected)
    monkeypatch.setattr('routes.tasks.bg_submit', unexpected)
    for method in ['GET', 'HEAD']:
        assert client.open('/api/dashboard/daily-tip',method=method,base_url=EDU).status_code == 200
        assert client.open('/api/admin/profile-stats',method=method,base_url=EDU).status_code == 403
    from db import db
    with db() as conn:
        assert conn.execute('SELECT COUNT(*) FROM daily_tips').fetchone()[0] == 0


def test_viewer_cannot_access_other_student_data(viewer):
    client, _, _ = viewer
    from db import db
    from auth import create_student
    with db() as conn:
        other = create_student(conn, 'other', 'test-password', 'Other')
        conn.execute("INSERT INTO exams(owner_user_id,exam_name) VALUES (?,?)", (other['id'], 'Private exam'))
    assert complete(client, ticket(begin(client), sub='8')).status_code == 303
    assert [r['exam_name'] for r in client.get('/api/exams',base_url=EDU).json] == ['Shared exam']


def test_real_health_viewer_ticket_contract(viewer):
    import os
    import subprocess
    from .test_health_sso import SECRET, HEALTH
    root = os.environ.get('HEALTH_SSO_CONTRACT_ROOT')
    interpreter = os.environ.get('HEALTH_SSO_CONTRACT_PYTHON')
    if not root or not interpreter:
        pytest.skip('paired Health checkout and interpreter required')
    client, _, parent = viewer
    state = begin(client)
    script = '''
import json,sys
from types import SimpleNamespace
from app.services import edu_sso
v=json.load(sys.stdin)
edu_sso.settings=SimpleNamespace(edu_sso_enabled=True,edu_sso_secret=v['secret'],
    edu_sso_owner_id=7,edu_sso_viewer_ids='8',edu_sso_origin=v['origin'],edu_sso_issuer=v['issuer'])
user=SimpleNamespace(id=8,is_active=True,is_approved=True,is_managed=False)
print(json.dumps(edu_sso.issue_ticket(user,v['state'],8)))
'''
    result = subprocess.run([interpreter,'-c',script],cwd=root+'/backend',
        input=json.dumps(dict(secret=SECRET, origin=EDU, issuer=HEALTH, state=state)),
        text=True,capture_output=True,check=True,timeout=30)
    assert complete(client,json.loads(result.stdout)['ticket']).status_code == 303
    assert client.get('/api/auth/me',base_url=EDU).json['user']['id'] == parent['id']
    assert client.post('/api/exams',base_url=EDU,headers={'Origin':EDU},json={}).status_code == 403
