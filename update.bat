@echo off
rem Aktualisiert den LoL Rank Tracker auf die neueste GitHub-Version.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0update.ps1"
if "%1"=="silent" exit /b
pause
