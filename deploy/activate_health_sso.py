#!/usr/bin/env python3
"""Bounded Edu activation. Default inspect; secret supplied only as stdin JSON.

No backup or automatic retry. A partial apply retains its journal and lock;
--resume --apply accepts only the same revision, account mapping and secret digest.
"""
import argparse
import base64
import fcntl
import hashlib
import json
import os
import pwd
from pathlib import Path
import re
import sqlite3
import stat
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = Path('/opt/edu')
ENV = ROOT / 'backend/data/.env'
STATE = Path('/var/lib/edu-health-sso')
LOCK = STATE / 'activation.lock'
JOURNAL = STATE / 'journal.json'
PREFIX = 'EDU_HEALTH_SSO_'
KEYS = {PREFIX + key for key in ('ENABLED', 'ISSUER', 'ORIGIN', 'SUBJECT', 'USER_ID', 'SECRET')}


class ActivationError(Exception):
    pass


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def secure(path, directory=False):
    for item in [*reversed(path.parents), path]:
        st = item.lstat()
        is_dir = item != path or directory
        allowed_owner = st.st_uid == 0
        if item in (ROOT, ROOT/'backend', ROOT/'backend/data') and is_dir and st.st_uid == 502:
            try:
                pwd.getpwuid(502)
            except KeyError:
                allowed_owner = True
        if not allowed_owner or st.st_mode & 0o022 or (not stat.S_ISDIR(st.st_mode) if is_dir else not stat.S_ISREG(st.st_mode)):
            raise ActivationError('unsafe operator path')
        if not is_dir and st.st_nlink != 1:
            raise ActivationError('unsafe operator file links')
    return st


def identity(info):
    return tuple(getattr(info,'st_'+key) for key in ('dev','ino','mode','nlink','uid','gid','size','mtime_ns','ctime_ns'))


def read(path):
    before = secure(path)
    if before.st_size > 1024 * 1024:
        raise ActivationError('operator file too large')
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW), 'rb') as stream:
        raw = stream.read(1024 * 1024 + 1)
        if identity(os.fstat(stream.fileno())) != identity(before) or identity(path.lstat()) != identity(before):
            raise ActivationError('operator file changed')
    return raw


def sync(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic(path, raw, expected=None):
    before = secure(path) if path.exists() else None
    secure(path.parent, directory=True)
    if expected is not None and digest(read(path)) != expected:
        raise ActivationError('environment changed')
    temporary = path.with_name('.' + path.name + '.new')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, 'wb') as stream:
            if before:
                os.fchown(stream.fileno(), before.st_uid, before.st_gid)
                os.fchmod(stream.fileno(), stat.S_IMODE(before.st_mode))
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        if before and (identity(path.lstat()) != identity(before) or (expected is not None and digest(read(path)) != expected)):
            raise ActivationError('environment changed before replace')
        os.replace(temporary, path)
        sync(path.parent)
    finally:
        if temporary.exists():
            temporary.unlink()
            sync(path.parent)



def selected(raw):
    values = {}
    for line in raw.decode().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        key, sep, value = line.partition('=')
        if PREFIX in key.upper():
            if not sep or key not in KEYS or key in values or '\r' in value:
                raise ActivationError('ambiguous SSO configuration')
            values[key] = value
    return values


def settings(subject, user, secret):
    if not re.fullmatch('[a-f0-9]{64}', secret) or type(subject) is not int or type(user) is not int or subject <= 0 or user <= 0:
        raise ActivationError('invalid activation input')
    return {PREFIX+'ENABLED':'1', PREFIX+'ISSUER':'https://health.executor.life',
            PREFIX+'ORIGIN':'https://edu.executor.life', PREFIX+'SUBJECT':str(subject),
            PREFIX+'USER_ID':str(user), PREFIX+'SECRET':secret}


