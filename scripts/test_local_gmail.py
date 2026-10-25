"""Offline checks for localhost Gmail renewal forwarding."""
import importlib.util
import io
import json
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location('local_server', Path(__file__).with_name('local_server.py'))
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)

def handler(origin='http://localhost:8080', authorization='Bearer test-session'):
    request = object.__new__(server.JeffVARequestHandler)
    payload = b'{"refreshToken":"test-refresh"}'
    request.headers = {'Origin': origin, 'Host': 'localhost:8080', 'Authorization': authorization,
                       'Content-Length': str(len(payload))}
    request.client_address = ('127.0.0.1', 12345)
    request.rfile = io.BytesIO(payload)
    request.wfile = io.BytesIO()
    request.send_response = lambda status: setattr(request, 'result_status', status)
    request.send_error = lambda status: setattr(request, 'result_status', status)
    request.send_header = lambda *args: None
    request.end_headers = lambda: None
    return request

with patch.object(server, 'urlopen') as fetch:
    denied = handler(origin='https://outside.example')
    denied._refresh_gmail()
    assert denied.result_status == 403
    unsigned = handler(authorization='')
    unsigned._refresh_gmail()
    assert unsigned.result_status == 401
    fetch.assert_not_called()

class Response:
    status = 200
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self, limit): return b'{"access_token":"renewed","expires_in":3600}'

def fetch(request, timeout):
    assert request.full_url == server.GMAIL_REFRESH_UPSTREAM
    assert request.get_header('Authorization') == 'Bearer test-session'
    assert json.loads(request.data)['refreshToken'] == 'test-refresh'
    return Response()

with patch.object(server, 'urlopen', side_effect=fetch):
    connected = handler()
    connected._refresh_gmail()
    assert connected.result_status == 200
    assert json.loads(connected.wfile.getvalue())['access_token'] == 'renewed'

with patch.object(server, 'urlopen', side_effect=URLError('offline')):
    unavailable = handler()
    unavailable._refresh_gmail()
    assert unavailable.result_status == 503
    assert 'reconnect' not in json.loads(unavailable.wfile.getvalue())

with patch.object(server, 'urlopen', side_effect=HTTPError(server.GMAIL_REFRESH_UPSTREAM, 403, 'revoked', {}, io.BytesIO(b'{"reconnect":true}'))):
    revoked = handler()
    revoked._refresh_gmail()
    assert revoked.result_status == 403
    assert json.loads(revoked.wfile.getvalue())['reconnect'] is True

print('Local Gmail forwarding checks passed: origin, authentication, fixed upstream, renewal, and temporary failures.')

def progress_fetch(request, timeout):
    assert request.full_url == server.PROGRESS_AI_UPSTREAM
    assert timeout == 30
    assert request.get_header('Authorization') == 'Bearer test-session'
    return Response()

with patch.object(server, 'urlopen', side_effect=progress_fetch):
    progress = handler()
    progress.path = server.PROGRESS_AI_PATH
    progress.do_POST()
    assert progress.result_status == 200

with patch.object(server, 'urlopen', side_effect=URLError('offline')):
    progress = handler()
    progress.path = server.PROGRESS_AI_PATH
    progress.do_POST()
    assert progress.result_status == 503
    assert 'progress review' in json.loads(progress.wfile.getvalue())['error']

def ai_fetch(request, timeout):
    assert request.full_url == server.EMAIL_AI_UPSTREAM
    assert timeout == 24
    assert request.get_header('Authorization') == 'Bearer test-session'
    return Response()

with patch.object(server, 'urlopen', side_effect=ai_fetch):
    ai = handler()
    ai.path = server.EMAIL_AI_PATH
    ai.do_POST()
    assert ai.result_status == 200

with patch.object(server, 'urlopen', side_effect=URLError('offline')):
    ai = handler()
    ai.path = server.EMAIL_AI_PATH
    ai.do_POST()
    assert ai.result_status == 503
    assert 'AI' in json.loads(ai.wfile.getvalue())['error']
print('Local AI forwarding checks passed: fixed route, authorization forwarding, timeout and unavailable deployment response.')


def backup_receipt_fetch(request, timeout):
    assert request.full_url == server.BACKUP_DOWNLOAD_UPSTREAM
    assert request.get_header('Authorization') == 'Bearer test-session'
    return Response()

with patch.object(server, 'urlopen', side_effect=backup_receipt_fetch):
    backup = handler()
    backup.path = server.BACKUP_DOWNLOAD_PATH
    backup.do_POST()
    assert backup.result_status == 200

with patch.object(server, 'urlopen', side_effect=URLError('offline')):
    backup = handler()
    backup.path = server.BACKUP_DOWNLOAD_PATH
    backup.do_POST()
    assert backup.result_status == 503
    assert 'Backup download protection' in json.loads(backup.wfile.getvalue())['error']
print('Local backup receipt forwarding checks passed.')


def research_fetch(request, timeout):
    assert request.full_url == server.RESEARCH_UPSTREAM
    assert timeout == 75
    assert request.get_header('Authorization') == 'Bearer test-session'
    return Response()

with patch.object(server, 'urlopen', side_effect=research_fetch):
    research = handler()
    research.path = server.RESEARCH_PATH
    research.do_POST()
    assert research.result_status == 200

with patch.object(server, 'urlopen', side_effect=URLError('offline')):
    research = handler()
    research.path = server.RESEARCH_PATH
    research.do_POST()
    assert research.result_status == 503
    assert 'research assistant' in json.loads(research.wfile.getvalue())['error']
print('Local research forwarding checks passed.')


def usage_fetch(request, timeout):
    assert request.full_url == server.RESEARCH_USAGE_UPSTREAM
    assert request.get_method() == 'GET'
    assert request.data is None
    assert request.get_header('Authorization') == 'Bearer test-session'
    assert timeout == 15
    return Response()

with patch.object(server, 'urlopen', side_effect=usage_fetch):
    usage = handler()
    usage.path = server.RESEARCH_USAGE_PATH
    usage.do_GET()
    assert usage.result_status == 200

with patch.object(server, 'urlopen') as fetch:
    usage = handler(authorization='')
    usage.path = server.RESEARCH_USAGE_PATH
    usage.do_GET()
    assert usage.result_status == 401
    fetch.assert_not_called()
print('Local research usage forwarding checks passed.')
