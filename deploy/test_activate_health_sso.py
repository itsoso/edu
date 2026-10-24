import importlib.util
import json
from pathlib import Path
import sqlite3
import pytest

spec=importlib.util.spec_from_file_location('activation',Path(__file__).with_name('activate_health_sso.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)


def test_only_six_fields_and_other_bytes_preserved():
    raw=b'# keep\nLLM_TOKEN=hidden\nEDU_HEALTH_SSO_ENABLED=0\nOTHER=unchanged\n'
    target=m.settings(15,1,'a'*64)
    after=m.patch(raw,target)
    assert after.startswith(b'# keep\nLLM_TOKEN=hidden\nOTHER=unchanged\n')
    assert m.selected(after)==target
    assert set(target)==m.KEYS
    for invalid in (b'EDU_HEALTH_SSO_ENABLED=1\n',b' export EDU_HEALTH_SSO_ENABLED=0\n',
                    b'EDU_HEALTH_SSO_ENABLED=0\nEDU_HEALTH_SSO_ENABLED=0\n',b'EDU_HEALTH_SSO_UNKNOWN=x\n'):
        with pytest.raises(m.ActivationError):m.patch(invalid,target)


def test_invalid_mapping_and_secret_rejected():
    for args in [(0,1,'a'*64),(15,0,'a'*64),(15,1,'short'),(15,1,'a'*64+'\n'),(True,1,'a'*64)]:
        with pytest.raises(m.ActivationError):m.settings(*args)


def fixture(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'ROOT',tmp_path)
    monkeypatch.setattr(m,'ENV',tmp_path/'env')
    monkeypatch.setattr(m,'STATE',tmp_path/'state')
    monkeypatch.setattr(m,'LOCK',tmp_path/'state/activation.lock')
    monkeypatch.setattr(m,'JOURNAL',tmp_path/'state/journal.json')
    monkeypatch.setattr(m,'secure',lambda path,directory=False:path.stat())
    monkeypatch.setattr(m,'source',lambda manifest:None)
    monkeypatch.setattr(m,'health',lambda:None)
    monkeypatch.setattr(m,'service_config',lambda:None)
    monkeypatch.setattr(m,'verify',lambda:None)
    monkeypatch.setattr(m,'database',lambda user:{'identity_digest':'bound','counts':{'users':3,'courses':2}})
    monkeypatch.setattr(m,'run',lambda *args:b'')
    monkeypatch.setattr(m.time,'sleep',lambda duration:None)
    (tmp_path/'backend/data').mkdir(parents=True)
    m.ENV.write_bytes(b'OTHER=value\n')
    m.ENV.chmod(0o600)
    return {'binding':{'revision':'b'*40,'subject':15,'user':1},'manifest':{'backend/app.py':'c'*64},
            'shared_secret':'a'*64,'apply':False,'resume':False}


def test_dry_run_has_no_writes_and_apply_preserves_data(monkeypatch,tmp_path):
    payload=fixture(monkeypatch,tmp_path)
    assert m.execute(payload)['state']=='READY'
    assert not m.STATE.exists()
    payload['apply']=True
    assert m.execute(payload)['state']=='CONFIGURATION_SUCCEEDED'
    assert not m.LOCK.exists()
    assert b'OTHER=value\n' in m.ENV.read_bytes()
    assert 'a'*64 not in m.JOURNAL.read_text()
    with pytest.raises(m.ActivationError):m.execute(payload)
    assert not m.LOCK.exists()


def test_partial_failure_requires_same_binding_resume(monkeypatch,tmp_path):
    payload=fixture(monkeypatch,tmp_path);payload['apply']=True
    def fail():raise m.ActivationError('probe failed')
    monkeypatch.setattr(m,'verify',fail)
    with pytest.raises(m.ActivationError):m.execute(payload)
    assert m.LOCK.exists()
    assert json.loads(m.JOURNAL.read_text())['state']=='NEEDS_OPERATOR'
    with pytest.raises(m.ActivationError):m.execute(payload)
    payload['resume']=True;payload['shared_secret']='d'*64
    with pytest.raises(m.ActivationError):m.execute(payload)
    payload['shared_secret']='a'*64
    monkeypatch.setattr(m,'verify',lambda:None)
    assert m.execute(payload)['state']=='CONFIGURATION_SUCCEEDED'


def test_unknown_lock_and_post_intent_drift_rejected(monkeypatch,tmp_path):
    payload=fixture(monkeypatch,tmp_path);payload['apply']=True
    m.STATE.mkdir();m.LOCK.touch()
    with pytest.raises(m.ActivationError):m.execute(payload)
    assert not m.JOURNAL.exists()


def test_database_is_read_only_and_mapping_bound(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'ROOT',tmp_path)
    path=tmp_path/'backend/data/edu.db';path.parent.mkdir(parents=True)
    with sqlite3.connect(path) as con:
        con.execute('CREATE TABLE users(id INTEGER,username TEXT,role TEXT)')
        con.execute("INSERT INTO users VALUES(1,'test','parent')")
        for table in ('courses','exams','scores'):con.execute('CREATE TABLE '+table+'(id INTEGER)')
    before=path.read_bytes();proof=m.database(1)
    assert proof['counts']=={'users':1,'courses':0,'exams':0,'scores':0}
    assert path.read_bytes()==before
    with pytest.raises(m.ActivationError):m.database(2)


def test_source_manifest_rejects_mismatch_and_traversal(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'ROOT',tmp_path)
    (tmp_path/'backend').mkdir();(tmp_path/'backend/app.py').write_bytes(b'code')
    m.source({'backend/app.py':m.digest(b'code')})
    for manifest in ({'backend/app.py':'0'*64},{'../secret':'0'*64},{'backend/data/.env':'0'*64},{}):
        with pytest.raises(m.ActivationError):m.source(manifest)


def test_matching_resume_can_restart_inactive_service(monkeypatch,tmp_path):
    payload=fixture(monkeypatch,tmp_path);payload['apply']=True
    def fail(*args):raise m.ActivationError('restart failed')
    monkeypatch.setattr(m,'run',fail)
    with pytest.raises(m.ActivationError):m.execute(payload)
    monkeypatch.setattr(m,'health',fail)
    payload['resume']=True
    monkeypatch.setattr(m,'run',lambda *args:b'')
    assert m.execute(payload)['state']=='CONFIGURATION_SUCCEEDED'


def test_service_rejects_inherited_overrides_and_different_command(monkeypatch):
    unit = {'User':'root','WorkingDirectory':'/opt/edu/backend','EnvironmentFiles':'',
            'Environment':'EDU_ENV=prod','PassEnvironment':'','UnsetEnvironment':'',
            'ExecStart':'{ path=/opt/edu/venv/bin/gunicorn ; argv[]=/opt/edu/venv/bin/gunicorn -c /opt/edu/deploy/gunicorn.conf.py app:app ; ignore_errors=no ; start_time=[n/a] }'}
    manager = ''
    def command(*args):
        return (manager if args[1]=='show-environment' else '\n'.join(k+'='+v for k,v in unit.items())).encode()
    monkeypatch.setattr(m,'run',command)
    m.service_config()
    for key,value in [('PassEnvironment','EDU_HEALTH_SSO_SECRET'),('UnsetEnvironment','EDU_HEALTH_SSO_ENABLED'),
                      ('Environment','EDU_HEALTH_SSO_USER_ID=99'),('ExecStart','/bin/evil'),('EnvironmentFiles','/tmp/env')]:
        original=unit[key];unit[key]=value
        with pytest.raises(m.ActivationError):m.service_config()
        unit[key]=original
    manager='EDU_HEALTH_SSO_USER_ID=99'
    with pytest.raises(m.ActivationError):m.service_config()


def test_atomic_cleans_owned_temporary_and_rejects_unknown_stale_file(monkeypatch,tmp_path):
    monkeypatch.setattr(m,'secure',lambda path,directory=False:path.stat())
    path=tmp_path/'env';path.write_bytes(b'before');path.chmod(0o600)
    original=m.os.fsync;calls=[]
    def fail_once(fd):
        calls.append(fd)
        if len(calls)==1:raise OSError('injected write failure')
        return original(fd)
    monkeypatch.setattr(m.os,'fsync',fail_once)
    with pytest.raises(OSError):m.atomic(path,b'after',m.digest(b'before'))
    assert path.read_bytes()==b'before' and not (tmp_path/'.env.new').exists()
    (tmp_path/'.env.new').write_bytes(b'unknown')
    with pytest.raises(FileExistsError):m.atomic(path,b'after',m.digest(b'before'))
    assert (tmp_path/'.env.new').read_bytes()==b'unknown'


def test_embedded_remote_operator_compiles_without_running_cli():
    raw=Path(m.__file__).read_bytes().rsplit(b"\nif __name__ == '__main__':",1)[0]
    compile(raw, '<remote-operator>', 'exec')
    assert b'def execute(payload)' in raw
