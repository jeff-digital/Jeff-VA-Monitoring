"""Local-only web server for Jeff VA.

It serves the frontend and accepts the app's automatic Excel backup only from
the same computer. The backup is written atomically to the current Windows
user's Documents folder, so closing the server window never leaves a partially
written workbook behind.
"""

from __future__ import annotations

import json
import ipaddress
import os
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError


HOST = "127.0.0.1"
PORT = 8080
FRONTEND_ROOT = Path(__file__).resolve().parents[1] / "src" / "frontend"
BACKUP_PATH = "/api/automatic-backup"
GMAIL_REFRESH_PATH = "/api/gmail/refresh"
# Forward to the app's authenticated Worker so OAuth secrets stay server-side.
GMAIL_REFRESH_UPSTREAM = "https://jeff-va-monitoring.jeffdigi.workers.dev/api/gmail/refresh"
EMAIL_AI_PATH = "/api/email/classify"
EMAIL_AI_UPSTREAM = "https://jeff-va-monitoring.jeffdigi.workers.dev/api/email/classify"
MAX_BACKUP_BYTES = 30 * 1024 * 1024
BACKUP_FILENAME = "Jeff VA Backup.xlsx"
APP_ROUTES = {
    "/dashboard",
    "/daily-task",
    "/applications",
    "/to-apply",
    "/news",
    "/hired",
    "/inbox",
    "/documents",
    "/subscriptions",
    "/wallet",
    "/account",
}
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; "
    "script-src 'self' https://accounts.google.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.sheetjs.com; "
    "script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
    "img-src 'self' data: blob: https:; font-src 'self' data: https://cdnjs.cloudflare.com; "
    "connect-src 'self' https://oeooedwobhmpwwdohrcy.supabase.co wss://oeooedwobhmpwwdohrcy.supabase.co "
    "https://gmail.googleapis.com https://*.googleapis.com https://accounts.google.com; "
    "frame-src 'self' blob: https://accounts.google.com; worker-src 'self' blob: https://cdn.jsdelivr.net; "
    "form-action 'self'"
)
ALLOWED_BACKUP_HOSTS = {
    f"http://localhost:{PORT}": f"localhost:{PORT}",
    f"http://127.0.0.1:{PORT}": f"127.0.0.1:{PORT}",
}


def is_allowed_backup_request(origin: str, host: str, client_ip: str) -> bool:
    expected_host = ALLOWED_BACKUP_HOSTS.get(origin)
    try:
        is_loopback = ipaddress.ip_address(client_ip).is_loopback
    except ValueError:
        return False
    return is_loopback and expected_host is not None and host.lower() == expected_host


def documents_folder() -> Path:
    """Return Documents, including common OneDrive/redirected configurations."""
    if os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
            ) as key:
                value, _ = winreg.QueryValueEx(key, "Personal")
                if value:
                    return Path(os.path.expandvars(value)).expanduser()
        except OSError:
            pass
    return Path.home() / "Documents"


def write_backup(payload: bytes) -> Path:
    target = documents_folder() / BACKUP_FILENAME
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".xlsx.tmp")
    with temporary.open("wb") as file:
        file.write(payload)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, target)
    return target


class JeffVARequestHandler(SimpleHTTPRequestHandler):
    def _refresh_gmail(self, upstream_url=GMAIL_REFRESH_UPSTREAM, timeout=12) -> None:
        if not is_allowed_backup_request(self.headers.get("Origin", ""), self.headers.get("Host", ""), self.client_address[0]):
            self.send_error(HTTPStatus.FORBIDDEN)
            return
        authorization = self.headers.get("Authorization", "")
        if not authorization.startswith("Bearer "):
            self.send_error(HTTPStatus.UNAUTHORIZED)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= 16384:
            self.send_error(HTTPStatus.BAD_REQUEST)
            return
        payload = self.rfile.read(length)
        try:
            request = Request(upstream_url, data=payload, method="POST", headers={
                "Authorization": authorization, "Content-Type": "application/json",
            })
            try:
                with urlopen(request, timeout=timeout) as upstream:
                    status, body = upstream.status, upstream.read(16384)
            except HTTPError as error:
                status, body = error.code, error.read(16384)
            # Never pass an HTML error page off as a successful token response.
            json.loads(body)
        except (URLError, TimeoutError, OSError, ValueError):
            status = HTTPStatus.SERVICE_UNAVAILABLE
            body = json.dumps({"error": "Cloudflare AI is unavailable or not deployed yet. Client emails remain queued.", "retryAfter": 120}
                              if upstream_url == EMAIL_AI_UPSTREAM else {"error": "Gmail renewal is temporarily unavailable. Saved emails remain available."}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _serve_app_route(self) -> None:
        if urlparse(self.path).path.rstrip("/") in APP_ROUTES:
            self.path = "/index.html"

    def do_GET(self) -> None:  # noqa: N802 - inherited HTTP handler name
        self._serve_app_route()
        super().do_GET()

    def do_HEAD(self) -> None:  # noqa: N802 - inherited HTTP handler name
        self._serve_app_route()
        super().do_HEAD()

    def end_headers(self) -> None:
        # Development files change frequently. Prevent an older index page from
        # loading a JavaScript bundle whose controls no longer match the HTML.
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def do_POST(self) -> None:  # noqa: N802 - inherited HTTP handler name
        if urlparse(self.path).path == EMAIL_AI_PATH:
            self._refresh_gmail(EMAIL_AI_UPSTREAM, timeout=24)
            return
        if urlparse(self.path).path == GMAIL_REFRESH_PATH:
            self._refresh_gmail()
            return
        if urlparse(self.path).path != BACKUP_PATH:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        origin = self.headers.get("Origin", "")
        if not is_allowed_backup_request(origin, self.headers.get("Host", ""), self.client_address[0]):
            self.send_error(HTTPStatus.FORBIDDEN, "Only the local Jeff VA app can save a backup")
            return

        content_length = self.headers.get("Content-Length")
        try:
            length = int(content_length or "0")
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BACKUP_BYTES:
            self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, "Invalid backup size")
            return

        payload = self.rfile.read(length)
        if len(payload) != length:
            self.send_error(HTTPStatus.BAD_REQUEST, "Incomplete backup upload")
            return
        if not payload.startswith(b"PK\x03\x04"):
            self.send_error(HTTPStatus.BAD_REQUEST, "Backup must be an Excel workbook")
            return

        try:
            write_backup(payload)
        except OSError as error:
            self.send_error(HTTPStatus.INTERNAL_SERVER_ERROR, f"Could not save backup: {error}")
            return

        response = json.dumps({"ok": True, "file": BACKUP_FILENAME}).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def log_message(self, format: str, *args: object) -> None:
        # Keep the server window readable; normal page/backup requests are expected.
        if not args or str(args[1] if len(args) > 1 else "").startswith("4"):
            super().log_message(format, *args)


if __name__ == "__main__":
    handler = partial(JeffVARequestHandler, directory=str(FRONTEND_ROOT))
    with ThreadingHTTPServer((HOST, PORT), handler) as server:
        print(f"Jeff VA is running at http://localhost:{PORT}/")
        print(f"Automatic Excel backup: Documents\\{BACKUP_FILENAME}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nJeff VA server stopped.")
