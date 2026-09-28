@echo off
setlocal
cd /d "%~dp0appwork"
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-app.ps1"
cd /d "%~dp0appwork"
start "" "http://localhost:8080/"
python local_server.py
