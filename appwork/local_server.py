"""Local-only web server for Jeff VA.

It serves the frontend and accepts the app's automatic Excel backup only from
the same computer. The backup is written atomically to the current Windows
user's Documents folder, so closing the server window never leaves a partially
written workbook behind.
"""

from __future__ import annotations

import json
import os
import socket
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse


HOST = "0.0.0.0"
PORT = 8080
BACKUP_PATH = "/api/automatic-backup"
MAX_BACKUP_BYTES = 30 * 1024 * 1024
BACKUP_FILENAME = "Jeff VA Backup.xlsx"
ALLOWED_ORIGINS = {f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"}


def local_network_address() -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as connection:
            connection.connect(("8.8.8.8", 80))
            return connection.getsockname()[0]
    except OSError:
        return "your-computer-ip"


def is_allowed_origin(origin: str, host: str) -> bool:
    if origin in ALLOWED_ORIGINS:
        return True
    parsed_origin = urlparse(origin)
    parsed_host = urlparse(f"http://{host}")
    return parsed_origin.scheme == "http" and parsed_origin.port == PORT and parsed_origin.hostname == parsed_host.hostname


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
    def do_POST(self) -> None:  # noqa: N802 - inherited HTTP handler name
        if urlparse(self.path).path != BACKUP_PATH:
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        origin = self.headers.get("Origin", "")
        if origin and not is_allowed_origin(origin, self.headers.get("Host", "")):
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
        print(f"For mobile on the same Wi-Fi: http://{local_network_address()}:{PORT}/")
        print(f"Automatic Excel backup: Documents\\{BACKUP_FILENAME}")
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\nJeff VA server stopped.")