def patch(raw, target):
    current = selected(raw)
    if current and current.get(PREFIX+'ENABLED', '0') not in ('0', ''):
        raise ActivationError('SSO already configured')
    lines = [line for line in raw.splitlines(keepends=True) if line.decode().partition('=')[0] not in KEYS]
    kept = b''.join(lines)
    return kept + (b'\n' if kept and not kept.endswith(b'\n') else b'') + ''.join(k+'='+v+'\n' for k,v in sorted(target.items())).encode()


def run(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=45,
                            env={'PATH':'/usr/bin:/bin', 'LC_ALL':'C'}, check=False)
    if result.returncode:
        raise ActivationError('service or source command failed')
    return result.stdout


def source(manifest):
    if not manifest or not isinstance(manifest, dict):
        raise ActivationError('empty source manifest')
    for name, expected in manifest.items():
        path = Path(name)
        if path.is_absolute() or '..' in path.parts or path.parts[0] not in ('backend','frontend','deploy') or 'data' in path.parts:
            raise ActivationError('invalid source path')
        full = ROOT / path
        if not re.fullmatch('[a-f0-9]{64}', expected) or not full.is_file() or full.resolve() != full or full.is_symlink() or digest(full.read_bytes()) != expected:
            raise ActivationError('production source differs')


def database(user):
    path = ROOT / 'backend/data/edu.db'
    connection = sqlite3.connect(path.as_uri()+'?mode=ro', uri=True, timeout=10)
    try:
        connection.execute('PRAGMA query_only=ON')
        connection.execute('BEGIN')
        if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
            raise ActivationError('database integrity failed')
        row = connection.execute('SELECT id,username,role FROM users WHERE id=?', (user,)).fetchone()
        if row is None:
            raise ActivationError('Edu account absent')
        counts = {name: connection.execute('SELECT count(*) FROM '+name).fetchone()[0] for name in ('users','courses','exams','scores')}
        return {'identity_digest': digest(json.dumps(row).encode()), 'counts':counts}
    finally:
        connection.close()


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(url, payload=None):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    req = urllib.request.Request(url, data=None if payload is None else json.dumps(payload).encode(), headers={'Content-Type':'application/json'})
    try:
        response = opener.open(req, timeout=10)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read(65537)
        if len(raw) > 65536:
            raise ActivationError('probe response too large')
        return response.status, response.headers, raw


def service_config():
    service = run('/usr/bin/systemctl','show','edu-backend','-p','User','-p','WorkingDirectory',
                  '-p','EnvironmentFiles','-p','Environment','-p','PassEnvironment',
                  '-p','UnsetEnvironment','-p','ExecStart').decode()
    fields = dict(line.split('=',1) for line in service.splitlines())
    start = fields.get('ExecStart','')
    expected = '{ path=/opt/edu/venv/bin/gunicorn ; argv[]=/opt/edu/venv/bin/gunicorn -c /opt/edu/deploy/gunicorn.conf.py app:app ; ignore_errors=no ; '
    if (fields.get('User') != 'root' or fields.get('WorkingDirectory') != '/opt/edu/backend'
            or fields.get('EnvironmentFiles') or fields.get('PassEnvironment') or fields.get('UnsetEnvironment')
            or PREFIX in fields.get('Environment','') or not start.startswith(expected)
            or start.count('{') != 1 or start.count('}') != 1):
        raise ActivationError('service configuration differs')
    if any(line.partition('=')[0].startswith(PREFIX) for line in run('/usr/bin/systemctl','show-environment').decode().splitlines()):
        raise ActivationError('manager SSO environment override')


def health():
    service_config()
    if run('/usr/bin/systemctl','is-active','edu-backend').strip() != b'active':
        raise ActivationError('Edu service inactive')
    code, _, raw = request('http://127.0.0.1:5060/api/health')
    if code != 200 or json.loads(raw) != {'ok':True}:
        raise ActivationError('Edu health failed')


