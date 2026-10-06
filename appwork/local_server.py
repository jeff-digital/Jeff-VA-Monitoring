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
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


HOST = "127.0.0.1"
PORT = 8080
BACKUP_PATH = "/api/automatic-backup"
MAX_BACKUP_BYTES = 30 * 1024 * 1024
BACKUP_FILENAME = "Jeff VA Backup.xlsx"
CONTENT_SECURITY_POLICY = (
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
    "script-src 'self' https://accounts.google.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://cdn.sheetjs.com; "
    "script-src-attr 'none'; style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
    "img-src 'self' data: blob:; font-src 'self' data: https://cdnjs.cloudflare.com; "
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
    def end_headers(self) -> None:
        self.send_header("Content-Security-Policy", CONTENT_SECURITY_POLICY)
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        super().end_headers()

    def do_POST(self) -> None:  # noqa: N802 - inherited HTTP handler name
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
    with ThreadingHTTPServer((HOST, PORT), JeffVARequestHandler) as server:
        print(f"Jeff VA is running at http://localhost:{PORT}/")
        print(f"Automatic Excel backup: Documents\\{BACKUP_FILENAME}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nJeff VA server stopped.")
