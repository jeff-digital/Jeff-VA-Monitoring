@echo off
setlocal
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-app.ps1"
if errorlevel 1 exit /b 1
start "" "http://localhost:8080/"
python "%~dp0scripts\local_server.py"
