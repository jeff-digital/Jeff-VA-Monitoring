@echo off
setlocal
cd /d "%~dp0appwork"
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-app.ps1"
cd /d "%~dp0appwork"
start "" "http://127.0.0.1:8080/"
python local_server.py
