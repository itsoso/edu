from urllib.parse import urlsplit


def test_skills_are_public_but_learning_data_stays_private(client, monkeypatch):
    monkeypatch.setenv('EDU_HEALTH_SSO_ENABLED', '1')
    response = client.get('/.well-known/edu-skills.json')
    assert response.status_code == 200
    assert response.headers['Access-Control-Allow-Origin'] == '*'
    manifest = response.get_json()
    assert client.get('/api/skills').get_json() == manifest
    for skill in manifest['skills']:
        path = urlsplit(skill['url']).path
        doc = client.get(path)
        assert doc.status_code == 200
        assert doc.mimetype == 'text/markdown'
        assert doc.headers['Access-Control-Allow-Origin'] == '*'
        assert doc.data.startswith(b'---\nname: ')
        assert client.get(path, headers={'If-None-Match': doc.headers['ETag']}).status_code == 304
    for path in ['/api/dashboard/summary', '/api/mistakes', '/api/exams']:
        assert client.get(path).status_code == 401
    assert client.get('/api/skills/nonexistent/SKILL.md').status_code == 404