def verify():
    health()
    for origin in ('http://127.0.0.1:5060', 'https://edu.executor.life'):
        code, _, raw = request(origin+'/api/auth/provider')
        if code != 200 or json.loads(raw) != {'provider':'health'}:
            raise ActivationError('Health provider not active')
    code, headers, _ = request('https://edu.executor.life/api/auth/health/start')
    location = urllib.parse.urlsplit(headers.get('Location',''))
    if code != 302 or location.scheme != 'https' or location.netloc != 'health.executor.life' or location.path != '/connect/edu':
        raise ActivationError('Health browser redirect invalid')
    query = urllib.parse.parse_qs(location.query)
    if set(query) != {'state'} or len(query['state']) != 1 or not re.fullmatch('[A-Za-z0-9_-]{43}',query['state'][0]):
        raise ActivationError('Health state invalid')
    if request('https://edu.executor.life/api/auth/login', {})[0] != 409:
        raise ActivationError('legacy login not rejected')
    if request('https://edu.executor.life/api/auth/token-login', {})[0] != 400:
        raise ActivationError('empty native credentials not rejected')


def execute(payload):
    if set(payload) != {'binding','manifest','shared_secret','apply','resume'}:
        raise ActivationError('unexpected activation fields')
    binding = payload['binding']
    if set(binding) != {'revision','subject','user'} or not re.fullmatch('[a-f0-9]{40}',binding['revision']):
        raise ActivationError('invalid source binding')
    target = settings(binding['subject'],binding['user'],payload['shared_secret'])
    bound = {**binding, 'manifest_digest':digest(json.dumps(payload['manifest'],sort_keys=True).encode()),
             'secret_digest':digest(payload['shared_secret'].encode())}
    directories = (ROOT, ROOT/'backend', ROOT/'backend/data')
    directory_binding = {str(p):(secure(p,directory=True).st_dev, p.stat().st_ino, p.stat().st_uid, p.stat().st_gid, p.stat().st_mode) for p in directories}
    def check_directories():
        current = {str(p):(secure(p,directory=True).st_dev, p.stat().st_ino, p.stat().st_uid, p.stat().st_gid, p.stat().st_mode) for p in directories}
        if current != directory_binding:
            raise ActivationError('deployment directory identity changed')
    source(payload['manifest'])
    if payload['resume']:
        if not payload['apply'] or not JOURNAL.exists() or not LOCK.exists():
            raise ActivationError('resume requires original journal and lock')
        original = json.loads(read(JOURNAL))
        if original.get('binding') != bound or original.get('state') == 'CONFIGURATION_SUCCEEDED':
            raise ActivationError('resume binding differs')
        service_config()
    else:
        health()
    before_db = database(binding['user'])
    if stat.S_IMODE(secure(ENV).st_mode) != 0o600:
        raise ActivationError('environment must remain private')
    raw = read(ENV)
    if not payload['apply']:
        if JOURNAL.exists() or LOCK.exists():
            raise ActivationError('existing activation requires explicit resume')
        patch(raw,target)
        return {'state':'READY', 'binding':bound, 'database':before_db}
    STATE.mkdir(mode=0o700, exist_ok=True)
    secure(STATE,directory=True)
    sync(STATE.parent)
    if JOURNAL.exists():
        previous = json.loads(read(JOURNAL))
        if previous.get('state') == 'CONFIGURATION_SUCCEEDED' or not payload['resume']:
            raise ActivationError('activation already exists')
    existed = LOCK.exists()
    fd = os.open(LOCK, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,'r+b') as lock:
        secure(LOCK)
        fcntl.flock(lock,fcntl.LOCK_EX | fcntl.LOCK_NB)
        if JOURNAL.exists():
            journal = json.loads(read(JOURNAL))
            if not payload['resume'] or journal['binding'] != bound or journal['state'] == 'CONFIGURATION_SUCCEEDED':
                raise ActivationError('activation exists or binding differs')
            if database(binding['user']) != journal['database']:
                raise ActivationError('database changed since activation')
            raw = read(ENV)
            if digest(raw) not in (journal['before'],journal['after']):
                raise ActivationError('configuration changed since activation')
        else:
            if payload['resume'] or existed or lock.read():
                raise ActivationError('unknown activation lock')
            replacement = patch(raw,target)
            journal = {'binding':bound,'before':digest(raw),'after':digest(replacement),
                       'database':before_db,'state':'PREPARED'}
            lock.write(b'edu-health-sso-v1\n');lock.flush();os.fsync(lock.fileno());sync(STATE)
            atomic(JOURNAL,json.dumps(journal,sort_keys=True).encode())
        try:
            check_directories()
            source(payload['manifest'])
            current = read(ENV)
            if digest(current) == journal['before']:
                replacement = patch(current,target)
                if digest(replacement) != journal['after']:
                    raise ActivationError('replacement differs')
                atomic(ENV,replacement,journal['before'])
            if selected(read(ENV)) != target:
                raise ActivationError('installed configuration differs')
            journal['state']='RESTARTING';atomic(JOURNAL,json.dumps(journal,sort_keys=True).encode())
            run('/usr/bin/systemctl','restart','edu-backend')
            time.sleep(2)
            verify()
            source(payload['manifest'])
            if database(binding['user']) != journal['database'] or digest(read(ENV)) != journal['after']:
                raise ActivationError('post-activation data or configuration differs')
            check_directories()
            journal['state']='CONFIGURATION_SUCCEEDED';atomic(JOURNAL,json.dumps(journal,sort_keys=True).encode())
            LOCK.unlink();sync(STATE)
            return {'state':journal['state'],'binding':bound,'database':journal['database'], 'browser_acceptance':'required'}
        except BaseException:
            journal['state']='NEEDS_OPERATOR';atomic(JOURNAL,json.dumps(journal,sort_keys=True).encode())
            raise


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--revision',required=True)
    parser.add_argument('--health-subject',type=int,required=True)
    parser.add_argument('--edu-user',type=int,required=True)
    parser.add_argument('--apply',action='store_true')
    parser.add_argument('--resume',action='store_true')
    args=parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}',args.revision) or (args.resume and not args.apply):
        raise ActivationError('invalid revision or resume')
    raw=sys.stdin.buffer.read(4097)
    data=json.loads(raw)
    if len(raw)>4096 or set(data)!={'shared_secret'}:
        raise ActivationError('stdin must contain only shared_secret')
    settings(args.health_subject,args.edu_user,data['shared_secret'])
    repo=Path(__file__).resolve().parents[1]
    paths=subprocess.check_output(['git','-C',str(repo),'ls-tree','-r','--name-only',args.revision],text=True).splitlines()
    paths=[p for p in paths if p.startswith(('backend/','frontend/','deploy/')) and not any(x in Path(p).parts for x in ('data','tests','ios','node_modules')) and not p.endswith(('.test.ts','.test.tsx'))]
    manifest={p:digest(subprocess.check_output(['git','-C',str(repo),'show',args.revision+':'+p])) for p in paths}
    payload={'binding':{'revision':args.revision,'subject':args.health_subject,'user':args.edu_user},
             'manifest':manifest,'shared_secret':data['shared_secret'],'apply':args.apply,'resume':args.resume}
    script=Path(__file__).read_bytes().rsplit(b"\nif __name__ == '__main__':",1)[0]
    script+=b"\ntry:\n print(json.dumps(execute(json.load(sys.stdin))))\nexcept BaseException as error:\n print(json.dumps({'state':'FAILED','error_type':type(error).__name__,'reason':str(error) if isinstance(error,ActivationError) else 'operator failure'}),file=sys.stderr)\n sys.exit(1)\n"
    command="python3 -c 'import base64;exec(base64.b64decode(\""+base64.b64encode(script).decode()+"\"))'"
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-p','22222','root@47.237.191.17',command], input=json.dumps(payload).encode(),timeout=120)
    if result.returncode:
        raise ActivationError('remote activation failed; retain original binding and inspect journal')


if __name__ == '__main__':
    try:
        main()
    except (ActivationError, ValueError, OSError, subprocess.SubprocessError) as error:
        print(json.dumps({'state':'FAILED','error_type':type(error).__name__,'reason':str(error) if isinstance(error,ActivationError) else 'operator failure'}),file=sys.stderr)
        sys.exit(1)
